/* global history */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { URL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import lighthouse, { desktopConfig } from 'lighthouse';
import { captureDocuments } from './document-identity.mjs';
const a = 'a'.repeat(40),
  b = 'b'.repeat(40);
let commit = a;
const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
  res.end(
    `<html><head><meta name="lm-build-commit" content="${commit}"></head><body>Fixture</body></html>`
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const results = [];
let browser;
try {
  browser = await puppeteer.launch({
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : { channel: 'chrome' }),
    headless: true,
  });
  for (const mode of ['stable', 'wrong-release-return', 'route-away-return']) {
    commit = a;
    const page = await browser.newPage();
    const capture = captureDocuments(page, url, a);
    await page.goto(url);
    if (mode === 'wrong-release-return') {
      commit = b;
      await page.reload();
      commit = a;
      await page.reload();
    }
    if (mode === 'route-away-return')
      await page.evaluate(() => {
        history.pushState({}, '', '/other');
        history.pushState({}, '', '/');
      });
    if (mode === 'stable') assert.equal((await capture.verify()).commit, a);
    else await assert.rejects(capture.verify());
    results.push({ mode, passed: true });
    capture.dispose();
    await page.close();
  }
  const page = await browser.newPage();
  commit = a;
  const capture = captureDocuments(page, url, a, { allowLighthouseReset: true });
  await lighthouse(
    url,
    {
      port: Number(new URL(browser.wsEndpoint()).port),
      onlyCategories: ['performance'],
      logLevel: 'error',
    },
    desktopConfig,
    page
  );
  assert.equal((await capture.verify()).commit, a);
  capture.dispose();
  await page.close();
  results.push({ mode: 'lighthouse-bf-cache-probe', passed: true });
} finally {
  if (browser) await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await mkdir('artifacts/lighthouse', { recursive: true });
  await writeFile(
    'artifacts/lighthouse/document-identity-browser.json',
    JSON.stringify({ results, passed: results.length === 4 }, null, 2)
  );
}
console.log(JSON.stringify(results));
