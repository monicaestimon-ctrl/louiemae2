/* global document, window, axe */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import axeCore from 'axe-core';

// Exercise the actual admin component with local-only query/mutation fixtures.
// No credentials, production connection, publication or financial activity.
const assets = await readdir('dist/assets');
const css = assets.find((f) => f.startsWith('main-') && f.endsWith('.css'));
assert.ok(css, 'Build production assets first');
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import Review from './components/admin/CatalogPublicationReview';createRoot(document.getElementById('root')).render(<main><h1>Catalog review</h1><Review/></main>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'local-catalog',
      setup(b) {
        b.onResolve({ filter: /^convex\/react$/ }, () => ({
          path: 'catalog',
          namespace: 'fixture',
        }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          loader: 'js',
          resolveDir: process.cwd(),
          contents: `
      import {getFunctionName} from 'convex/server';
      export function useQuery(ref,args){return {stockExcluded:args.productId==='restock',stage:args.productId==='restock'?'imported_draft':'ready',holds:[],gates:{ready:[]},variants:[{id:'variant',sku:'CHAIR',availability:'in_stock',holds:[]}]}}
      export function usePaginatedQuery(){return {status:'Exhausted',results:[{productId:'one',name:'Reviewed chair',stage:'ready',included:true},{productId:'restock',name:'Restocked chair',stage:'imported_draft',included:false,stockExcluded:true}],loadMore(){}}}
      export function useMutation(ref){return async args=>{window.fixtureCalls.push({name:getFunctionName(ref),args});if(window.fixtureReject)throw Error('Local rejection');return null}}
    `,
        }));
      },
    },
  ],
});
await mkdir('artifacts/lighthouse', { recursive: true });
const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: 'chrome' }),
  headless: true,
});
const results = [];
try {
  for (const width of [390, 844, 1440]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900 });
    await page.setContent(
      `<!doctype html><html lang="en"><head><title>Catalog review verification</title><meta http-equiv="Content-Security-Policy" content="connect-src 'none'"></head><body><div id="root"></div></body></html>`
    );
    await page.evaluate(() => {
      window.fixtureCalls = [];
      window.fixtureReject = false;
    });
    await page.addStyleTag({ content: await readFile('dist/assets/' + css, 'utf8') });
    await page.addStyleTag({
      content: 'body{margin:0;background:#fff}main{padding:16px;max-width:1000px}',
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const click = async (text) => {
      const handle = await page.waitForFunction(
        (text) =>
          [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === text),
        {},
        text
      );
      await handle.asElement().click();
      await handle.dispose();
    };
    await click('Product review and publication');
    await click('Reviewed chair · ready');
    assert.equal(
      await page.evaluate(
        () =>
          [...document.querySelectorAll('button')].find(
            (e) => e.textContent === 'Publish reviewed product'
          ).disabled
      ),
      true
    );
    await page.click('input[type=checkbox]');
    await click('Verify retail and HOLM identity');
    await page.waitForFunction(() =>
      document.querySelector('[role=status]')?.textContent.startsWith('Product identity verified')
    );
    assert.deepEqual(await page.evaluate(() => window.fixtureCalls[0]), {
      name: 'catPublication:verifyCanonicalIdentity',
      args: { productId: 'one', variantIds: ['variant'] },
    });
    await page.type('textarea', 'Reviewed exact supplier SKU, pack and current source evidence.');
    await click('Complete manual review');
    await page.waitForFunction(() =>
      document.querySelector('[role=status]')?.textContent.includes('No product was published')
    );
    assert.equal(await page.evaluate(() => window.fixtureCalls.length), 2);
    const boxes = await page.$$('input[type=checkbox]');
    await boxes[1].click();
    await boxes[2].click();
    await click('Publish reviewed product');
    await page.waitForFunction(() =>
      document.querySelector('[role=status]')?.textContent.startsWith('Published to')
    );
    assert.deepEqual(await page.evaluate(() => window.fixtureCalls[2]), {
      name: 'catPublication:publish',
      args: { productIds: ['one'], channels: ['retail', 'house'] },
    });
    await page.evaluate(() => {
      window.fixtureReject = true;
    });
    await click('Publish reviewed product');
    await page.waitForSelector('[role=alert]');
    await page.evaluate(() => {
      window.fixtureReject = false;
    });
    await click('Restocked chair · imported_draft');
    assert.equal(
      await page.evaluate(
        () =>
          [...document.querySelectorAll('button')].find(
            (e) => e.textContent.trim() === 'Restore verified restock to draft review'
          ).disabled
      ),
      true
    );
    await page.click('input[type=checkbox]');
    await page.type('textarea', 'Current available-to-sell revision and exact pack reviewed.');
    assert.equal(
      await page.evaluate(() =>
        [
          'Verify retail and HOLM identity',
          'Complete manual review',
          'Advance to evidence review',
        ].every(
          (text) =>
            [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === text)
              ?.disabled
        )
      ),
      true
    );
    await click('Restore verified restock to draft review');
    await page.waitForFunction(() =>
      document.querySelector('[role=status]')?.textContent.includes('Nothing was published')
    );
    assert.deepEqual(await page.evaluate(() => window.fixtureCalls.at(-1)), {
      name: 'catPublication:restoreStockExcludedDraft',
      args: {
        productId: 'restock',
        variantIds: ['variant'],
        reason: 'Current available-to-sell revision and exact pack reviewed.',
      },
    });
    assert.equal(
      await page.evaluate(
        () =>
          [...document.querySelectorAll('button')].find(
            (e) => e.textContent.trim() === 'Publish reviewed product'
          ).disabled
      ),
      true
    );
    await page.addScriptTag({ content: axeCore.source });
    const violations = await page.evaluate(async () =>
      (await axe.run(document.querySelector('main'))).violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target),
      }))
    );
    assert.deepEqual(violations, [], JSON.stringify(violations));
    assert.equal(
      await page.evaluate(() =>
        [...document.querySelectorAll('button, summary, label:has(input[type=checkbox])')].every(
          (e) => e.getBoundingClientRect().height >= 44
        )
      ),
      true,
      'Controls need 44px touch targets'
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false
    );
    await page.screenshot({
      path: `artifacts/lighthouse/catalog-publication-${width}.png`,
      fullPage: true,
    });
    results.push({
      width,
      violations,
      explicitSelection: true,
      errorAnnounced: true,
      overflow: false,
    });
    await page.close();
  }
  await writeFile(
    'artifacts/lighthouse/catalog-publication-browser.json',
    JSON.stringify(
      {
        scope:
          'Local actual component with mocked catalog; network blocked, no production authentication or writes',
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
