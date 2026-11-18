/* global document, window, URL, Storage, DOMException, requestAnimationFrame */
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
const work = 'tmp/private-surfaces-fixture';
await mkdir(work, { recursive: true });
await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {AiConcierge} from './components/AiConcierge';import {installPrivateLocationPolicy} from './lib/privateIndexing';installPrivateLocationPolicy(window);createRoot(document.getElementById('root')).render(<AiConcierge/>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, splitting: true, format: 'esm', outdir: work, entryNames: 'entry', chunkNames: '[name]-[hash]',
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  plugins: [{ name: 'synthetic-concierge', setup(b) {
    b.onResolve({ filter: /^convex\/react$/ }, () => ({ path: 'convex', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const useAction=()=>async()=>{window.syntheticCalls=(window.syntheticCalls||0)+1;if(window.syntheticFailure)throw Error('Synthetic unavailable');return 'Synthetic design response';};` }));
  } }],
});
const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
const css = manifest['index.html'].css;
assert.ok(css?.length);
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html lang="en"><head><title>Private surface fixture</title><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(file => `<link rel="stylesheet" href="/${file}">`).join('')}</head><body class="bg-cream"><main><h1>Public fixture</h1><a href="#home">Public home</a></main><div id="root"></div><script type="module" src="/entry.js"></script></body></html>`);
    } else if (path.startsWith('/assets/')) {
      res.setHeader('Content-Type', 'text/css'); res.end(await readFile(join('dist/assets', basename(path))));
    } else if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(join(work, basename(path))));
    } else { res.statusCode = 404; res.end(); }
  } catch { res.statusCode = 404; res.end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
const results = [];
try {
  for (const viewport of [{ width: 320, height: 740 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
    const page = await browser.newPage(); await page.setViewport(viewport); const errors = []; const panelRequests = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.evaluateOnNewDocument(() => {
      Storage.prototype.getItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
      Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
    });
    let held;
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.url().includes('/ConciergePanel-')) { panelRequests.push(request.url()); held = request; }
      else request.continue();
    });
    await page.goto(origin, { waitUntil: 'networkidle0' });
    assert.equal(panelRequests.length, 0);
    await page.click('button[aria-label="Ask the Louie Mae concierge"]');
    await page.waitForSelector('[role="dialog"]');
    assert.match(await page.$eval('meta[name=robots]', n => n.content), /noindex/);
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.includes('Opening'));
    assert.equal(panelRequests.length, 1); await held.continue();
    await page.waitForSelector('input[aria-label="Ask the concierge"]');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Ask the concierge');
    await page.type('input', 'Preserved synthetic draft');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    assert.equal(await page.$('meta[name=robots]'), null);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Ask the Louie Mae concierge');
    await page.keyboard.press('Enter'); await page.waitForSelector('input');
    assert.equal(await page.$eval('input', n => n.value), 'Preserved synthetic draft');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[role="log"]')?.textContent.includes('Synthetic design response'));
    const geometry = await page.$eval('[role="dialog"]', n => { const r = n.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
    assert.ok(geometry.left >= 0 && geometry.right <= viewport.width && geometry.top >= 0 && geometry.bottom <= viewport.height);
    await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); });
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => (await window.axe.run()).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })));
    assert.deepEqual(violations, []);
    await page.evaluate(() => { window.location.hash = 'admin'; });
    await page.keyboard.press('Escape');
    assert.match(await page.$eval('meta[name=robots]', n => n.content), /noindex/);
    await page.evaluate(() => { window.location.hash = 'home'; });
    await page.waitForFunction(() => !document.querySelector('meta[name=robots]'));
    await page.click('button[aria-label="Ask the Louie Mae concierge"]');
    await page.evaluate(() => { window.syntheticFailure = true; });
    await page.type('input', 'Synthetic failure'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[role="log"]')?.textContent.includes('could not load a response'));
    assert.equal(await page.$eval('input', n => n.value), 'Synthetic failure');
    assert.equal(await page.evaluate(() => window.syntheticCalls), 2); assert.deepEqual(errors, []);
    await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); });
    const screenshot = `artifacts/lighthouse/private-surfaces-${viewport.width}.png`; await page.screenshot({ path: screenshot });
    results.push({ viewport, deferredPanelRequests: panelRequests.length, deniedStorage: true, draftAndFocusPreserved: true, overlappingPrivateState: true, syntheticRepliesOnly: true, violations, errors, screenshot });
    await page.close();
  }
  const failed = await browser.newPage();
  await failed.setRequestInterception(true);
  failed.on('request', r => r.url().includes('/ConciergePanel-') ? r.abort('failed') : r.continue());
  await failed.goto(origin + '/#admin', { waitUntil: 'networkidle0' });
  assert.match(await failed.$eval('meta[name=robots]', n => n.content), /noindex/);
  await failed.evaluate(() => { window.location.hash = 'home'; });
  await failed.waitForFunction(() => !document.querySelector('meta[name=robots]'));
  await failed.click('button[aria-label="Ask the Louie Mae concierge"]');
  await failed.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.includes('could not be opened'));
  assert.match(await failed.$eval('meta[name=robots]', n => n.content), /noindex/);
  await failed.keyboard.press('Escape');
  await failed.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  assert.equal(await failed.$('meta[name=robots]'), null);
  assert.equal(await failed.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Ask the Louie Mae concierge');
  results.push({ moduleFailureRecoverable: true, closeAndFocusPreserved: true }); await failed.close();
  for (const outcome of ['success', 'failure']) {
    const page = await browser.newPage(); let held;
    await page.setRequestInterception(true);
    page.on('request', request => request.url().includes('/ConciergePanel-') ? held = request : request.continue());
    await page.goto(origin, {waitUntil:'networkidle0'});
    await page.click('button[aria-label="Ask the Louie Mae concierge"]');
    await page.waitForFunction(() => document.activeElement?.textContent === 'Close concierge');
    await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Public home');
    if (outcome === 'success') await held.continue(); else await held.abort('failed');
    if (outcome === 'success') await page.waitForSelector('input[aria-label="Ask the concierge"]');
    else await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.includes('could not be opened'));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Public home');
    results.push({deferredOutcome:outcome,nonmodalFocusNavigationPreserved:true});await page.close();
  }
  await writeFile('artifacts/lighthouse/private-surfaces-browser.json', JSON.stringify({ scope: 'Local actual-component fixture; synthetic chat transport; no production commands', results }, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

