/* global document, window */
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const config = JSON.parse(await readFile('vercel.json', 'utf8'));
const headers = Object.fromEntries(config.headers.find(rule => rule.source === '/(.*)' && !rule.has && !rule.missing).headers.map(header => [header.key, header.value]));
const server = createServer((request, response) => {
  response.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><html lang="en"><head><title>Header fixture</title></head><body><h1>Header fixture</h1><script>window.inlineScriptRan=true;document.addEventListener("securitypolicyviolation",event=>{window.violations=(window.violations||[]).concat(event.effectiveDirective)});</script></body></html>');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const port = server.address().port;
const browser = await puppeteer.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
try {
  const page = await browser.newPage();
  const response = await page.goto(`http://127.0.0.1:${port}/`);
  assert.equal(response.headers()['x-content-type-options'], 'nosniff');
  assert.equal(await page.evaluate(() => window.inlineScriptRan), true);
  const permissions = await page.evaluate(() => Object.fromEntries(['camera', 'microphone', 'geolocation'].map(feature => [feature, document.featurePolicy.allowsFeature(feature)])));
  assert.deepEqual(permissions, { camera: false, microphone: false, geolocation: false });
  await page.evaluate(() => { const base = document.createElement('base'); base.href = 'https://example.invalid/'; document.head.append(base); });
  await page.waitForFunction(() => window.violations?.includes('base-uri'));
  assert.equal(await page.evaluate(() => document.baseURI), `http://127.0.0.1:${port}/`);
  await page.evaluate(() => { const iframe = document.createElement('iframe'); iframe.src = '/child'; document.body.append(iframe); });
  await page.waitForFunction(() => document.querySelector('iframe').contentDocument?.querySelector('h1')?.textContent === 'Header fixture');
  await page.goto(`http://localhost:${port}/`);
  await page.evaluate(origin => { const iframe = document.createElement('iframe'); iframe.src = origin; document.body.append(iframe); }, `http://127.0.0.1:${port}/`);
  // A blocked frame resolves to Chrome's error document, never the protected page.
  await page.waitForFrame(frame => frame.url().startsWith('chrome-error://'));
  const result = { scope: 'Local HTTP fixture using exact configured response headers; no business commands', inlineScriptAllowed: true, externalBaseBlocked: true, disabledUnusedPermissions: permissions, sameOriginFrameAllowed: true, crossOriginFrameBlocked: true };
  await writeFile('artifacts/lighthouse/security-headers-browser.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
