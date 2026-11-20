/* global document, window */
import puppeteer from 'puppeteer-core';
import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// All supplier/auth/request boundaries are local fixtures. Never submit a payment or real quote.
const stubs = {
  useRecoverableQuery: `import{getFunctionName}from'convex/server';export function useRecoverableQuery(q){return{status:'ready',data:getFunctionName(q).endsWith(':enabled')?true:{piecesPerPack:2,minimumPacks:3,incrementPacks:2},retry(){}}}`,
  useDeliveryRequest: `export function useDeliveryRequest(){return async()=>{window.fixtureRequests=(window.fixtureRequests||0)+1;return{status:'ok',deliveryChargeMinor:5999,serviceName:'Fixture delivery',timingCaveat:'Fixture only',expiresAt:Date.now()+60000}}}`,
  DeliveryQuoteStatus: `export default function Status(){return null}`,
  CartContext: `export function useCart(){return{items:[]}}`,
  auth: `export function useAuthToken(){return null}`,
  convex: `export function useQuery(){return undefined}`,
};
const bundle = await build({
  stdin: {
    contents: `import React from'react';import{createRoot}from'react-dom/client';import Product from'./components/delivery/ProductDeliveryEstimate';import{DeliveryCheckout}from'./components/delivery/CheckoutV2';createRoot(document.getElementById('root')).render(<main><h1>Delivery form fixture</h1><section id="product"><h2>Product estimate</h2><Product productId="fixture" variantId="fixture"/></section><section id="checkout"><h2>Delivery address</h2><DeliveryCheckout lines={[]}/></section></main>)`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  outdir: 'artifacts/lighthouse/form-fixture',
  write: false,
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.VITE_CONVEX_URL': '""' },
  plugins: [
    {
      name: 'local-boundaries',
      setup(b) {
        b.onResolve(
          { filter: /\/(useRecoverableQuery|useDeliveryRequest|DeliveryQuoteStatus|CartContext)$/ },
          (a) => ({ path: a.path.split('/').pop(), namespace: 'fixture' })
        );
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
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});
await mkdir('artifacts/lighthouse', { recursive: true });
const assets = await readdir('dist/assets');
const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: 'chrome' }),
  headless: true,
});
const results = [];
try {
  for (const storefront of ['main', 'trade'])
    for (const [width, height] of [
      [320, 900],
      [844, 390],
      [1440, 900],
    ]) {
      const page = await browser.newPage();
      await page.setViewport({ width, height });
      // A fixture-only CSP prevents accidental connections, including checkout, quote and image requests.
      await page.setContent(
        '<!doctype html><html lang="en"><head><meta http-equiv="Content-Security-Policy" content="connect-src \'none\'; img-src data:"><title>Delivery verification</title></head><body><div id="root"></div></body></html>'
      );
      await page.addStyleTag({
        content: await readFile(
          'dist/assets/' + assets.find((f) => f.startsWith(storefront + '-') && f.endsWith('.css')),
          'utf8'
        ),
      });
      for (const file of bundle.outputFiles.filter((f) => f.path.endsWith('.css')))
        await page.addStyleTag({ content: file.text });
      await page.addStyleTag({
        content:
          'body{margin:0;background:#fff}main{padding:16px;max-width:700px}section{margin-bottom:32px}',
      });
      await page.addScriptTag({
        content: bundle.outputFiles.find((f) => f.path.endsWith('.js')).text,
      });
      await page.waitForSelector('#product form');
      await page.click('#product button[type=submit]');
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('role')), 'alert');
      assert.equal(await page.evaluate(() => window.fixtureRequests || 0), 0);
      await page.type('#product input[inputmode=numeric]', '95206');
      await page.click('#product button[type=submit]');
      await page.waitForFunction(() =>
        document.querySelector('#product').textContent.includes('Fixture delivery: $59.99')
      );
      assert.equal(
        await page.evaluate(() => document.activeElement.textContent),
        'Estimate delivery'
      );
      await page.click('#checkout button[type=submit]');
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('role')), 'alert');
      await page.click('#checkout [role=alert] a');
      assert.equal(await page.evaluate(() => document.activeElement.autocomplete), 'name');
      const metrics = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        fields: [...document.querySelectorAll('input:not([type=checkbox]),select')].every(
          (e) => e.getBoundingClientRect().height >= 44
        ),
        requests: window.fixtureRequests,
      }));
      assert.equal(metrics.overflow, false);
      assert.equal(metrics.fields, true);
      assert.equal(metrics.requests, 1);
      await page.screenshot({
        path: `artifacts/lighthouse/forms-${storefront}-${width}.png`,
        fullPage: true,
      });
      results.push({
        storefront,
        width,
        height,
        ...metrics,
        validationFocus: true,
        resultPreservesFocus: true,
      });
      await page.close();
    }
  await writeFile(
    'artifacts/lighthouse/delivery-forms-browser.json',
    JSON.stringify(
      {
        scope:
          'Local mocked estimate and address validation; no financial actions or live requests',
        results,
      },
      null,
      2
    )
  );
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
