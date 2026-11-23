/* global document, window, location, localStorage, setTimeout, innerWidth */
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
  convex: `import{getFunctionName}from'convex/server';export const useQuery=(ref)=>getFunctionName(ref)==='holm:me'?{signedIn:false,verified:false,admin:false,tradeStatus:'none'}:undefined;export const useQueries=q=>Object.fromEntries(Object.keys(q).map(k=>[k,undefined]));export const useMutation=()=>async()=>{window.fixtureCommands=(window.fixtureCommands||0)+1;throw Error('No mutation permitted')};export const usePaginatedQuery=()=>({results:[],status:'Exhausted',loadMore(){}});export const useAction=useMutation;export const useConvexAuth=()=>({isLoading:false,isAuthenticated:false});`,
};
const entry = `import React from'react';import{createRoot}from'react-dom/client';import{App,setProducts}from'./trade/app';const image='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';const products=Array.from({length:24},(_,i)=>({id:i+1,lid:'fixture'+i,vid:'fixture'+i,variants:[],name:'Fixture '+(i+1),full:'Fixture '+(i+1),line:'Chair',type:'sofa',mat:'leather',tone:'#6B4A33',price:100,trade:null,seats:1,oos:false,note:'Fixture only',facts:'',img:image,imgs:[image],ar:1,sku:'FIXTURE',likes:0,widthCm:50,dimsCm:{w:50,d:50,h:50},dimsSource:'fixture',cutout:image,cutAR:1,model:null,modelLow:null,hangs:false,mountCm:null,minimum:1,increment:1,checkoutMode:'quote'}));setProducts(products);createRoot(document.getElementById('root')).render(<App/>);`;
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
  args: ['--no-sandbox'],
});
try {
 const results=[];
 for(const width of [390,1440]) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
  await page.setViewport({ width, height: 900 });
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
    localStorage.clear();
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

  async function activate(selector) { await page.focus(selector); await page.keyboard.press('Enter'); }
  async function action(scope, text) {
    await page.evaluate((scope,text)=>{
      const button=[...document.querySelectorAll(scope+' button')].find(b=>b.textContent.trim()===text);
      if(!button||button.disabled)throw Error('Missing enabled action '+text);button.focus();
    },scope,text);
    await page.keyboard.press('Enter');
  }
  async function number(selector, value) {
    await page.focus(selector); await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');
    await page.keyboard.type(String(value));await page.keyboard.press('Enter');
  }
  async function undo(redo=false) {await page.keyboard.down('Control');if(redo)await page.keyboard.down('Shift');await page.keyboard.press('z');if(redo)await page.keyboard.up('Shift');await page.keyboard.up('Control');}
  async function savedText(key,value) {
    await page.waitForFunction((key,value)=>JSON.parse(localStorage.getItem('hol:collages')||'[]')[0]?.els.find(e=>e.kind==='text')?.[key]===value,{},key,value);
  }
  async function roomX(value) { await page.waitForFunction(value=>JSON.parse(localStorage.getItem('hol:room'))?.items[0]?.x===value,{},value); }
  async function scan(label) {
    await page.evaluate(async()=>{await Promise.allSettled(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getTiming().iterations)).map(a=>a.finished))});
    const violations=await page.evaluate(async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
    assert.deepEqual(violations,[],JSON.stringify({width,label,violations}));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,label+' overflow');
    await page.screenshot({path:`artifacts/lighthouse/editor-${label}-${width}.png`});
    results.push({width,label,violations});
  }
  try {
    await page.evaluate(()=>{location.hash='studio'});
    await page.waitForSelector('.sx-rail button[aria-label="Layers"]');
    await activate('.sx-rail button[aria-label="Layers"]');
    let reached=false;
    for(let i=0;i<20;i++) {await page.keyboard.press('Tab');if(await page.evaluate(()=>document.activeElement.matches('.sx-layer-select'))){reached=true;break}}
    assert.ok(reached,'Tab reaches a named layer selection button');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.sx-layer-select[aria-pressed=true]');
    const x=Number(await page.$eval('.sx-selection input',e=>e.value));
    await page.keyboard.press('ArrowRight');await savedText('x',x+.5);
    await undo();await savedText('x',x);await undo(true);await savedText('x',x+.5);
    await number('.sx-selection input',-2.5);await savedText('x',-2.5);
    await number('.sx-selection input',1001);
    assert.ok(await page.$('.sx-selection [role=alert]'));await savedText('x',-2.5);
    await page.focus('.sx-selection input');await page.keyboard.press('Escape');
    // Native Shift+Enter selects several, grouping and ordering preserve product identities.
    await page.focus('.sx-layer:nth-child(2) .sx-layer-select');await page.keyboard.down('Shift');await page.keyboard.press('Enter');await page.keyboard.up('Shift');
    assert.equal(await page.$$eval('.sx-layer-select[aria-pressed=true]',e=>e.length),2);
    await action('.sx-selection','Group');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('hol:collages'))[0].els.filter(e=>e.g).length===2);
    await action('.sx-selection','Ungroup');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('hol:collages'))[0].els.every(e=>!e.g));
    await page.keyboard.press('Escape');await activate('.sx-layer:first-child .sx-layer-select');
    await action('.sx-selection','Send to back');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('hol:collages'))[0].els[0].kind==='text');
    await action('.sx-selection','Bring to front');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('hol:collages'))[0].els.at(-1).kind==='text');
    await scan('layers');
    await action('.sx-selbar','Type');
    const size=Number(await page.$eval('.sx-selpop input[type=range]',e=>e.value));
    await page.focus('.sx-selpop input[type=range]');await page.keyboard.press('ArrowRight');await savedText('size',Math.round((size+.2)*10)/10);
    await page.evaluate(()=>document.activeElement.blur());await undo();await savedText('size',size);
    await undo(true);await savedText('size',Math.round((size+.2)*10)/10);
    // A second edit after autosave must become dirty even if no pointer event occurs.
    await page.focus('.sx-selpop input[type=range]');await page.keyboard.press('ArrowRight');await savedText('size',Math.round((size+.4)*10)/10);
    await action('.sx-selbar','Text');await page.focus('textarea[aria-label=Text]');
    await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type('Saved first');await savedText('text','Saved first');
    await page.keyboard.type(' and second');await savedText('text','Saved first and second');
    await activate('.sx-rail button[aria-label="Add"]');
    await page.focus('[role=tab][aria-selected=true]');await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Inspo');
    assert.equal(await page.$$eval('[role=tab][tabindex="0"]',e=>e.length),1);
    await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Ideas');
    await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Pieces');
    await scan('tabs');
    await activate('.sx-rail button[aria-label="Board"]');await action('.sx-shapes','Free shape');
    await page.focus('.sx-pt');await page.keyboard.press('ArrowRight');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('hol:collages'))[0]?.poly?.[0]?.[0]===.05);
    await page.keyboard.press('Delete');await page.waitForFunction(()=>document.querySelectorAll('.sx-pt').length===3);
    assert.equal(await page.evaluate(()=>document.activeElement.matches('.sx-pt')),true,'Corner removal retains focus');
    await page.keyboard.press('Delete');assert.equal(await page.$$eval('.sx-pt',e=>e.length),3);
    await undo();await page.waitForFunction(()=>document.querySelectorAll('.sx-pt').length===4);
    await number('.sx-corner-fields input',10);
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('hol:collages'))[0]?.poly?.[0]?.[0]===.1);
    await scan('corners');
    // Pointer edits must still dirty the document before the autosave effect runs.
    const corner = await (await page.$('.sx-pt')).boundingBox();
    await page.mouse.move(corner.x+corner.width/2,corner.y+corner.height/2);await page.mouse.down();
    await page.mouse.move(corner.x+corner.width/2+12,corner.y+corner.height/2+8);await page.mouse.up();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('hol:collages'))[0]?.poly?.[0]?.[0]>.1);
    await undo();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('hol:collages'))[0]?.poly?.[0]?.[0]===.1);

    const identities=await page.evaluate(()=>JSON.parse(localStorage.getItem('hol:collages'))[0].els.filter(e=>e.kind==='img').map(e=>[e.pid,e.lid,e.vid]));
    assert.equal(identities.length,4);
    await page.evaluate(()=>{
      localStorage.setItem('hol:room',JSON.stringify({W:8,D:6,H:3,wallT:.12,floor:'oak',wall:'#FBF8F2',openings:[],rugs:[],items:[{uid:'locked-fixture',pid:1,lid:'fixture0',vid:'fixture0',x:0,z:0,rot:0,lock:true}]}));location.hash='room';
    });
    await page.waitForSelector('.pl-vp');await activate('.sx-rail button[aria-label="Layers"]');await activate('.sx-drawer .sx-layer-select');
    await page.keyboard.press('ArrowRight');await page.keyboard.press('r');await new Promise(r=>setTimeout(r,650));
    const locked=await page.evaluate(()=>JSON.parse(localStorage.getItem('hol:room')).items[0]);
    assert.equal(locked.x,0);assert.equal(locked.rot,0);assert.equal(locked.lock,true);
    assert.equal(await page.$eval('[aria-label="Rotate right 15°"]',e=>e.disabled),true);
    await activate('.sx-drawer button[aria-label=Unlock]');await page.keyboard.press('ArrowRight');await roomX(.05);
    await action('.sx-selbar-pl','Fixture 1');await number('.sx-selpop .pl-dims input',.25);await roomX(.25);
    await undo();await roomX(.05);
    await scan('room');
    await page.evaluate(()=>{location.hash='discover'});await page.waitForSelector('.pin-open');
    await page.evaluate(()=>{location.hash='room'});await page.waitForSelector('.pl-vp');await roomX(.05);
    assert.deepEqual(await page.evaluate(()=>{const i=JSON.parse(localStorage.getItem('hol:room')).items[0];return [i.pid,i.lid,i.vid]}),[1,'fixture0','fixture0']);
    assert.equal(await page.evaluate(()=>window.fixtureCommands||0),0);assert.deepEqual(pageErrors,[]);
  } catch(error) {
    await page.screenshot({path:`artifacts/lighthouse/editor-failure-${width}.png`});
    await writeFile('artifacts/lighthouse/editor-last-state.json',JSON.stringify({width,error:String(error),pageErrors,text:await page.$eval('body',e=>e.textContent)},null,2));
    throw error;
  } finally { await page.close(); }

 }
 await writeFile("artifacts/lighthouse/editor-keyboard-browser.json",JSON.stringify({scope:"Actual components with synthetic catalog, blocked backend/auth/AI/payment calls",results},null,2));
 console.log(JSON.stringify(results));
} finally {await browser.close()}
