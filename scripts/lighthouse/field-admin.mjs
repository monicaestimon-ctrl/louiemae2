/* global window, document */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const report = {
  enabled: true,
  since: 0,
  through: 1,
  visits: 60,
  truncated: false,
  collectionLimited: false,
  limitedDays: 0,
  retentionBacklog: false,
  dailyBudget: { requests: 80, maxRequests: 5000, visits: 60, maxVisits: 1000 },
  metrics: [
    { name: 'LCP', count: 60, p75: 2601, threshold: 2500, status: 'above-target' },
    { name: 'CLS', count: 60, p75: 0.04, threshold: 0.1, status: 'within-target' },
    { name: 'INP', count: 0, p75: null, threshold: 200, status: 'insufficient-data' },
  ],
};
const output = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import FieldPerformance from './components/admin/FieldPerformance';createRoot(document.getElementById('root')).render(<main className="p-6"><h1 className="text-3xl">Commerce quality fixture</h1><h2>Commerce operations</h2><FieldPerformance/></main>);`,
  },
  bundle: true,
  write: false,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'isolated-report',
      setup(b) {
        b.onResolve({ filter: /contexts\/useRecoverableQuery$/ }, () => ({
          path: 'report',
          namespace: 'fixture',
        }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          loader: 'js',
          contents: `export function useRecoverableQuery(ref,args){window.lastQuery=args;return args==='skip'?{status:'idle'}:window.location.search.includes('unavailable')?{status:'unavailable',retry:()=>window.retried=true}:{status:'ready',data:${JSON.stringify(report)}}}`,
        }));
      },
    },
  ],
});
const cssName = (await readdir('dist/assets')).find((name) => /^main-.*\.css$/.test(name));
assert.ok(cssName, 'Build before the admin visual fixture');
const css = await readFile('dist/assets/' + cssName, 'utf8');
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html');
  res.end(
    req.url === '/app.js'
      ? output.outputFiles[0].text
      : `<!doctype html><html lang="en"><head><title>Quality fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="lm-build-commit" content="${'b'.repeat(40)}"><style>${css}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`
  );
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox'],
});
const results = [];
await mkdir('artifacts/lighthouse/field-admin', { recursive: true });
try {
  for (const [width, height] of [
    [390, 900],
    [844, 390],
    [1440, 900],
  ]) {
    const page = await browser.newPage(),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width, height });
    await page.goto(origin, { waitUntil: 'networkidle0' });
    await page.waitForSelector('table');
    await page.addScriptTag({ content: axe.source });
    assert.deepEqual(
      (await page.evaluate(() => window.axe.run())).violations.map((v) => v.id),
      []
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true
    );
    assert.match(await page.$eval('[role="alert"]', (e) => e.textContent), /exceeds its target/);
    assert.match(await page.$eval('table', (e) => e.textContent), /Not measured/);
    await page.select('select', 'holm-home');
    assert.equal(await page.evaluate(() => window.lastQuery.route), 'holm-home');
    await page.screenshot({
      path: path.resolve(`artifacts/lighthouse/field-admin/report-${width}.png`),
      fullPage: true,
    });
    await page.goto(origin + '?unavailable', { waitUntil: 'networkidle0' });
    assert.equal(await page.$('table'), null);
    await page.click('button');
    assert.equal(await page.evaluate(() => window.retried), true);
    assert.deepEqual(errors, []);
    results.push({
      width,
      height,
      axeViolations: 0,
      overflow: false,
      filters: true,
      retry: true,
      staleTable: false,
    });
    await page.close();
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
await writeFile(
  'artifacts/lighthouse/field-admin/results.json',
  JSON.stringify(
    {
      scope:
        'Actual admin component with isolated query states; backend authorization is tested separately in qualityAccess.test.ts',
      results,
    },
    null,
    2
  )
);
console.log(JSON.stringify(results));
