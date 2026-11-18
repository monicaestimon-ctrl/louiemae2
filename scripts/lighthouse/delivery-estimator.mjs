/* global window, document, Event */
import path from 'node:path';
import { URL } from 'node:url';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
const built = await build({
  stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import Delivery from './components/delivery/ProductDeliveryEstimate';createRoot(document.getElementById('root')).render(<main><h1>Delivery estimate</h1><Delivery productId="fixture-product" variantId="fixture-variant" channel={window.fixtureChannel}/></main>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  outdir: 'tmp/delivery-matrix-build',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'read-only-fixtures',
      setup(b) {
        b.onResolve({ filter: /useRecoverableQuery$/ }, () => ({
          path: 'query',
          namespace: 'fixture',
        }));
        b.onResolve({ filter: /useDeliveryRequest$/ }, () => ({
          path: 'request',
          namespace: 'fixture',
        }));
        b.onResolve({ filter: /partnerLink$/ }, () => ({ path: 'visitor', namespace: 'fixture' }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (a) => ({
          loader: 'js',
          resolveDir: process.cwd(),
          contents: {
            query: `import{getFunctionName}from'convex/server';export function useRecoverableQuery(ref,args){const name=getFunctionName(ref);return {data:name==='dlvEstimates:enabled'?true:window.fixtureProfile,status:window.fixtureUnavailable?'unavailable':'ready',retry(){window.fixtureRetries=(window.fixtureRetries||0)+1}}}`,
            request: `export function useDeliveryRequest(operation){return async input=>{if(operation!=='estimate')throw Error('No business commands');window.fixtureCalls.push(input);if(window.fixtureHold)return new Promise(resolve=>window.fixtureResolve=resolve);if(window.fixtureError)throw Error('Synthetic unavailable service');return window.fixtureResponse}}`,
            visitor: `export const visitorId=()=> 'fixture-visitor';`,
          }[a.path],
        }));
      },
    },
  ],
});
const assetNames = await readdir('dist/assets');
const css = await readFile(
  'dist/assets/' + assetNames.find((x) => /^main-.*\.css$/.test(x)),
  'utf8'
);
const browser = await puppeteer.launch({
  headless: true,
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: 'chrome' }),
});
const results = [];
try {
  for (const width of [320, 390, 844, 1440])
    for (const scenario of [
      'parcel',
      'ltl',
      'alaska',
      'hawaii',
      'oversize',
      'invalid-zip',
      'invalid-packs',
      'unavailable',
      'project',
      'error',
      'stale',
      'pending-focus',
    ]) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 900 });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setRequestInterception(true);
      page.on('request', async (r) => {
        if (r.isNavigationRequest())
          return r.respond({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><html lang="en"><head><title>Delivery fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>',
          });
        try {
          const url = new URL(r.url());
          const root = path.resolve('public/fonts');
          const file = path.resolve('public', '.' + decodeURIComponent(url.pathname));
          if (
            url.origin === 'https://fixture.invalid' &&
            file.startsWith(root + path.sep) &&
            file.endsWith('.woff2')
          )
            return r.respond({
              status: 200,
              contentType: 'font/woff2',
              body: await readFile(file),
            });
        } catch {
          /* Unknown local assets remain blocked below. */
        }
        return r.abort();
      });
      await page.goto('https://fixture.invalid');
      await page.evaluate((s) => {
        window.fixtureCalls = [];
        window.fixtureChannel = s === 'project' ? 'trade' : 'retail';
        window.fixtureProfile =
          s === 'unavailable'
            ? null
            : s === 'project'
              ? { requiresProjectQuote: true }
              : { piecesPerPack: 2, minimumPacks: 2, incrementPacks: 2 };
        window.fixtureResponse = {
          status: ['alaska', 'hawaii', 'oversize'].includes(s) ? 'quote_required' : 'ok',
          deliveryChargeMinor: s === 'ltl' ? 19999 : 5999,
          serviceName: s === 'ltl' ? 'Curbside delivery' : 'Parcel delivery',
          serviceDetails: ['Service level is confirmed before payment.'],
          timingCaveat: 'Dispatch timing is confirmed separately.',
          expiresAt: Date.now() + 60000,
        };
        window.fixtureError = s === 'error';
        window.fixtureHold = ['stale', 'pending-focus'].includes(s);
      }, scenario);
      await page.addStyleTag({ content: css });
      for (const f of built.outputFiles.filter((f) => f.path.endsWith('.css')))
        await page.addStyleTag({ content: f.text });
      await page.addScriptTag({
        content: built.outputFiles.find((f) => f.path.endsWith('.js')).text,
      });
      await page.waitForSelector('main');
      if (!['unavailable', 'project'].includes(scenario)) {
        await page.waitForSelector('input[autocomplete="postal-code"]');
        const zip =
          scenario === 'invalid-zip'
            ? '12'
            : scenario === 'alaska'
              ? '99501'
              : scenario === 'hawaii'
                ? '96813'
                : '95206';
        await page.type('input[autocomplete="postal-code"]', zip);
        if (scenario === 'invalid-packs')
          await page.$eval('input[type=number]', (e) => {
            Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(
              e,
              '3'
            );
            e.dispatchEvent(new Event('input', { bubbles: true }));
          });
        await page.click('button[type=submit]');
        if (scenario === 'pending-focus') {
          await page.waitForFunction(() =>
            document.querySelector('button[type=submit]').textContent.includes('Estimating')
          );
          const focus = await page.evaluate(() => document.activeElement.tagName);
          console.log(JSON.stringify({ width, scenario, pendingFocus: focus }));
          {
            assert.equal(focus, 'BUTTON');
            await page.click('button[type=submit]');
            assert.equal(await page.evaluate(() => window.fixtureCalls.length), 1);
          }
          await page.evaluate(() => window.fixtureResolve(window.fixtureResponse));
          await page.waitForFunction(() => document.body.textContent.includes('$59.99'));
          const resolvedFocus = await page.evaluate(() => document.activeElement.tagName);
          console.log(JSON.stringify({ width, scenario, resolvedFocus }));
          assert.equal(resolvedFocus, 'BUTTON');
        } else if (['invalid-zip', 'invalid-packs', 'error'].includes(scenario)) {
          await page.waitForSelector('[role=alert]');
          assert.equal(
            await page.evaluate(() => document.activeElement.getAttribute('role')),
            'alert'
          );
          assert.equal(
            await page.evaluate(() => window.fixtureCalls.length),
            scenario === 'error' ? 1 : 0
          );
        } else if (scenario === 'stale') {
          await page.click('input[autocomplete="postal-code"]', { clickCount: 3 });
          await page.keyboard.press('Backspace');
          await page.type('input[autocomplete="postal-code"]', '10001');
          await page.evaluate(() => window.fixtureResolve(window.fixtureResponse));
          await page.waitForFunction(() => !document.body.textContent.includes('Estimating'));
          assert.equal(
            await page.evaluate(() => document.body.textContent.includes('$59.99')),
            false
          );
        } else {
          await page.waitForFunction(
            () =>
              document.body.textContent.includes('Request a delivery quote') ||
              document.body.textContent.includes('$')
          );
          const body = await page.evaluate(() => document.body.textContent);
          assert.ok(
            body.includes(
              ['alaska', 'hawaii', 'oversize'].includes(scenario)
                ? 'Request a delivery quote'
                : scenario === 'ltl'
                  ? '$199.99'
                  : '$59.99'
            )
          );
          assert.equal(await page.evaluate(() => window.fixtureCalls.length), 1);
          if (['alaska', 'hawaii', 'oversize'].includes(scenario)) {
            await page.evaluate(() =>
              Array.from(document.querySelectorAll('button'))
                .find((e) => e.textContent === 'Request a delivery quote')
                .click()
            );
            await page.waitForSelector('input[type=email]');
            assert.equal(await page.$$('form form').then((n) => n.length), 0);
          }
        }
      } else {
        await page.waitForFunction(
          () =>
            document.body.textContent.includes('currently unavailable') ||
            document.body.textContent.includes('Add this item to your project')
        );
        assert.equal(await page.evaluate(() => window.fixtureCalls.length), 0);
      }
      const fonts = await page.evaluate(async () => {
        await document.fonts.ready;
        return Array.from(document.fonts)
          .filter((f) => f.status === 'loaded')
          .map((f) => f.family);
      });
      assert.ok(fonts.length, 'Actual storefront fonts must load');
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(async () =>
        (await window.axe.run(document.querySelector('main'))).violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        }))
      );
      assert.deepEqual(violations, [], JSON.stringify({ width, scenario, violations }));
      assert.deepEqual(errors, []);
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        `${width}/${scenario} overflow`
      );
      results.push({ width, scenario, violations, errors, fonts });
      await page.close();
    }
  await writeFile(
    'artifacts/lighthouse/delivery-estimator-browser.json',
    JSON.stringify(
      {
        scope:
          'Actual product estimator and quote form with storefront CSS/fonts; synthetic read-only query/estimate responses; no quote submission, carrier-rate, production eligibility or payment verification',
        results,
      },
      null,
      2
    )
  );
  console.log(results.length + ' cases passed');
} finally {
  await browser.close();
}
