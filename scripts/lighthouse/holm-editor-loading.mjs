import {createServer} from 'node:http';
import {once} from 'node:events';
import path from 'node:path';
/* global document, window, location, localStorage, sessionStorage */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
const assets = await readdir('dist/assets').catch((cause) => {
  throw new Error('Missing production assets. Run "npm run build" first.', { cause });
});
const css = assets.find((file) => /^trade-.*\.css$/.test(file));
assert.ok(css, 'Missing dist/assets/trade-*.css. Run "npm run build" first.');
const stubs = {
  auth: `export const useAuthActions=()=>({signIn:async()=>{throw Error('No auth permitted')},signOut:async()=>{throw Error('No auth permitted')}});export const useAuthToken=()=>null;`,
  convex: `import{getFunctionName}from'convex/server';import{useSyncExternalStore}from'react';const subscribe=fn=>{window.addEventListener('fixture-auth',fn);return()=>window.removeEventListener('fixture-auth',fn)};export const useQuery=(ref)=>{const signedIn=useSyncExternalStore(subscribe,()=>!!window.fixtureSignedIn);return getFunctionName(ref)==='holm:me'?{signedIn,verified:false,admin:false,tradeStatus:'none'}:undefined;};export const useQueries=q=>Object.fromEntries(Object.entries(q).map(([k,v])=>[k,v.args.productIds?v.args.productIds.map(productId=>({productId,item:null})):{ready:true,items:v.args.legacyIds.map(legacyId=>({legacyId,status:'unavailable',item:null}))}]));export const useMutation=ref=>async()=>{if(getFunctionName(ref)==='holm:ensureProfile')return;window.fixtureCommands=(window.fixtureCommands||0)+1;throw Error('No mutation permitted')};export const usePaginatedQuery=()=>({results:[],status:'Exhausted',loadMore(){}});export const useAction=useMutation;export const useConvexAuth=()=>({isLoading:false,isAuthenticated:false});`,
};
const entry = `import React from'react';import{createRoot}from'react-dom/client';import{App,setProducts}from'./trade/app';const image='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';const products=Array.from({length:24},(_,i)=>({id:i+1,lid:'fixture'+i,vid:i===0?'finish-b':'fixture'+i,variants:[],name:'Fixture '+(i+1),full:'Fixture '+(i+1),line:'Chair',type:'sofa',mat:'leather',tone:'#6B4A33',price:100,trade:null,seats:1,oos:false,note:'Fixture only',facts:'',img:image,imgs:[image],ar:1,sku:'FIXTURE',likes:0,widthCm:50,dimsCm:{w:50,d:50,h:50},dimsSource:'fixture',cutout:null,cutAR:null,model:null,modelLow:null,hangs:false,mountCm:null,minimum:1,increment:1,checkoutMode:'quote'}));setProducts(products);const root=createRoot(document.getElementById('root'));root.render(<App/>);window.fixtureRemoveProduct=id=>{setProducts(products.filter(p=>p.id!==id))};window.fixtureSingleProduct=()=>setProducts(products.slice(0,1));`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true,
  outdir: 'artifacts/lighthouse/full-trade-fixture',
  write: false,
  format: 'esm', splitting: true, metafile: true,
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
const outputs=new Map(bundle.outputFiles.map(f=>['/'+path.basename(f.path),f]));
const main=Object.entries(bundle.metafile.outputs).find(([,v])=>v.entryPoint==='<stdin>')?.[0];
const editor=Object.entries(bundle.metafile.outputs).find(([,v])=>v.entryPoint?.endsWith('trade/editors.ts'))?.[0];
assert.ok(main);assert.ok(editor);let pending,mode,editorRequests=0;
const styles=await readFile('dist/assets/'+css,'utf8');
const server=createServer((req,res)=>{res.setHeader('Cache-Control','no-store');const file=outputs.get(req.url);
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="en"><head><title>Design loading fixture</title><style>${styles}</style></head><body><div id="root"></div><script type="module" src="/${path.basename(main)}"></script></body></html>`);return}
 if(req.url==='/'+path.basename(editor)){editorRequests++;if(mode==='slow'||mode==='sharing'){pending=res;return}if(mode==='failure'||mode==='sharing-failure'){res.writeHead(503);res.end('Unavailable');return}}
 if(file){res.setHeader('Content-Type',file.path.endsWith('.css')?'text/css':'text/javascript');res.end(file.contents)}else{res.writeHead(404);res.end()}
});server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await puppeteer.launch({...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {channel:'chrome'}),headless:true}),results=[];
try{for(mode of ['slow','failure','sharing','sharing-failure']){const scenario=mode;
 editorRequests=0;const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);page.on('request',request=>{const url=request.url();if(url.startsWith(`http://127.0.0.1:${server.address().port}/`)||url.startsWith('data:'))request.continue();else request.abort()});
 await page.evaluateOnNewDocument(()=>{if(!localStorage.getItem('hol:tray'))localStorage.setItem('hol:tray',JSON.stringify({active:'preserved',projects:[{id:'preserved',name:'Preserved project',target:2,zones:['Main room'],items:[{pid:1,lid:'fixture0',vid:'fixture0',qty:2,zone:'Main room'}]}],later:[]}))});
 await page.goto(`http://127.0.0.1:${server.address().port}/#discover`,{waitUntil:'networkidle2'});await page.waitForSelector('.pin-open');assert.equal(editorRequests,0);
 const before=await page.evaluate(()=>localStorage.getItem('hol:tray'));assert.equal(JSON.parse(before).projects[0].items[0].qty,2);
 if(mode.startsWith('sharing')){
  await page.evaluate(()=>{location.hash='board'});
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Share'));
  await page.evaluate(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Share');button.id='sharing-opener';button.focus();button.click()});
  await page.waitForSelector('[role=dialog][aria-label="Share"]');
  if(mode==='sharing-failure')await page.waitForFunction(()=>document.querySelector('[role=alert]')?.textContent.includes('Sharing tools could not load'));
  else await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent.includes('Loading sharing tools'));
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));
  await page.waitForFunction(()=>document.activeElement?.id==='sharing-opener');
  if(pending){pending.setHeader('Content-Type','text/javascript');pending.end(outputs.get('/'+path.basename(editor)).contents);pending=null;await page.waitForNetworkIdle();}
 }else{
  await page.evaluate(()=>{const button=document.querySelector('.pin button[title="Place in Studio"]');if(!button)throw Error('Studio action missing');button.click()});
  if(mode==='slow'){
  await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent.includes('Loading studio'));
  assert.ok(pending);await page.evaluate(()=>{location.hash='discover'});await page.waitForSelector('.pin-open');
  pending.setHeader('Content-Type','text/javascript');pending.end(outputs.get('/'+path.basename(editor)).contents);pending=null;
  await page.evaluate(()=>{location.hash='studio'});await page.waitForSelector('.sx');
  }else{
  await page.waitForFunction(()=>document.querySelector('[role=alert]')?.textContent.includes('Studio could not load'));
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Reload page')),true);
  assert.equal(await page.evaluate(()=>window.fixtureCommands||0),0,'No prohibited commands before reload');
  assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('hol:pending-studio')).seed.ids[0].vid),'finish-b');
  mode='recovered';await Promise.all([page.waitForNavigation({waitUntil:'networkidle2'}),page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Reload page').click())]);await page.waitForSelector('.sx');
  }
  assert.equal(await page.$$eval('.sx-canvas .el',els=>els.length),1,'Pending selection restored instead of sample');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('hol:pending-studio')),null,'Consumed seed cleared');
 }
 assert.equal(await page.evaluate(()=>localStorage.getItem('hol:tray')),before);
 assert.equal(await page.evaluate(()=>window.fixtureCommands||0),0);assert.deepEqual(errors,[]);
 results.push({mode:scenario,reloadRecovered:scenario==='failure',sharingFocusRestored:scenario.startsWith('sharing'),editorRequests,noEditorRequestAtCatalog:true,nonemptyProjectRetained:true,commands:0});await context.close();
}await mkdir('artifacts/lighthouse',{recursive:true});await writeFile('artifacts/lighthouse/holm-editor-loading-browser.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));}finally{pending?.end();await browser.close();server.close()}
