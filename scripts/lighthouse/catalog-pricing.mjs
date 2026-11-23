/* global document, window, innerWidth */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
const out = 'artifacts/lighthouse/catalog-pricing';
await mkdir(out, { recursive: true });
const css = (await readdir('dist/assets')).filter(
  (x) => x.endsWith('.css') && (x.startsWith('main-') || x.startsWith('AdminPage-'))
);
assert.ok(css.length);
const data = {
  reviewHash: 'a'.repeat(64),
  canApprove: true,
  name: 'Fixture bench',
  supplierCode: 'ashcroft',
  category: 'furniture',
  variant: {
    _id: 'variant',
    productId: 'product',
    supplierSku: 'FIXTURE',
    marginPolicyKey: 'ashcroft-20',
    referralEligible: false,
  },
  cost: {
    wholesaleMinor: 30000,
    wholesaleUnitBasis: 'selling_unit',
    mapApplicability: 'not_applicable',
  },
  prices: { retail: { packPriceMinor: 80000 }, trade: { packPriceMinor: 60000 } },
  published: [{ channel: 'retail', published: true, pricingMode: 'legacy', amountMinor: 50000 }],
  policies: [{ key: 'ashcroft-20', targetBps: 2000, eligible: true, requiresDocumentRef: false }],
  economics: {
    ok: true,
    result: {
      minimumRetailMinor: 70000,
      minimumBaseTradeMinor: 55000,
      scenarios: [
        {
          name: 'retail_direct',
          priceMinor: 80000,
          contributionMinor: 20000,
          contributionBps: 2500,
          passes: true,
        },
      ],
    },
  },
  freshness: { ok: true, result: { availability: 'in_stock', holds: [] } },
  commission: {
    ok: true,
    rates: ['base', 'active', 'top', 'elite'].map((tierKey) => ({ tierKey, rateBps: 1000 })),
  },
  exceptions: [],
  exceptionHistoryTruncated: false,
};
const entry = `import React from'react';import{createRoot}from'react-dom/client';import Panel from'./components/admin/CatalogPricingReview';window.commands=[];window.fixtureData=${JSON.stringify(data)};const root=createRoot(document.getElementById('root'));window.refresh=()=>root.render(<main><h1>SKU approval fixture</h1><Panel variantId="variant"/></main>);window.refresh();`;
const stub = `import{getFunctionName}from'convex/server';export const useQuery=()=>window.fixtureData;export const useMutation=ref=>async args=>{window.commands.push({name:getFunctionName(ref),args});return'fixture-saved'};`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true,
  write: false,
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'fixture',
      setup(b) {
        b.onResolve({ filter: /^convex\/react$/ }, () => ({
          path: 'convex',
          namespace: 'fixture',
        }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: stub,
          loader: 'js',
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});
const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: 'chrome' }),
  headless: true,
  args: ['--no-sandbox'],
});
const results = [];
try {
  for (const width of [320, 844, 1440]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request', (r) =>
      r.isNavigationRequest()
        ? r.respond({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><html lang="en"><head><title>Local pricing review</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>',
          })
        : r.abort()
    );
    await page.goto('http://127.0.0.1');
    for (const f of css)
      await page.addStyleTag({ content: await readFile('dist/assets/' + f, 'utf8') });
    await page.addStyleTag({
      content:
        'body{font-family:Arial,sans-serif;background:white;color:#222}main{max-width:960px;margin:auto;padding:8px}h1{font-size:24px}',
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForSelector('textarea');
    await page.click('summary');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1
    );
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () =>
      (
        await axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
        })
      ).violations.map((v) => ({ id: v.id, impact: v.impact }))
    );
    await page.screenshot({ path: out + '/' + width + '.png', fullPage: true });
    await page.focus('textarea');
    await page.keyboard.type('Reviewed fixture supplier evidence');
    await page.evaluate(() =>
      [...document.querySelectorAll('label')]
        .find((l) => l.textContent.includes('Final merchandise price'))
        .querySelector('input')
        .focus()
    );
    await page.keyboard.type('850.25');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.commands.length === 1);
    const command = await page.evaluate(() => window.commands[0]);
    assert.equal(command.name, 'catPricing:approvePrice');
    assert.equal(command.args.packPriceMinor, 85025);
    assert.equal(command.args.expectedReviewHash, 'a'.repeat(64));
    await page.evaluate(() => {
      window.fixtureData = { ...window.fixtureData, reviewHash: 'b'.repeat(64) };
      window.refresh();
    });
    await page.waitForFunction(() =>
      document.querySelector('[role="alert"]')?.textContent.includes('changed while')
    );
    assert.equal(
      await page.evaluate(() =>
        [...document.querySelectorAll('button')]
          .find((b) => b.textContent === 'Approve final price')
          .matches(':disabled')
      ),
      true
    );
    assert.equal(errors.length, 0);
    assert.equal(overflow, false);
    assert.deepEqual(violations, []);
    results.push({
      width,
      overflow,
      violations,
      pageErrors: errors,
      keyboardSubmit: true,
      staleApprovalBlocked: true,
      mockedCommands: 1,
    });
    await page.close();
  }
} finally {
  await browser.close();
  await writeFile(
    out + '/report.json',
    JSON.stringify(
      {
        scope: 'Local isolated component fixture; no production APIs, orders or payment calls',
        results,
      },
      null,
      2
    )
  );
}
console.log(JSON.stringify(results));
