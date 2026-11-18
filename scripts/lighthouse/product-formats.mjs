/* global document */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { URL, pathToFileURL } from 'node:url';
const directory = 'artifacts/lighthouse/product-formats';
await mkdir(directory, { recursive: true });
const provenance = JSON.parse(await readFile('docs/quality/product-format-provenance.json', 'utf8'))
  .records[0];
const product = {
  _id: 'fixture-product',
  name: 'Bramwell Brown Leather Sofa',
  description: 'Isolated product image handoff fixture.',
  category: 'Sofas',
  price: 1800,
  images: [provenance.source],
  inStock: false,
  fulfillmentProvider: 'ashcroft',
};
const serverBuild = await build({
  stdin: {
    contents: "export{productDocument}from'./lib/serverProductDocument';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  plugins: [],
});
await writeFile(directory + '/render.mjs', serverBuild.outputFiles[0].text);
const { productDocument } = await import(
  pathToFileURL(path.resolve(directory + '/render.mjs')).href
);
const client = await build({
  stdin: {
    contents:
      "import React from'react';import{createRoot}from'react-dom/client';import{ProductPage}from'./components/ProductPage';createRoot(document.getElementById('root')).render(<ProductPage id=\"fixture-product\"/>);",
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  outdir: 'tmp/product-handoff-build',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  plugins: [
    {
      name: 'read-only-product',
      setup(b) {
        b.onResolve({ filter: /useStorefrontProductDetail$/ }, () => ({
          path: 'detail',
          namespace: 'fixture',
        }));
        b.onResolve({ filter: /AddToCartButton$/ }, () => ({ path: 'cart', namespace: 'fixture' }));
        b.onResolve({ filter: /ProductDeliveryEstimate$/ }, () => ({
          path: 'delivery',
          namespace: 'fixture',
        }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (a) => ({
          loader: 'js',
          contents:
            a.path === 'detail'
              ? 'export const useStorefrontProductDetail=()=>({product:window.fixtureProduct,loading:false,failed:false,retry(){}})'
              : a.path === 'cart'
                ? 'export const AddToCartButton=()=>null'
                : 'export default ()=>null',
        }));
      },
    },
  ],
});
const vite = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
const css = await readFile('dist/' + vite['index.html'].css[0], 'utf8');
const template = `<!doctype html><html lang="en"><head><title>Product image fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><!--product-document--><div id="root"></div><script src="/client.js"></script></body></html>`;
let mode = 'normal',
  phase = 'server';
let trace = [];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://fixture.invalid');
    if (url.pathname === '/product') {
      const item = { ...product, images: mode === 'empty' ? [] : product.images };
      let html = productDocument(template, item);
      html = html.replace(
        '<script src="/client.js">',
        `<script>window.fixtureProduct=${JSON.stringify(item).replaceAll('<', '\\u003c')}</script><script src="/client.js">`
      );
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(html);
    }
    if (url.pathname === '/client.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(client.outputFiles.find((f) => f.path.endsWith('.js')).text);
    }
    const image = /\.(avif|webp|svg)$/.test(url.pathname);
    const fail =
      url.pathname.startsWith('/api/download-image') ||
      (mode === 'allFailed' && /\.(avif|webp)$/.test(url.pathname)) ||
      (mode === 'avif404' && url.pathname.endsWith('.avif'));
    if (fail) {
      if (image) trace.push({ path: url.pathname, phase, status: 404 });
      res.writeHead(404);
      return res.end();
    }
    if (mode === 'corrupt' && url.pathname.endsWith('.avif')) {
      trace.push({ path: url.pathname, phase, status: 200, corrupt: true });
      res.writeHead(200, { 'Content-Type': 'image/avif' });
      return res.end('invalid-avif');
    }
    const root = path.resolve('public');
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    const bytes = await readFile(file);
    if (image) trace.push({ path: url.pathname, phase, status: 200 });
    res.writeHead(200, {
      'Content-Type': file.endsWith('.avif')
        ? 'image/avif'
        : file.endsWith('.webp')
          ? 'image/webp'
          : file.endsWith('.woff2')
            ? 'font/woff2'
            : 'image/svg+xml',
      'Cache-Control': 'public,max-age=86400',
    });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const browser = await puppeteer.launch({
  headless: true,
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: 'chrome' }),
});
const results = [];
try {
  for (const width of [390, 844, 1440])
    for (mode of ['normal', 'disabled', 'avif404', 'corrupt', 'allFailed', 'nojs', 'empty']) {
      trace = [];
      phase = 'server';
      const page = await browser.newPage();
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1.75 });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      let held;
      await page.setRequestInterception(true);
      page.on('request', (r) => {
        if (new URL(r.url()).pathname === '/client.js') {
          held = r;
          return;
        }
        void r.continue();
      });
      const cdp = await page.createCDPSession();
      await cdp.send('Network.clearBrowserCache');
      if (mode === 'disabled')
        await cdp.send('Emulation.setDisabledImageTypes', { imageTypes: ['avif'] });
      if (mode === 'nojs') await page.setJavaScriptEnabled(false);
      const navigation = page.goto(`http://127.0.0.1:${server.address().port}/product`, {
        waitUntil: 'networkidle0',
      });
      await page.waitForSelector('#lm-product-document img');
      await page.waitForFunction(
        () => document.querySelector('#lm-product-document img')?.complete
      );
      const first = await page.$eval('#lm-product-document img', (i) => ({
        src: i.currentSrc,
        width: i.getBoundingClientRect().width,
        height: i.getBoundingClientRect().height,
        sizes: i.sizes,
      }));
      if (mode !== 'nojs') {
        await page.waitForFunction(() => !!document.querySelector('script[src="/client.js"]'));
        assert.ok(held);
        phase = 'client';
        await held.continue();
      }
      await navigation;
      const selector = mode === 'nojs' ? '#lm-product-document img' : '#root img';
      await page.waitForFunction(
        (selector) => {
          const i = document.querySelector(selector);
          return i?.complete && i.naturalWidth > 0;
        },
        {},
        selector
      );
      const last = await page.$eval(selector, (i) => ({
        src: i.currentSrc,
        width: i.getBoundingClientRect().width,
        height: i.getBoundingClientRect().height,
        sizes: i.sizes,
      }));
      await writeFile(
        directory + '/handoff-last-state.json',
        JSON.stringify({ width, mode, first, last, trace, errors }, null, 2)
      );
      const expected =
        mode === 'normal' ? '.avif' : ['allFailed', 'empty'].includes(mode) ? '.svg' : '.webp';
      assert.ok(last.src.endsWith(expected), JSON.stringify({ mode, last }));
      assert.ok(
        Math.abs(first.width - last.width) <= 1 && Math.abs(first.height - last.height) <= 1,
        JSON.stringify({ width, mode, first, last })
      );
      if (['normal', 'disabled', 'nojs'].includes(mode))
        assert.equal(
          trace.filter((t) => t.status === 200 && /\.(avif|webp)$/.test(t.path)).length,
          1,
          'One healthy image request across preload/server/client'
        );
      if (mode === 'nojs' || mode === 'disabled')
        assert.equal(trace.filter((t) => t.path.endsWith('.avif')).length, 0);
      assert.deepEqual(errors, []);
      results.push({ width, mode, first, last, trace: [...trace], errors });
      await page.close();
    }
  await writeFile(
    'artifacts/lighthouse/product-formats-browser.json',
    JSON.stringify(
      {
        scope:
          'Actual ProductPage/SafeImage/server document and source-bound files; synthetic read-only product and disabled commerce boundary; not production verification',
        results,
      },
      null,
      2
    )
  );
  console.log(results.length + ' handoff cases passed');
} finally {
  await browser.close();
  server.close();
}
