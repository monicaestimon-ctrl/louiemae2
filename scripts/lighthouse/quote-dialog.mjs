/* global document, window, location, localStorage, setTimeout */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
const assets = await readdir('dist/assets').catch((cause) => {
  throw new Error('Missing production assets. Run npm run build first.', { cause });
});
const css = assets.find((file) => /^trade-.*\.css$/.test(file));
assert.ok(css, 'Missing trade stylesheet. Run npm run build first.');
const stubs = {
  auth: `export const useAuthActions=()=>({signIn:async()=>{throw Error('No auth permitted')},signOut:async()=>{throw Error('No auth permitted')}});export const useAuthToken=()=>null;`,
  convex: `import{getFunctionName}from'convex/server';export const useQuery=(ref)=>getFunctionName(ref)==='holm:me'?{signedIn:true,verified:true,admin:false,tradeStatus:'approved',businessName:'',email:''}:undefined;export const useQueries=q=>Object.fromEntries(Object.keys(q).map(k=>[k,undefined]));export const useMutation=ref=>async()=>{if(getFunctionName(ref)==='holm:ensureProfile')return null;window.fixtureCommands=(window.fixtureCommands||0)+1;return new Promise((_,reject)=>{window.rejectFixtureQuote=()=>reject(Error('Local quote fixture rejection'))})};export const usePaginatedQuery=()=>({results:[],status:'Exhausted',loadMore(){}});export const useAction=useMutation;export const useConvexAuth=()=>({isLoading:false,isAuthenticated:false});`,
};
const entry = `import React from'react';import{createRoot}from'react-dom/client';import{App,setProducts}from'./trade/app';const image='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';const products=Array.from({length:24},(_,i)=>({id:i+1,lid:'fixture'+i,vid:'fixture'+i,variants:[],name:'Fixture '+(i+1),full:'Fixture '+(i+1),line:'Chair',type:'sofa',mat:'leather',tone:'#6B4A33',price:100,trade:80,seats:1,oos:false,note:'Fixture only',facts:'',img:image,imgs:[image],ar:1,sku:'FIXTURE',likes:0,widthCm:50,dimsCm:{w:50,d:50,h:50},dimsSource:'fixture',cutout:null,cutAR:null,model:null,modelLow:null,hangs:false,mountCm:null,minimum:1,increment:1,checkoutMode:'quote'}));setProducts(products);createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true,
  outdir: 'artifacts/lighthouse/full-trade-fixture',
  write: false,
  format: 'iife',
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env': '{}',
    'import.meta.url': '"http://fixture.invalid/module.js"',
  },
  plugins: [
    {
      name: 'fixture',
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
          resolveDir: process.cwd(),
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
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewport({ width: 390, height: 844 });
  const markup =
    '<!doctype html><html lang="en"><head><title>HOLM integration fixture</title><meta http-equiv="Content-Security-Policy" content="connect-src \'none\';img-src data:"></head><body><div id="root"></div></body></html>';
  await page.setRequestInterception(true);
  page.on('request', (request) =>
    request.isNavigationRequest()
      ? request.respond({ status: 200, contentType: 'text/html', body: markup })
      : request.abort()
  );
  await page.goto('http://fixture.invalid');
  await page.evaluate(() => {
    location.hash = 'discover';
    localStorage.setItem(
      'hol:inspo',
      JSON.stringify([
        {
          id: 'fixture-inspo',
          title: 'Fixture inspiration',
          src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
          ar: 1,
          pal: ['#6B4A33'],
          source: 'upload',
        },
      ])
    );
  });
  await page.addStyleTag({ content: await readFile('dist/assets/' + css, 'utf8') });
  for (const f of bundle.outputFiles.filter((f) => f.path.endsWith('.css')))
    await page.addStyleTag({ content: f.text });
  await page.addStyleTag({ content: await readFile('trade/style.css', 'utf8') });
  await page.addScriptTag({ content: bundle.outputFiles.find((f) => f.path.endsWith('.js')).text });
  await page.waitForSelector('.pin-open');
  await page.addScriptTag({ content: axe.source });
  const results = [];
  for (const [width, height] of [
    [320, 900],
    [844, 390],
    [1440, 900],
  ]) {
    await page.setViewport({ width, height });
    await page.click('.pin-open');
    await page.waitForSelector('.pp-add');
    await page.click('.pp-add');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog'));
    await page.click('[aria-label="Open project tray"]');
    await page.waitForSelector('.tv-quote');
    await page.evaluate(async () =>
      Promise.allSettled(
        document
          .querySelector('.tv')
          .getAnimations()
          .map((animation) => animation.finished)
      )
    );
    await page.evaluate(() => localStorage.removeItem('hol:qset'));
    await page.click('.tv-quote');
    await page.waitForSelector('dialog[aria-label="Create a client quote"]');
    await page.evaluate(async () =>
      Promise.allSettled(
        document
          .querySelector('.qc')
          .getAnimations()
          .map((animation) => animation.finished)
      )
    );
    const before = await page.evaluate(() => window.fixtureCommands || 0);
    await page.click('.qc-cta');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('role')), 'alert');
    assert.equal(await page.evaluate(() => window.fixtureCommands || 0), before);
    assert.equal(await page.$$eval('[role=alert] a', (nodes) => nodes.length), 3);
    await page.click('[role=alert] a');
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'INPUT');
    for (const [label, value] of [
      ['Prepared for', 'Fixture client'],
      ['Studio name', 'Fixture studio'],
      ['Send approvals to', 'fixture@example.com'],
    ]) {
      const id = await page.evaluate(
        (label) =>
          [...document.querySelectorAll('.qc label')].find((el) => el.textContent === label)
            .htmlFor,
        label
      );
      await page.type(`[id="${id}"]`, value);
    }
    await page.click('.qc-cta');
    await page.waitForFunction((before) => window.fixtureCommands === before + 1, {}, before);
    await page.waitForFunction(() => document.querySelector('.qc-set').disabled);
    const draft = await page.$$eval('.qc-set input', (nodes) => nodes.map((node) => node.value));
    assert.equal(await page.$eval('.qc-cta', (node) => node.disabled), true);
    assert.equal(await page.$eval('.qc-set input', (node) => node.matches(':disabled')), true);
    await page.evaluate(() => {
      document.querySelector('.qc-cta').click();
      document.querySelector('.qc-side .btn-line').click();
    });
    assert.equal(await page.evaluate(() => window.fixtureCommands || 0), before + 1);
    await page.evaluate(() => window.rejectFixtureQuote());
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'alert');
    assert.deepEqual(
      await page.$$eval('.qc-set input', (nodes) => nodes.map((node) => node.value)),
      draft
    );
    assert.equal(await page.$eval('.qc-set', (node) => node.disabled), false);
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      assert.equal(
        await page.evaluate(() =>
          document.activeElement.closest('dialog')?.getAttribute('aria-label')
        ),
        'Create a client quote'
      );
    }
    await new Promise((r) => setTimeout(r, 1200));
    const violations = await page.evaluate(async () =>
      (
        await axe.run(document.querySelector('dialog[aria-label="Create a client quote"]'))
      ).violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))
    );
    assert.deepEqual(violations, []);
    await page.screenshot({
      path: `artifacts/lighthouse/client-quote-${width}.png`,
      fullPage: false,
    });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('dialog').length === 1);
    assert.equal(await page.evaluate(() => document.activeElement.className), 'tv-quote');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog'));
    results.push({
      width,
      height,
      violations,
      localValidation: true,
      mockQuoteRejection: true,
      pendingControlsDisabled: true,
      duplicateCommandBlocked: true,
      rejectedDraftRetained: true,
      nestedFocusRestored: true,
    });
  }
  assert.deepEqual(pageErrors, []);
  await writeFile(
    'artifacts/lighthouse/client-quote-browser.json',
    JSON.stringify(results, null, 2)
  );
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
