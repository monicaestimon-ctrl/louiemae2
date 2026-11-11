/* global window, document, URL, location, innerWidth */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

const assets = await readdir('dist/assets');
const css = assets.find((file) => /^main-.*\.css$/.test(file));
assert.ok(css, 'Run npm run build before the product navigation browser fixture.');
const stubs = {
  auth: `export const useAuthActions=()=>({signIn:async()=>{throw Error('No auth permitted')},signOut:async()=>{throw Error('No auth permitted')}});export const useAuthToken=()=>null;`,
  convex: `import{getFunctionName}from'convex/server';import{useState}from'react';const image='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';const products=['ashcroft','zuo'].map((provider,i)=>({_id:provider+'-fixture',name:provider==='zuo'?'Rowan Chair':'Marlowe Chair',category:'Chair',collection:'furniture',description:'Synthetic product for navigation verification.',price:100,images:[image],inStock:true,fulfillmentProvider:provider,deliveryFee:59.99,variants:[{id:provider+'-ivory',name:'Ivory',priceAdjustment:0,inStock:true},{id:provider+'-walnut',name:'Walnut',priceAdjustment:20,inStock:true},{id:provider+'-slate',name:'Slate',priceAdjustment:30,inStock:false}]}));function result(ref,args){const name=getFunctionName(ref);if(name==='publicSearch:status')return{ready:true};if(name==='products:getStorefrontDetail')return products.find(p=>p._id===args.id)||null;if(name==='products:searchStorefront')return args.term.includes('nomatch')?[]:products;if(name==='dlvEstimates:enabled')return false;return undefined;}export const useQuery=(ref,args)=>args==='skip'?undefined:result(ref,args);export const useQueries=queries=>Object.fromEntries(Object.entries(queries).map(([key,q])=>[key,result(q.query,q.args)]));export const useMutation=()=>async()=>{window.fixtureCommands=(window.fixtureCommands||0)+1;throw Error('No command permitted')};export const useAction=useMutation;export function usePaginatedQuery(ref){const[loaded,setLoaded]=useState(false);if(getFunctionName(ref)!=='publicSearch:search')return{results:[],status:'Exhausted',loadMore(){}};return{results:loaded?products.map(p=>({_id:p._id,name:p.name,category:p.category,price:p.price,currency:'USD',image:p.images[0],alt:p.name,url:'/products/'+p._id,availability:'available'})):[],status:loaded?'Exhausted':'CanLoadMore',loadMore(){setLoaded(true)}};}export const useConvexAuth=()=>({isLoading:false,isAuthenticated:false});export const useConvex=()=>({query:async()=>{throw Error('No direct query permitted')}});`,
};
const bundle = await build({
  stdin: {
    contents: `import React from'react';import{createRoot}from'react-dom/client';import App from'./App';createRoot(document.getElementById('root')).render(<App/>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  outdir: 'artifacts/lighthouse/product-navigation-fixture',
  format: 'iife',
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env': '{}',
    'import.meta.url': '"http://fixture.invalid/module.js"',
  },
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
await mkdir('artifacts/lighthouse', { recursive: true });
const entryHtml = await readFile('dist/index.html', 'utf8');
const inlineStyles = [...entryHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(
  (match) => match[1]
);
const styles = [
  ...inlineStyles,
  await readFile('dist/assets/' + css, 'utf8'),
  ...bundle.outputFiles.filter((f) => f.path.endsWith('.css')).map((f) => f.text),
].join('\n');
const script = bundle.outputFiles.find((f) => f.path.endsWith('.js')).text;
const html = `<!doctype html><html lang="en"><head><title>Product navigation fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="connect-src 'none';img-src data:"><link rel="canonical" href="http://fixture.invalid/"><meta name="description" content="Fixture"><style>${styles}</style></head><body><div id="skip-navigation"></div><div id="root"></div><script>${script.replaceAll('</script', '<\\/script')}</script></body></html>`;
const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: 'chrome' }),
  headless: true,
});
const results = [];
try {
  for (const [width, height] of [
    [320, 900],
    [844, 390],
    [1440, 900],
  ]) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (
        request.isNavigationRequest() &&
        new URL(request.url()).origin === 'http://fixture.invalid'
      )
        void request.respond({ status: 200, contentType: 'text/html', body: html });
      else if (request.url().startsWith('data:')) void request.continue();
      else void request.abort();
    });
    await page.setViewport({ width, height });
    await page.goto('http://fixture.invalid/#shop');
    await page.waitForSelector('[aria-label="Search"]');
    await page.click('[aria-label="Search"]');
    await page.waitForSelector('[aria-label="Search products"]');
    await page.type('[aria-label="Search products"]', 'chair');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('button')].some((n) => n.textContent === 'Load more products')
    );
    await page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .find((n) => n.textContent === 'Load more products')
        .click()
    );
    await page.waitForSelector('a[href="/products/zuo-fixture"]');
    await page.focus('a[href="/products/zuo-fixture"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () =>
        location.pathname === '/products/zuo-fixture' &&
        document.querySelector('main h1')?.textContent === 'Rowan Chair'
    );
    await page.waitForFunction(() => document.activeElement === document.querySelector('main h1'));
    assert.equal(await page.$eval('[aria-pressed="false"]', (n) => n.tagName), 'BUTTON');
    await page.evaluate(() =>
      [...document.querySelectorAll('main button')].find((n) => n.textContent === 'Walnut').click()
    );
    await page.waitForFunction(() => location.search === '?variant=zuo-walnut');
    await page.reload();
    await page.waitForFunction(
      () => document.querySelector('main [aria-pressed="true"]')?.textContent === 'Walnut'
    );
    assert.equal(
      await page.$eval('link[rel=canonical]', (n) => n.getAttribute('href')),
      'http://fixture.invalid/products/zuo-fixture'
    );
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () =>
      (await axe.run(document)).violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      }))
    );
    assert.deepEqual(violations, []);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false
    );
    await page.screenshot({ path: `artifacts/lighthouse/product-navigation-${width}.png` });
    await page.click('[aria-label="Search"]');
    await page.waitForSelector('[aria-label="Search products"]');
    await page.type('[aria-label="Search products"]', 'different search');
    await page.goBack();
    await page.waitForSelector('[aria-label="Search products"]');
    assert.equal(await page.$eval('[aria-label="Search products"]', (n) => n.value), 'chair');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('button')].some((n) => n.textContent === 'Load more products')
    );
    await page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .find((n) => n.textContent === 'Load more products')
        .click()
    );
    await page.waitForSelector('a[href="/products/ashcroft-fixture"]');
    await page.click('a[href="/products/ashcroft-fixture"]');
    await page.waitForFunction(
      () => document.querySelector('main h1')?.textContent === 'Marlowe Chair'
    );
    await page.click('main a[href="/#shop"]');
    await page.waitForFunction(() => location.pathname === '/' && location.hash === '#shop');
    await page.goto(
      'http://fixture.invalid/#collection/furniture?product=zuo-fixture&variant=zuo-walnut'
    );
    await page.waitForFunction(
      () =>
        location.pathname === '/products/zuo-fixture' &&
        document.querySelector('main [aria-pressed="true"]')?.textContent === 'Walnut'
    );
    assert.equal(await page.evaluate(() => window.fixtureCommands || 0), 0);
    assert.deepEqual(errors, []);
    results.push({
      width,
      height,
      violations,
      keyboardSelection: true,
      reloadVariant: true,
      restoredSearch: true,
      legacyReferral: true,
      businessCommands: 0,
    });
    await page.close();
  }
  await writeFile(
    'artifacts/lighthouse/product-navigation-browser.json',
    JSON.stringify(results, null, 2)
  );
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
