/* global window, localStorage */
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../../convex/schema';
import { api } from '../../convex/_generated/api';
import { build } from 'esbuild';
import { Buffer } from 'node:buffer';
import { setTimeout } from 'node:timers';
import { URL } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
const source = import.meta.glob(['../../convex/**/*.ts', '../../convex/_generated/*.js']);
const modules = Object.fromEntries(
  Object.entries(source).map(([key, value]) => ['./' + key.slice('../../convex/'.length), value])
);
const release = 'b'.repeat(40),
  results = [],
  measurements = [],
  requests = [];
let t, browser, server, origin, staff;
const storageKey = 'lm:performance-consent:v1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function rows() {
  return t.run((ctx) => ctx.db.query('qualityVisits').collect());
}
async function settled() {
  await sleep(150);
}
beforeAll(async () => {
  vi.stubEnv('FIELD_QUALITY_ENABLED', 'true');
  vi.stubEnv('CJ_ADMIN_EMAILS', 'quality-fixture@example.com');
  vi.stubEnv(
    'DELIVERY_ADMIN_ROLES',
    JSON.stringify({ 'quality-fixture@example.com': ['engineering'] })
  );
  t = convexTest(schema, modules);
  const id = await t.run((ctx) => ctx.db.insert('users', { email: 'quality-fixture@example.com' }));
  staff = t.withIdentity({ subject: `${id}|fixture`, email: 'quality-fixture@example.com' });
  const outdir = path.resolve('artifacts/lighthouse/field-fixture');
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      sourcefile: 'field-fixture-entry.tsx',
      loader: 'tsx',
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{PerformancePreferences}from'./components/PerformancePreferences';import{installOptionalFieldMonitoring}from'./lib/quality/fieldEntry';window.restoreCount=0;window.addEventListener('pageshow',e=>{if(e.persisted)window.restoreCount++});const realFetch=window.fetch.bind(window);window.fetch=(input,options)=>{const url=String(input);return realFetch(url.startsWith('https://fixture.convex.site/quality')?url.replace('https://fixture.convex.site',''):input,options)};installOptionalFieldMonitoring();createRoot(document.getElementById('root')).render(<main><h1>Performance fixture</h1><p>Optional measurements use the actual collector and HTTP handlers.</p><PerformancePreferences/><button id="interaction" onClick={e=>e.currentTarget.textContent='Interaction completed'}>Try an interaction</button><a href="/away">Leave page</a></main>);`,
    },
    bundle: true,
    write: false,
    format: 'esm',
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    outdir,
    jsx: 'automatic',
    define: {
      'process.env.NODE_ENV': '"production"',
      'import.meta.env.VITE_CONVEX_URL': '"https://fixture.convex.cloud"',
    },
  });
  const files = new Map(
    bundle.outputFiles.map((file) => [
      '/' + path.relative(outdir, file.path).replaceAll('\\', '/'),
      file.text,
    ])
  );
  const entry = [...files.keys()].find((key) => key.endsWith('.js') && !key.startsWith('/chunks/')),
    css = [...files.values()][[...files.keys()].findIndex((key) => key.endsWith('.css'))] || '';
  server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://fixture').pathname;
      if (pathname.startsWith('/quality')) {
        requests.push({
          path: pathname,
          cookie: req.headers.cookie ?? null,
          referrer: req.headers.referer ?? null,
        });
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks).toString('utf8');
        if (req.method === 'POST') measurements.push(JSON.parse(body));
        // Local proxy connects the actual browser payload to isolated Convex HTTP/data functions.
        // Production CORS is separately exercised by qualityHttp.test.ts; no production host is called.
        const response = await t.fetch(pathname, {
          method: req.method,
          headers: {
            Origin: 'https://www.louiemae.com',
            ...(req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {}),
          },
          ...(req.method === 'POST' ? { body } : {}),
        });
        res.statusCode = response.status;
        res.setHeader('Content-Type', response.headers.get('content-type') || 'text/plain');
        return res.end(await response.text());
      }
      if (files.has(pathname)) {
        res.setHeader('Content-Type', pathname.endsWith('.css') ? 'text/css' : 'text/javascript');
        return res.end(files.get(pathname));
      }
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Set-Cookie', 'fixture_private_cookie=present; SameSite=Lax; Path=/');
      if (pathname === '/away')
        return res.end(
          '<!doctype html><html lang="en"><title>Away</title><main><h1>Away</h1><a href="/">Return</a></main></html>'
        );
      return res.end(
        `<!doctype html><html lang="en"><head><title>Performance fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="lm-build-commit" content="${release}"><style>${css}</style></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`
      );
    } catch {
      res.statusCode = 500;
      res.end('Fixture failure');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await puppeteer.launch({
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : { channel: 'chrome' }),
    headless: true,
  });
  await mkdir('artifacts/lighthouse/field-monitoring', { recursive: true });
});
afterAll(async () => {
  if (browser) await browser.close();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  vi.unstubAllEnvs();
  await writeFile(
    'artifacts/lighthouse/field-monitoring/results.json',
    JSON.stringify(
      {
        scope:
          'Isolated browser to real HTTP handlers and Convex test database; no production requests or customer records',
        results,
      },
      null,
      2
    )
  );
});
for (const [width, height] of [
  [390, 900],
  [844, 390],
  [1440, 900],
])
  it(`collects only after opt-in and a new load, with fresh bfcache visits at ${width}px`, async () => {
    const context = await browser.createBrowserContext(),
      page = await context.newPage(),
      assets = [],
      errors = [];
    page.on('request', (r) => assets.push(r.url()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width, height });
    const initialRows = (await rows()).length,
      initialRequests = requests.length;
    await page.goto(origin, { waitUntil: 'networkidle2' });
    expect(requests.length).toBe(initialRequests);
    expect(assets.some((url) => /fieldBootstrap|web-vitals/.test(url))).toBe(false);
    await page.click('main button');
    await page.click('input');
    await page.keyboard.press('Escape');
    await settled();
    expect(requests.length).toBe(initialRequests);
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() =>
      window.performance.getEntriesByType('resource').some((e) => e.name.includes('web-vitals'))
    );
    await page.click('main button');
    expect(
      await page.evaluate(() => {
        const box = window.document.querySelector('dialog').getBoundingClientRect();
        return (
          box.left >= 0 &&
          box.right <= window.innerWidth &&
          box.top >= 0 &&
          box.bottom <= window.innerHeight
        );
      })
    ).toBe(true);
    await page.addScriptTag({ content: axe.source });
    expect((await page.evaluate(() => window.axe.run())).violations.map((v) => v.id)).toEqual([]);
    await page.screenshot({
      path: `artifacts/lighthouse/field-monitoring/preference-${width}.png`,
    });
    await page.focus('.lm-performance-done');
    expect(
      await page.evaluate(() => {
        const box = window.document.activeElement.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= window.innerHeight;
      })
    ).toBe(true);
    await page.keyboard.press('Enter');
    expect(await page.$('dialog[open]')).toBeNull();
    await page.click('#interaction');
    await page.goto(origin + '/away', { waitUntil: 'networkidle2' });
    await settled();
    const first = (await rows()).slice(initialRows);
    expect(first.length).toBe(1);
    expect(first[0].samples.length).toBeGreaterThan(0);
    await page.goBack({ waitUntil: 'networkidle2' });
    expect(await page.evaluate(() => window.restoreCount)).toBeGreaterThan(0);
    await page.click('#interaction');
    await page.goto(origin + '/away', { waitUntil: 'networkidle2' });
    await settled();
    expect((await rows()).length - initialRows).toBe(2);
    expect(assets.some((url) => url.includes('web-vitals'))).toBe(true);
    expect(errors).toEqual([]);
    results.push({ case: 'opt-in and bfcache', width, newVisits: 2, axeViolations: 0, errors: [] });
    await context.close();
  });
it('stops all further delivery after revocation', async () => {
  const context = await browser.createBrowserContext(),
    page = await context.newPage();
  await page.evaluateOnNewDocument((key) => localStorage.setItem(key, 'granted'), storageKey);
  await page.goto(origin, { waitUntil: 'networkidle2' });
  await page.click('#interaction');
  await page.waitForNetworkIdle();
  await page.click('main button');
  await page.click('input');
  await page.keyboard.press('Escape');
  await page.waitForNetworkIdle();
  const before = measurements.length;
  await page.click('#interaction');
  await page.goto(origin + '/away', { waitUntil: 'networkidle2' });
  await settled();
  expect(measurements.length).toBe(before);
  results.push({ case: 'revocation', furtherMeasurements: 0 });
  await context.close();
});
it('never loads the collector library for private links or a disabled server gate', async () => {
  const context = await browser.createBrowserContext(),
    page = await context.newPage();
  await page.evaluateOnNewDocument((key) => localStorage.setItem(key, 'granted'), storageKey);
  const before = requests.length;
  for (const route of ['/#account', '/?deliveryQuote=private']) {
    await page.goto(origin + route, { waitUntil: 'networkidle2' });
    expect(
      await page.evaluate(() =>
        window.performance.getEntriesByType('resource').some((e) => e.name.includes('web-vitals'))
      )
    ).toBe(false);
  }
  expect(requests.length).toBe(before);
  vi.stubEnv('FIELD_QUALITY_ENABLED', '');
  await page.goto(origin, { waitUntil: 'networkidle2' });
  expect(
    await page.evaluate(() =>
      window.performance.getEntriesByType('resource').some((e) => e.name.includes('web-vitals'))
    )
  ).toBe(false);
  expect(requests.slice(before).every((r) => r.path === '/quality/config')).toBe(true);
  vi.stubEnv('FIELD_QUALITY_ENABLED', 'true');
  results.push({ case: 'private links and disabled gate', observerLoaded: false });
  await context.close();
});
it('returns authorized aggregates without identifiers and never labels sparse data healthy', async () => {
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((r) => r.cookie === null && r.referrer === null)).toBe(true);
  for (const body of measurements) {
    expect(Object.keys(body).sort()).toEqual([
      'device',
      'documentToken',
      'release',
      'route',
      'samples',
      'version',
    ]);
    expect(JSON.stringify(body)).not.toMatch(/private|cookie|referr|account|deliveryQuote/);
  }
  const report = await staff.query(api.qualityTelemetry.summary, {
    route: 'retail-home',
    device: 'mobile',
    release,
  });
  expect(report.visits).toBeGreaterThan(0);
  expect(report.metrics.every((metric) => metric.status === 'insufficient-data')).toBe(true);
  expect(JSON.stringify(report)).not.toMatch(/documentToken|samples/);
  await expect(
    t.query(api.qualityTelemetry.summary, { route: 'retail-home', device: 'mobile', release })
  ).rejects.toThrow();
  results.push({
    case: 'database and staff summary',
    visits: report.visits,
    credentialFree: true,
    anonymousAccessRejected: true,
    insufficientData: true,
  });
});
