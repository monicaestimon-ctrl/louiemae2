/* global document, window, localStorage */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import assert from 'node:assert/strict';
const stubs = {
  auth: 'export function useAuthToken(){return null}',
  convex:
    'export function useQuery(){return undefined} export function useQueries(){return {}} export function useMutation(){return()=>{throw Error("Unexpected fixture mutation")}}',
};
const fixture = await build({
  stdin: {
    contents: `import React from'react';import{createRoot}from'react-dom/client';import{CartProvider,useCart}from'./contexts/CartContext';import{LazyCartDrawer}from'./components/cart/LazyCartDrawer';function Controls(){const cart=useCart();return <main><h1>Cart loading verification</h1><button id="open" onClick={cart.openCart}>Open cart</button><output id="count">{cart.itemCount}</output><LazyCartDrawer/></main>}createRoot(document.getElementById('root')).render(<CartProvider><Controls/></CartProvider>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  splitting: true,
  format: 'esm',
  outdir: 'artifacts/lighthouse/cart-fixture',
  write: false,
  metafile: true,
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.VITE_CONVEX_URL': '""' },
  plugins: [
    {
      name: 'local-boundaries',
      setup(b) {
        b.onResolve({ filter: /^@convex-dev\/auth\/react$/ }, () => ({
          path: 'auth',
          namespace: 'fixture',
        }));
        b.onResolve({ filter: /^convex\/react$/ }, () => ({
          path: 'convex',
          namespace: 'fixture',
        }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (a) => ({
          contents: stubs[a.path],
          loader: 'js',
        }));
        b.onLoad({ filter: /[\\/]cart[\\/]CartDrawer\.tsx$/ }, async (a) => ({
          contents:
            'window.fixtureDrawerEvaluations=(window.fixtureDrawerEvaluations||0)+1;\n' +
            (await readFile(a.path, 'utf8')),
          loader: 'tsx',
        }));
      },
    },
  ],
});
const outputs = new Map(fixture.outputFiles.map((f) => ['/' + basename(f.path), f.text]));
const drawer =
  '/' +
  basename(
    Object.entries(fixture.metafile.outputs).find(([, v]) =>
      v.entryPoint?.endsWith('/CartDrawer.tsx')
    )[0]
  );
const assets = await readdir('dist/assets');
const css = await readFile(
  'dist/assets/' + assets.find((f) => f.startsWith('main-') && f.endsWith('.css')),
  'utf8'
);
const styles = [
  css,
  ...fixture.outputFiles.filter((f) => f.path.endsWith('.css')).map((f) => f.text),
].join('\n');
let mode = 'held',
  held = [],
  drawerRequests = 0,
  commands = 0;
const server = createServer((req, res) => {
  if (req.method !== 'GET') {
    commands++;
    res.writeHead(405).end();
    return;
  }
  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<!doctype html><html lang="en"><head><title>Cart verification</title><meta http-equiv="Content-Security-Policy" content="connect-src \'none\'; img-src data:"><style>' +
        styles +
        '</style></head><body><div id="root"></div><script type="module" src="/stdin.js"></script></body></html>'
    );
    return;
  }
  const body = outputs.get(req.url);
  if (body !== undefined) {
    if (req.url === drawer) {
      drawerRequests++;
      if (mode === 'failed') {
        res.writeHead(503).end();
        return;
      }
      if (mode === 'held') {
        held.push(() => {
          res.setHeader('Content-Type', 'text/javascript');
          res.end(body);
        });
        return;
      }
    }
    res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.end(body);
    return;
  }
  res.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: 'chrome' }),
  headless: true,
});
const results = [];
await mkdir('artifacts/lighthouse', { recursive: true });
try {
  for (const scenario of ['held', 'failed']) {
    mode = scenario;
    drawerRequests = 0;
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844 });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem(
        'louiemae_ashcroft_cart_v1',
        JSON.stringify([
          {
            product: {
              id: 'fixture',
              name: 'Fixture chair',
              price: 100,
              category: 'Furniture',
              images: [],
              fulfillmentProvider: 'zuo',
              variants: [{ id: 'fixture-variant', name: 'Standard' }],
            },
            quantity: 2,
          },
        ])
      );
    });
    await page.goto(origin, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#open');
    assert.equal(drawerRequests, 0);
    assert.equal(await page.evaluate(() => window.fixtureDrawerEvaluations || 0), 0);
    await page.click('#open');
    await page.waitForSelector('dialog[open]', { visible: true });
    if (scenario === 'held') {
      await page.waitForFunction(() =>
        document.querySelector('[role=status]')?.textContent.includes('Opening your cart')
      );
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));
      assert.equal(await page.evaluate(() => document.activeElement.id), 'open');
      mode = 'ready';
      held.splice(0).forEach((send) => send());
      await page.waitForFunction(() => window.fixtureDrawerEvaluations === 1);
      assert.equal(await page.$('dialog[open]'), null);
      await page.click('#open');
      await page.waitForSelector('input[autocomplete=name]');
      await page.type('input[autocomplete=name]', 'Retained customer');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));
      await page.click('#open');
      await page.waitForSelector('input[autocomplete=name]');
      assert.equal(
        await page.$eval('input[autocomplete=name]', (n) => n.value),
        'Retained customer'
      );
      assert.equal(drawerRequests, 1);
      assert.equal(await page.evaluate(() => document.body.textContent.includes('Pay $')), false);
    } else {
      await page.waitForSelector('[role=alert]', { visible: true });
      assert.match(await page.$eval('[role=alert]', (n) => n.textContent), /could not be opened/);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));
      assert.equal(await page.evaluate(() => document.activeElement.id), 'open');
    }
    assert.equal(await page.$eval('#count', (n) => n.textContent), '2');
    assert.equal(commands, 0);
    results.push({
      scenario,
      deferredUntilIntent: true,
      requests: drawerRequests,
      cartRetained: true,
      commands,
    });
    await page.screenshot({ path: `artifacts/lighthouse/lazy-cart-${scenario}.png` });
    await page.close();
  }
  await writeFile(
    'artifacts/lighthouse/lazy-cart-browser.json',
    JSON.stringify(
      {
        scope:
          'Actual cart components, synthetic data/auth boundaries; no estimate, payment or production commands',
        results,
      },
      null,
      2
    )
  );
  console.log(JSON.stringify(results));
} finally {
  held.splice(0).forEach((send) => send());
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
