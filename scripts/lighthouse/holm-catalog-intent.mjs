/* global document, window, location */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
const assets = await readdir('dist/assets').catch((cause) => {
  throw new Error('Missing production assets. Run "npm run build" first.', { cause });
});
const css = assets.find((file) => /^trade-.*\.css$/.test(file));
assert.ok(css, 'Missing dist/assets/trade-*.css. Run "npm run build" first.');
const stubs = {
  auth: `export const useAuthActions=()=>({signIn:async()=>{throw Error('No auth permitted')},signOut:async()=>{throw Error('No auth permitted')}});export const useAuthToken=()=>null;`,
  convex: `import{getFunctionName}from'convex/server';import{useCallback,useSyncExternalStore}from'react';import{CURATED_SOURCES}from'./trade/curatedSources';const image='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';const rows=Object.keys(CURATED_SOURCES).map((id,i)=>({id,name:'Fixture '+(i+1),description:'Synthetic',category:'Sofas',images:[image],facts:'',inStock:true,variants:[{id:'variant'+i,name:'Ivory',minimum:1,increment:1,retail:10000,trade:null}]}));const initial=rows.slice(0,2);const subscribe=f=>{window.addEventListener('fixture-update',f);return()=>window.removeEventListener('fixture-update',f)};const version=()=>window.fixtureVersion||0;function result(ref,args){const name=getFunctionName(ref);if(name==='holm:me')return{signedIn:false,verified:false,admin:false,tradeStatus:'none'};if(name==='holm:catalogItems')return args.productIds.map(productId=>({productId,item:rows.find(r=>r.id===productId)||null}));if(name==='holm:catalogLegacyItems')return{ready:true,items:args.legacyIds.map(legacyId=>({legacyId,status:'unavailable',item:null}))};return undefined;}export function useQuery(ref,args){useSyncExternalStore(subscribe,version);return args==='skip'?undefined:result(ref,args)}export function useQueries(q){useSyncExternalStore(subscribe,version);return Object.fromEntries(Object.entries(q).map(([k,v])=>[k,result(v.query,v.args)]))}export function usePaginatedQuery(){useSyncExternalStore(subscribe,version);const loadMore=useCallback(()=>{window.fixtureLoads=(window.fixtureLoads||0)+1},[]);return{results:window.fixtureFull?rows:initial,status:window.fixtureFull?'Exhausted':'CanLoadMore',loadMore}}export const useMutation=()=>async()=>{window.fixtureCommands=(window.fixtureCommands||0)+1;throw Error('No mutation permitted')};export const useAction=useMutation;export const useConvexAuth=()=>({isLoading:false,isAuthenticated:false});`,
};
const entry = `import React from'react';import{createRoot}from'react-dom/client';import{LiveShell}from'./trade/LiveShell';createRoot(document.getElementById('root')).render(<LiveShell/>);window.fixtureRelease=()=>{window.fixtureFull=true;window.fixtureVersion=(window.fixtureVersion||0)+1;window.dispatchEvent(new Event('fixture-update'))};`;

const bundle = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true,
  outdir: 'artifacts/lighthouse/catalog-intent-fixture',
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
const results=[];
try {
  for(const [width,height] of [[320,900],[844,390],[1440,900]]) {
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewport({width,height});
    await page.setContent('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>HOLM catalog intent fixture</title><meta http-equiv="Content-Security-Policy" content="connect-src \'none\';img-src data:"></head><body><div id="root"></div></body></html>');
    await page.addStyleTag({content:await readFile('dist/assets/'+css,'utf8')});
    for(const file of bundle.outputFiles.filter(f=>f.path.endsWith('.css')))await page.addStyleTag({content:file.text});
    await page.addStyleTag({content:await readFile('trade/style.css','utf8')});
    await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text});
    await page.waitForSelector('main.home');
    assert.equal(await page.evaluate(()=>window.fixtureLoads||0),0);
    await page.focus('[aria-label="Describe a feeling"]');
    await page.type('[aria-label="Describe a feeling"]','warm leather');
    await page.waitForFunction(()=>window.fixtureLoads>0);
    assert.equal(await page.$eval('[aria-label="Compose in Studio"]',e=>e.disabled),true);
    await page.evaluate(()=>window.fixtureRelease());
    await page.waitForFunction(()=>!document.querySelector('[aria-label="Compose in Studio"]').disabled);
    assert.equal(await page.$eval('[aria-label="Describe a feeling"]',e=>e.value),'warm leather');
    await page.evaluate(()=>{location.hash='discover'});
    await page.waitForSelector('.pin-open');
    await page.addScriptTag({content:axe.source});
    const violations=await page.evaluate(async()=>(await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>v.id));
    assert.deepEqual(violations,[]);assert.deepEqual(errors,[]);
    assert.equal(await page.evaluate(()=>window.fixtureCommands||0),0);
    results.push({width,height,initialPaginationCalls:0,intentLoadsFullCatalog:true,moodPreserved:true,discoveryAvailable:true,violations,errors,commands:0});
    await page.close();
  }
  await writeFile('artifacts/lighthouse/holm-catalog-intent-browser.json',JSON.stringify({scope:'Actual LiveShell and HOLM App; synthetic read-only transport, commands prohibited',results},null,2));
  console.log(JSON.stringify(results));
} finally {await browser.close();}
