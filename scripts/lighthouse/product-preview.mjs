/* global document, window, localStorage */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import assert from 'node:assert/strict';
const stubs = {
  auth: 'export function useAuthToken(){return null}',
  convex: `import{getFunctionName}from'convex/server';import{useSyncExternalStore}from'react';const image='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';const products=Object.fromEntries(['home','collection'].map(id=>[id,{_id:id,name:id==='home'?'Home fixture chair':'Collection fixture chair',description:'Synthetic preview verification.',category:'Chair',collection:'furniture',price:100,images:[image],inStock:true,fulfillmentProvider:'zuo',variants:[{id:id+'-ivory',name:'Ivory',priceAdjustment:0,inStock:true},{id:id+'-walnut',name:'Walnut',priceAdjustment:20,inStock:true},{id:id+'-sold',name:'Sold out',priceAdjustment:30,inStock:false}]}]));function result(ref,args){const name=getFunctionName(ref);window.fixtureReads=(window.fixtureReads||[]);window.fixtureReads.push(name);if(name==='products:getStorefrontDetail')return products[args.id]??null;if(name==='dlvEstimates:enabled')return false;return undefined;}export function useQueries(queries){return Object.fromEntries(Object.entries(queries).map(([key,q])=>[key,result(q.query,q.args)]))}export function useQuery(ref,args){return args==='skip'?undefined:result(ref,args)}export function useMutation(){return()=>{window.fixtureCommands=(window.fixtureCommands||0)+1;throw Error('No mutation permitted')}}`,
};
const fixture = await build({
  stdin: {
    contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{CartProvider,useCart}from'./contexts/CartContext';import{LazyProductPreview}from'./components/LazyProductPreview';function Controls(){const[selection,setSelection]=useState(null);const cart=useCart();return <main><h1>Product preview verification</h1><button id="home" onClick={()=>setSelection('home')}>Open home preview</button><button id="collection" onClick={()=>setSelection('collection')}>Open collection preview</button><output id="cart">{cart.items.map(item=>item.selectedVariant?.id+':'+item.quantity).join(',')}</output><LazyProductPreview productId={selection} presentation={selection==='collection'?'collection':'home'} collectionTitle="Furniture" initialVariantId={selection==='collection'?'collection-walnut':undefined} onClose={()=>setSelection(null)}/></main>}createRoot(document.getElementById('root')).render(<CartProvider><Controls/></CartProvider>)`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  splitting: true,
  format: 'esm',
  outdir: 'artifacts/lighthouse/preview-fixture',
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
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});
const files = new Map(fixture.outputFiles.map((f) => ['/' + basename(f.path), f.text]));
const entries = Object.fromEntries(
  ['HomeProductPreview', 'CollectionProductPreview'].map((name) => [
    name,
    '/' +
      basename(
        Object.entries(fixture.metafile.outputs).find(([, v]) =>
          v.entryPoint?.endsWith('/' + name + '.tsx')
        )[0]
      ),
  ])
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
  requests = [],
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
      '<!doctype html><html lang="en"><head><title>Preview verification</title><meta http-equiv="Content-Security-Policy" content="connect-src \'none\'; img-src data:"><style>' +
        styles +
        '</style></head><body><div id="root"></div><script type="module" src="/stdin.js"></script></body></html>'
    );
    return;
  }
  const body = files.get(req.url);
  if (body !== undefined) {
    if (Object.values(entries).includes(req.url)) {
      requests.push(req.url);
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
      requests = [];
      const page = await browser.newPage();
      await page.setViewport({ width, height });
      await page.evaluateOnNewDocument(() => localStorage.clear());
      await page.goto(origin, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#home');
      await page.addScriptTag({ content: axe.source });
      const checkAxe = async () =>
        assert.deepEqual(await page.evaluate(async () => (await window.axe.run()).violations), []);
      assert.equal(requests.length, 0);
      assert.equal(await page.evaluate(() => window.fixtureReads?.length || 0), 0);
      await page.focus('#home');
      await page.keyboard.press('Enter');
      await page.waitForSelector('dialog[open]');
      if (scenario === 'held') {
        await page.waitForFunction(() =>
          document.querySelector('[role=status]')?.textContent.includes('Opening product')
        );
        await checkAxe();
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('dialog[open]'));
        assert.equal(await page.evaluate(() => document.activeElement.id), 'home');
        mode = 'ready';
        held.splice(0).forEach((send) => send());
        await page.focus('#home');
        await page.keyboard.press('Enter');
        await page.waitForFunction(
          () => document.querySelector('dialog h2')?.textContent === 'Home fixture chair'
        );
        await page.evaluate(() =>
          [...document.querySelectorAll('dialog button')]
            .find((n) => n.textContent === 'Walnut')
            .focus()
        );
        await page.keyboard.press('Enter');
        await page.waitForFunction(
          () => document.querySelector('dialog [aria-pressed=true]')?.textContent === 'Walnut'
        );
        assert.equal(
          await page.evaluate(
            () =>
              [...document.querySelectorAll('dialog button')].find(
                (n) => n.textContent === 'Sold out'
              ).disabled
          ),
          true
        );
        await checkAxe();
        await page.evaluate(() =>
          [...document.querySelectorAll('dialog button')]
            .find((n) => n.textContent.includes('Add to Cart'))
            .focus()
        );
        await page.keyboard.press('Enter');
        await page.waitForFunction(
          () => document.getElementById('cart').textContent === 'home-walnut:1'
        );
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('dialog[open]'));
        await page.focus('#collection');
        await page.keyboard.press('Enter');
        await page.waitForFunction(
          () => document.querySelector('dialog h2')?.textContent === 'Collection fixture chair'
        );
        assert.equal(
          await page.$eval('dialog [aria-pressed=true]', (n) => n.textContent),
          'Walnut'
        );
        await checkAxe();
        assert.equal(requests.filter((x) => x === entries.HomeProductPreview).length, 1);
        assert.equal(requests.filter((x) => x === entries.CollectionProductPreview).length, 1);
      } else {
        await page.waitForSelector('[role=alert]', { visible: true });
        await checkAxe();
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('dialog[open]'));
        assert.equal(await page.evaluate(() => document.activeElement.id), 'home');
      }
      assert.equal(commands, 0);
      assert.equal(await page.evaluate(() => window.fixtureCommands || 0), 0);
      await page.screenshot({
        path: `artifacts/lighthouse/product-preview-${scenario}-${width}.png`,
      });
      results.push({
        width,
        height,
        scenario,
        requests: requests.length,
        commands,
        axeViolations: 0,
      });
      await page.close();
    }
  await writeFile(
    'artifacts/lighthouse/product-preview-browser.json',
    JSON.stringify(
      {
        scope:
          'Actual product previews and cart with synthetic query/auth boundaries; no delivery estimates, payments or production mutations',
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
