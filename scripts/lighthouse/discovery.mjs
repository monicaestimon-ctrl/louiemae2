/* global window, document, Event */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Exercises the actual UI and cursor hook with an inert query transport. It
// cannot certify native search semantics; production parity remains a gate.
const stub = `import{useSyncExternalStore}from'react';
const sub=fn=>{window.addEventListener('fixture-change',fn);return()=>window.removeEventListener('fixture-change',fn)};
export function useQueries(queries){useSyncExternalStore(sub,()=>window.fixtureRevision||0);return Object.fromEntries(Object.entries(queries).map(([key,{args}])=>{
window.fixtureQueries=(window.fixtureQueries||0)+1;
if(window.fixtureFailure)return[key,new Error('Fixture unavailable')];
let items=window.fixtureRows.filter(x=>!args.request.query||x.name.toLowerCase().includes(args.request.query.toLowerCase()));
if(args.request.maximumMinor!==null)items=items.filter(x=>x.variants[0].retail<=args.request.maximumMinor);
items=[...items].sort((a,b)=>args.request.sort==='priceDesc'?b.variants[0].retail-a.variants[0].retail:a.variants[0].retail-b.variants[0].retail);
const start=Number(args.cursor||0);return[key,{ready:true,items:items.slice(start,start+1),nextCursor:start+1<items.length?String(start+1):null,serverNow:1,refreshAfterMs:30000}];}));}
`;
const entry = `import React from'react';import{createRoot}from'react-dom/client';import{DiscoverCatalog}from'./trade/DiscoverCatalog';
const row=(id,name,price)=>({id,name,category:'Chair',description:'',facts:'',images:[],inStock:true,defaultVariantId:'v',variants:[{id:'v',name:'Default',minimum:1,increment:1,retail:price,trade:null}]});
window.fixtureRows=[row('first','Zebra Chair',10000),row('second','Amber Chair',20000)];
createRoot(document.getElementById('root')).render(<DiscoverCatalog serverViewerKey='anonymous' products={[]} query='' imageQuery={null} types={{chair:'Chairs'}} materials={{}} trends={[]} matchQuery={()=>[]} onQuery={()=>{}} onClearImage={()=>{}} onImage={()=>{}} onTrend={()=>{}} onSourcing={()=>{}} renderProducts={items=><ul aria-label='Products'>{items.map(item=><li key={item.lid}><button>{item.full}</button></li>)}</ul>}/>);`;
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, outdir: 'artifacts/lighthouse/discovery-fixture', format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  plugins: [{ name: 'inert-discovery', setup(b) {
    b.onResolve({ filter: /^convex\/react$/ }, () => ({ path: 'convex', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: stub, loader: 'js', resolveDir: process.cwd() }));
  } }],
});
await mkdir('artifacts/lighthouse', { recursive: true });
const browser = await puppeteer.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
const results = [];
try {
  for (const width of [320, 1440]) {
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width, height: 900 });
    await page.setContent('<!doctype html><html lang="en"><head><title>Catalog verification</title><meta http-equiv="Content-Security-Policy" content="connect-src \'none\';img-src data:"></head><body><div id="root"></div></body></html>');
    await page.addStyleTag({ content: await readFile('trade/style.css', 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
    await page.waitForSelector('[aria-label="Products"]');
    const names = () => page.$$eval('[aria-label="Products"] li', nodes => nodes.map(node => node.textContent));
    assert.deepEqual(await names(), ['Zebra Chair']);
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Load more products').click());
    await page.waitForFunction(() => document.querySelectorAll('[aria-label="Products"] li').length === 2);
    assert.deepEqual(await names(), ['Zebra Chair', 'Amber Chair']);
    await page.select('select[aria-label="Sort"]', 'hi');
    await page.waitForFunction(() => document.querySelector('[aria-label="Products"] li')?.textContent === 'Amber Chair');
    assert.deepEqual(await names(), ['Amber Chair']);
    await page.click('[aria-expanded]');
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(row => row.id));
    assert.deepEqual(violations, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: `artifacts/lighthouse/server-discovery-${width}.png` });
    await page.type('[aria-label="Search"]', 'zebra');
    await page.waitForFunction(() => document.querySelector('[aria-label="Products"] li')?.textContent === 'Zebra Chair');
    await page.evaluate(() => { window.fixtureFailure = true; window.fixtureRevision = 1; window.dispatchEvent(new Event('fixture-change')); });
    await page.waitForFunction(() => document.body.textContent.includes('Catalog temporarily unavailable'));
    assert.equal(await page.$('[aria-label="Products"]'), null);
    assert.deepEqual(errors, []);
    results.push({ width, pagination: true, ordering: true, filterReset: true, errorRecovery: true, axeViolations: 0 });
    await page.close();
  }
} finally { await browser.close(); }
await writeFile('artifacts/lighthouse/server-discovery-browser.json', JSON.stringify({ nativeSearchParityVerified: false, results }, null, 2));
console.log(`Server discovery browser checks passed at ${results.map(row => row.width).join(', ')}px.`);
