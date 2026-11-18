/* global document, window, localStorage, innerHeight, Event */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import assert from 'node:assert/strict';
const stubs = {
  auth: 'export function useAuthToken(){return null}',
  convex:
    `import {useSyncExternalStore} from 'react';const base={_id:'fixture',name:'Fixture chair',description:'',category:'Furniture',collection:'furniture',price:100,images:[],inStock:true,fulfillmentProvider:'zuo',variants:[{id:'fixture-variant',name:'Standard',priceAdjustment:0,inStock:true,quantityRules:{minimum:1,increment:1}}]};const subscribe=callback=>{window.addEventListener('fixture-change',callback);return()=>window.removeEventListener('fixture-change',callback)};export function useQuery(){return undefined} export function useQueries(queries){useSyncExternalStore(subscribe,()=>window.fixtureVersion||0);return Object.fromEntries(Object.entries(queries).map(([key,{args}])=>[key,args.id==='fixture'?{product:window.fixtureProduct===undefined?base:window.fixtureProduct,quantity:args.quantity,variantId:args.variantId,maximum:9999,expiresAt:window.fixtureExpiry??null}:undefined]))} export function useMutation(){return()=>{throw Error("Unexpected fixture mutation")}}`,
};
const fixture = await build({
  stdin: {
    contents: `import React from'react';import{createRoot}from'react-dom/client';import{CartProvider,useCart}from'./contexts/CartContext';import{LazyCartDrawer}from'./components/cart/LazyCartDrawer';function Controls(){const cart=useCart();return <main><h1>Cart loading verification</h1><button id="open" onClick={cart.openCart}>Open cart</button><button id="add" onClick={()=>cart.addToCart({id:'saved-chair',name:'Saved chair',price:100,images:[],description:'',category:'Chairs',collection:'furniture',fulfillmentProvider:'ashcroft'},3)}>Add three chairs</button><output id="count">{cart.itemCount}</output><LazyCartDrawer/></main>}createRoot(document.getElementById('root')).render(<CartProvider><Controls/></CartProvider>);`,
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
          loader: 'js', resolveDir: process.cwd(),
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
  for (const [width, height] of [
    [320, 900],
    [844, 390],
    [1440, 900],
  ])
    for (const scenario of ['held', 'failed']) {
      mode = scenario;
      drawerRequests = 0;
      const page = await browser.newPage();
      await page.setViewport({ width, height });
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
                images: [
                  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
                ],
                fulfillmentProvider: 'zuo',
                variants: [{ id: 'fixture-variant', name: 'Standard',priceAdjustment:0,inStock:true,quantityRules:{minimum:1,increment:1} }],
              },
              quantity: 2,
            },
          ])
        );
      });
      await page.goto(origin, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#open');
      await page.addScriptTag({ content: axe.source });
      const checkAxe = async () =>
        assert.deepEqual(await page.evaluate(async () => (await window.axe.run()).violations), []);
      assert.equal(drawerRequests, 0);
      assert.equal(await page.evaluate(() => window.fixtureDrawerEvaluations || 0), 0);
      await page.click('#open');
      await page.waitForSelector('dialog[open]', { visible: true });
      if (scenario === 'held') {
        await page.waitForFunction(() =>
          document.querySelector('[role=status]')?.textContent.includes('Opening your cart')
        );
        await checkAxe();
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
        await checkAxe();
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('dialog[open]'));
        await page.click('#open');
        await page.waitForSelector('input[autocomplete=name]');
        assert.equal(
          await page.$eval('input[autocomplete=name]', (n) => n.value),
          'Retained customer'
        );
        const review = await page.$('form[aria-label="Delivery address"] button[type=submit]');
        assert.ok(review);
        await review.scrollIntoView();
        await review.focus();
        const reachable = await review.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return document.activeElement === node && rect.top >= 0 && rect.bottom <= innerHeight;
        });
        assert.equal(
          reachable,
          true,
          'Delivery review must remain reachable in the scrolling drawer'
        );
        await page.screenshot({ path: `artifacts/lighthouse/lazy-cart-review-${width}.png` });
        await page.$eval('[data-cart-panel]', (node) => {
          node.scrollTop = 0;
        });
        await checkAxe();
        assert.equal(drawerRequests, 1);
        assert.equal(await page.evaluate(() => document.body.textContent.includes('Pay $')), false);
      } else {
        await page.waitForSelector('[role=alert]', { visible: true });
        assert.match(await page.$eval('[role=alert]', (n) => n.textContent), /could not be opened/);
        await checkAxe();
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('dialog[open]'));
        assert.equal(await page.evaluate(() => document.activeElement.id), 'open');
      }
      assert.equal(await page.$eval('#count', (n) => n.textContent), '2');
      assert.equal(commands, 0);
      results.push({
        scenario,
        width,
        height,
        deferredUntilIntent: true,
        requests: drawerRequests,
        cartRetained: true,
        commands,
      });
      await page.screenshot({ path: `artifacts/lighthouse/lazy-cart-${scenario}-${width}.png` });
      await page.close();
    }
  for(const width of [320,844,1440])for(const scenario of ['denied','corrupt']){
    mode='ready';const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewport({width,height:900});
    await page.evaluateOnNewDocument(scenario=>{localStorage.clear();if(scenario==='corrupt')localStorage.setItem('louiemae_ashcroft_cart_v1','{"invalid":true}');else window.Storage.prototype.setItem=function(){throw new Error('Synthetic denied storage')};},scenario);
    await page.goto(origin,{waitUntil:'networkidle0'});await page.waitForSelector('#add');await page.focus('#add');await page.keyboard.press('Enter');await page.waitForSelector('[data-cart-panel]');
    await page.waitForFunction(()=>document.querySelector('#count').textContent==='3');
    const notice=await page.$eval('[data-cart-panel] [role=status]',node=>node.textContent);assert.match(notice,scenario==='denied'?/during this visit/:/could not be restored/);
    await page.addScriptTag({content:axe.source});assert.deepEqual(await page.evaluate(async()=>(await window.axe.run()).violations),[]);
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog[open]'));assert.equal(await page.evaluate(()=>document.activeElement.id),'add');assert.deepEqual(errors,[]);assert.equal(commands,0);
    results.push({scenario,width,cartRetained:true,keyboardRestore:true,axeViolations:0,commands,errors});await page.close();
  }
  for (const width of [320, 844, 1440]) {
    mode = 'ready';
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width, height: 900 });
    await page.evaluateOnNewDocument(() => {
      const option = { id: 'fixture-variant', name: 'Standard', priceAdjustment: 0, inStock: true, quantityRules: { minimum: 3, increment: 2 } };
      const product = { id: 'fixture', name: 'Fixture chair', description: '', category: 'Furniture', collection: 'furniture', price: 100, images: [], inStock: true, fulfillmentProvider: 'zuo', variants: [option] };
      localStorage.setItem('louiemae_ashcroft_cart_v1', JSON.stringify([{ product, selectedVariant: option, quantity: 6 }]));
      window.fixtureProduct = { ...product, price: 125 };
    });
    await page.goto(origin, { waitUntil: 'networkidle0' });
    await page.click('#open');
    await page.waitForSelector('input[autocomplete=name]');
    await page.type('input[autocomplete=name]', 'Retained customer');
    const reviewSelector = 'form[aria-label="Delivery address"] button[type=submit]';
    assert.equal(await page.$eval(reviewSelector, node => node.disabled), true);
    const press = async text => {
      const handle = await page.evaluateHandle(text => [...document.querySelectorAll('button')].find(button => button.textContent.includes(text)), text);
      const button = handle.asElement();
      assert.ok(button, text);
      await button.scrollIntoView(); await button.focus(); await page.keyboard.press('Enter'); await handle.dispose();
    };
    await press('Accept updated details for Fixture chair');
    await page.waitForFunction(() => document.body.textContent.includes('Choose 5'));
    assert.equal(await page.$eval('#count', node => node.textContent), '6');
    assert.equal(await page.$eval(reviewSelector, button => button.disabled), true);
    await press('Choose 5');
    await page.waitForFunction(() => document.querySelector('#count').textContent === '5');
    assert.equal(await page.$eval(reviewSelector, node => node.disabled), false);
    assert.equal(await page.$eval('input[autocomplete=name]', node => node.value), 'Retained customer');
    await page.evaluate(() => { window.fixtureExpiry = Date.now() + 1000; window.fixtureVersion = (window.fixtureVersion || 0) + 1; window.dispatchEvent(new Event('fixture-change')); });
    await page.waitForFunction(() => document.querySelector('form[aria-label="Delivery address"] button[type=submit]').disabled);
    assert.equal(await page.$eval('input[autocomplete=name]', node => node.value), 'Retained customer');
    await page.evaluate(() => { window.fixtureExpiry = Date.now() + 60000; window.fixtureVersion = (window.fixtureVersion || 0) + 1; window.dispatchEvent(new Event('fixture-change')); });
    await page.waitForFunction(() => !document.querySelector('form[aria-label="Delivery address"] button[type=submit]').disabled);
    await page.evaluate(() => { window.fixtureProduct = { ...window.fixtureProduct, inStock: false }; window.fixtureVersion = (window.fixtureVersion || 0) + 1; window.dispatchEvent(new Event('fixture-change')); });
    await page.waitForFunction(() => document.body.textContent.includes('cannot currently be purchased'));
    assert.equal(await page.$eval(reviewSelector, node => node.disabled), true);
    assert.equal(await page.$eval('#count', node => node.textContent), '5');
    await page.addScriptTag({ content: axe.source });
    assert.deepEqual(await page.evaluate(async () => (await window.axe.run()).violations), []);
    await page.$eval('[data-cart-panel]', node => { node.scrollTop = 0; });
    await page.screenshot({ path: `artifacts/lighthouse/cart-current-review-${width}.png` });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'open');
    assert.deepEqual(errors, []); assert.equal(commands, 0);
    results.push({ scenario: 'current-review', width, explicitPriceAcceptance: true, explicitQuantityCorrection: true, expiryBlocksCheckout: true, withdrawalBlocksCheckout: true, addressRetained: true, axeViolations: 0, commands, errors });
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
