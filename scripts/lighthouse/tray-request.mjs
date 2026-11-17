/* global document, window, location, localStorage */
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
  convex: `import{getFunctionName}from'convex/server';export const useQuery=(ref)=>getFunctionName(ref)==='holm:me'?{signedIn:true,verified:true,admin:false,tradeStatus:'approved',businessName:'',email:''}:getFunctionName(ref)==='holmSync:load'?window.fixtureRemote:undefined;export const useQueries=q=>Object.fromEntries(Object.entries(q).map(([k,v])=>[k,window.fixtureLookupPending?undefined:v.args.productIds?v.args.productIds.map(productId=>({productId,item:window.fixtureLookup?.id===productId?window.fixtureLookup:null})):{ready:true,items:v.args.legacyIds.map(legacyId=>({legacyId,status:'unavailable',item:null}))}]));export const useMutation=ref=>async()=>{if(getFunctionName(ref)==='holm:ensureProfile'||getFunctionName(ref)==='holmSync:save')return null;window.fixtureCommands=(window.fixtureCommands||0)+1;return new Promise((_,reject)=>{window.rejectFixtureQuote=()=>reject({data:{code:'RATE_LIMITED',message:'You have sent several requests. Please wait an hour before sending another.'}})})};export const usePaginatedQuery=()=>({results:[],status:'Exhausted',loadMore(){}});export const useAction=useMutation;export const useConvexAuth=()=>({isLoading:false,isAuthenticated:false});`,
};
const entry = `import React from'react';import{createRoot}from'react-dom/client';import{App,setProducts}from'./trade/app';import{holmLegacyId}from'./lib/holmProductIdentity';const image='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';const products=Array.from({length:24},(_,i)=>({id:i+1,lid:'fixture'+i,vid:'fixture'+i,variants:[],name:'Fixture '+(i+1),full:'Fixture '+(i+1),line:'Chair',type:'sofa',mat:'leather',tone:'#6B4A33',price:100,trade:80,seats:1,oos:false,note:'Fixture only',facts:'',img:image,imgs:[image],ar:1,sku:'FIXTURE',likes:0,widthCm:50,dimsCm:{w:50,d:50,h:50},dimsSource:'fixture',cutout:null,cutAR:null,model:null,modelLow:null,hangs:false,mountCm:null,minimum:1,increment:1,checkoutMode:'quote'}));if(window.fixtureHydrated){const source='saved-source';window.fixtureSavedPid=holmLegacyId(source);window.fixtureLookup={id:source,name:'Offpage Chair',description:'Verified fixture',category:'Chairs',images:[image],facts:'',inStock:true,variants:[{id:'oak',name:'Oak',minimum:2,increment:2,retail:10000,trade:8000}]};localStorage.setItem('hol:tray',JSON.stringify({active:'offpage',projects:[{id:'offpage',name:'Offpage project',target:2,zones:['Main room'],items:[{pid:window.fixtureSavedPid,lid:source,vid:'oak',qty:2,zone:'Main room'}]}],later:[]}));}if(window.fixtureBoardHydrated){window.fixtureLookup.variants.unshift({id:'walnut',name:'Walnut',minimum:1,increment:1,retail:20000,trade:16000});localStorage.setItem('hol:boards',JSON.stringify([{id:'b1',title:'Verified saved board',sections:['Main'],pins:[{pid:window.fixtureSavedPid,lid:'saved-source',vid:'oak',sec:'Main'}]}]));location.hash='board';}window.fixtureRefresh=()=>setProducts(products);setProducts(products);createRoot(document.getElementById('root')).render(<App/>);`;
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
const page = await browser.newPage();
const pageErrors = [];
try {
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
    const clickText = async (text) => {
      const selector = await page.evaluate((text) => {
        const node = [...document.querySelectorAll('.tv button')].find((n) =>
          n.textContent.trim().startsWith(text)
        );
        if (!node) throw Error('Missing button ' + text);
        node.setAttribute('data-fixture-action', 'next');
        return '[data-fixture-action="next"]';
      }, text);
      await page.click(selector);
      await page.evaluate(() =>
        document.querySelector('[data-fixture-action]')?.removeAttribute('data-fixture-action')
      );
    };
    const before = await page.evaluate(() => window.fixtureCommands || 0);
    await clickText('Continue to delivery');
    await page.waitForFunction(
      () => document.activeElement?.textContent === 'Project tray · Delivery'
    );
    await clickText('Review request');
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'alert');
    assert.equal(await page.$$eval('[role=alert] a', (nodes) => nodes.length), 5);
    assert.equal(await page.evaluate(() => window.fixtureCommands || 0), before);
    for (const [key, value] of Object.entries({
      name: 'Fixture contact',
      email: 'fixture@example.com',
      line1: '123 Fixture St',
      city: 'Stockton',
      state: 'CA',
      postal: '95206',
    }))
      await page.type('#tv-' + key, value);
    await clickText('Back');
    await page.click('.tv-line .tv-th');
    await page.waitForSelector('.pp');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.tv-line');
    await page.waitForSelector('dialog[open][aria-label="Project tray"]');
    await page.evaluate(async () => {
      await Promise.all(document.querySelector('dialog[open]').getAnimations({ subtree: true })
        .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {})));
    });
    await clickText('Continue to delivery');
    assert.equal(await page.$eval('#tv-name', node => node.value), 'Fixture contact');
    assert.equal(await page.$eval('#tv-line1', node => node.value), '123 Fixture St');
    await clickText('Review request');
    await page.waitForFunction(
      () => document.activeElement?.textContent === 'Project tray · Review'
    );
    await clickText('Request final quote');
    await page.waitForFunction(() => window.fixtureCommands === 1);
    assert.equal(await page.$eval('.tv-body', (node) => node.disabled), true);
    assert.equal(await page.$eval('#tv-team', (node) => node.matches(':disabled')), true);
    await page.evaluate(() => document.querySelector('.tv-sum .btn-cog').click());
    assert.equal(await page.evaluate(() => window.fixtureCommands), 1);
    await page.evaluate(() => window.rejectFixtureQuote());
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'alert');
    assert.match(await page.$eval('[role=alert]', node => node.textContent), /Please wait an hour/);
    await clickText('Back');
    assert.equal(await page.$eval('#tv-name', (node) => node.value), 'Fixture contact');
    assert.equal(await page.$eval('#tv-email', (node) => node.value), 'fixture@example.com');
    const violations = await page.evaluate(async () =>
      (await axe.run(document.querySelector('dialog'))).violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      }))
    );
    assert.deepEqual(violations, []);
    await page.screenshot({
      path: `artifacts/lighthouse/tray-request-${width}.png`,
      fullPage: false,
    });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog'));
    await page.evaluate(() => {
      window.fixtureCommands = 0;
    });
    results.push({
      width,
      height,
      violations,
      localValidation: true,
      pendingGuard: true,
      rejectedDraftRetained: true,
    });
  }
  for (const source of ['local', 'account']) {
    await page.goto('http://fixture.invalid');
    await page.evaluate((source) => {
      location.hash = 'discover';
      localStorage.clear();
      const tray = { active: 'saved', projects: [{ id: 'saved', name: 'Saved project', target: 2, zones: ['Main room'], items: [{ pid: 99999, lid: 'missing-source', vid: 'missing-option', qty: 2, zone: 'Main room' }] }], later: [{ pid: 99998, lid: 'later-source', vid: 'later-option', qty: 1 }] };
      const boards = [{ id: 'saved-board', title: 'Retained board', sections: ['Main'], pins: [{ pid: 99999, sec: 'Main' }] }];
      const collages = [{ id: 'saved-collage', title: 'Retained collage', els: [{ id: 'image', kind: 'img', pid: 99999, x: 1, y: 2 }] }];
      if (source === 'local') {
        localStorage.setItem('hol:tray', JSON.stringify(tray));
        localStorage.setItem('hol:boards', JSON.stringify(boards));
        localStorage.setItem('hol:collages', JSON.stringify(collages));
      } else window.fixtureRemote = { tray, boards, collages };
    }, source);
    await page.addStyleTag({ content: await readFile('dist/assets/' + css, 'utf8') });
    for (const f of bundle.outputFiles.filter((f) => f.path.endsWith('.css'))) await page.addStyleTag({ content: f.text });
    await page.addStyleTag({ content: await readFile('trade/style.css', 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles.find((f) => f.path.endsWith('.js')).text });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('hol:tray') || '{}').projects?.some(p => p.id === 'saved'));
    await page.click('#trayBtn');
    await page.waitForSelector('.tv');
    assert.match(await page.$eval('.tv-main', node => node.textContent), /Saved item 99999 is no longer available/);
    assert.doesNotMatch(await page.$eval('.tv-main', node => node.textContent), /This project is empty/);
    assert.equal(await page.$eval('.tv-sum .btn-ink', node => node.disabled), true);
    assert.match(await page.$eval('.tv-sum .total', node => node.textContent), /Review unavailable items/);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('hol:tray')));
    assert.equal(saved.projects[0].items[0].lid, 'missing-source');
    assert.equal(saved.later[0].vid, 'later-option');
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Saved for later')).click());
    assert.match(await page.$eval('.tv-main', node => node.textContent), /Saved item 99998 is no longer available/);
    assert.doesNotMatch(await page.$eval('.tv-main', node => node.textContent), /Nothing saved for later/);
    assert.equal(await page.evaluate(() => window.fixtureCommands || 0), 0);
    await page.keyboard.press('Escape');
    await page.evaluate(() => { location.hash = 'board'; });
    await page.waitForFunction(() => document.querySelector('main')?.textContent.includes('Retained board'));
    assert.match(await page.$eval('main', node => node.textContent), /Unavailable item/);
    const retained = await page.evaluate(() => ({ boards: JSON.parse(localStorage.getItem('hol:boards')), collages: JSON.parse(localStorage.getItem('hol:collages')) }));
    assert.equal(retained.boards[0].pins[0].pid, 99999);
    assert.equal(retained.collages[0].els[0].pid, 99999);
    await page.evaluate(() => [...document.querySelectorAll('main button')].find(b => b.textContent === 'Shop').click());
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('main button')].find(b => b.textContent === 'Add all to tray').disabled), true);
    assert.equal(await page.evaluate(() => window.fixtureCommands || 0), 0);
    await page.evaluate(() => [...document.querySelectorAll('main button')].find(b => b.textContent.trim() === 'Share').click());
    await page.waitForSelector('dialog[aria-label="Review unavailable items"]');
    assert.equal(await page.evaluate(() => window.fixtureCommands || 0), 0);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog'));
    await page.evaluate(() => {
      localStorage.setItem('hol:room', JSON.stringify({ W: 9, D: 7, H: 3, wall: '#F1E9DC', floor: 'oak', rugs: [], openings: [{wall:'back',t:'win',x:0,w:2,h:1,y:1}], items: [{ uid: 'first', pid: 99999, x: -2, z: 3, rot: 45 }, { uid: 'second', pid: 99998, x: 4, z: -1, rot: 10 }] }));
      location.hash = 'room';
    });
    await page.waitForFunction(() => document.querySelector('main h1')?.textContent === 'Review saved room items');
    const roomBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('hol:room')));
    assert.equal(roomBefore.items.length, 2);
    assert.equal(roomBefore.items[0].x, -2);
    await page.evaluate(() => [...document.querySelectorAll('main button')].find(b => b.textContent === 'Remove saved item 99999').click());
    const roomAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('hol:room')));
    assert.deepEqual(roomAfter.items, [roomBefore.items[1]]);
    await page.evaluate(() => [...document.querySelectorAll('main button')].find(b => b.textContent === 'Remove saved item 99998').click());
    await page.waitForFunction(() => !document.querySelector('main h1')?.textContent?.includes('Review saved room items'));
    await new Promise(resolve => globalThis.setTimeout(resolve, 600));
    const emptyRoom = await page.evaluate(() => JSON.parse(localStorage.getItem('hol:room')));
    assert.deepEqual(emptyRoom.items, []);
    assert.deepEqual([emptyRoom.W, emptyRoom.D, emptyRoom.H], [9, 7, 3]);
    assert.deepEqual(emptyRoom.openings, roomBefore.openings);
    assert.equal(await page.evaluate(() => window.fixtureCommands || 0), 0);
    results.push({ source, missingDraftRetained: true, boardsAndCollagesRetained: true, unavailableBoardPurchaseBlocked: true, unavailableSharingBlocked: true, plannerRetainedUntilExplicitRemoval: true, checkoutBlocked: true, businessCommands: 0 });
  }
  await page.goto('http://fixture.invalid');
  await page.evaluate(() => { localStorage.clear(); location.hash='discover'; window.fixtureHydrated=true; });
  await page.addStyleTag({content:await readFile('dist/assets/'+css,'utf8')});
  for (const file of bundle.outputFiles.filter(file=>file.path.endsWith('.css'))) await page.addStyleTag({content:file.text});
  await page.addStyleTag({content:await readFile('trade/style.css','utf8')});
  await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
  await page.waitForSelector('#trayBtn');
  await page.click('#trayBtn');
  await page.waitForFunction(()=>document.querySelector('.tv-main')?.textContent.includes('Offpage'));
  assert.equal(await page.$eval('.tv-sum .btn-ink',node=>node.disabled),false);
  assert.equal(await page.$eval('.tv-line .tv-th',node=>node.disabled),false);
  await page.click('.tv-line .tv-th');
  await page.waitForFunction(()=>document.querySelector('.pp h1')?.textContent==='Offpage');
  assert.equal(await page.$eval('button[aria-label="Next piece"]',node=>node.disabled),true);
  assert.equal(await page.$eval('button[aria-label="Previous piece"]',node=>node.disabled),true);
  assert.match(await page.$eval('.pp-price',node=>node.textContent),/80/);
  await page.addScriptTag({content:axe.source});
  const detailChecks=[];
  for (const width of [320,844,1440]) {
    await page.setViewport({width,height:width===844?390:900});
    await page.evaluate(async()=>{
      await document.fonts.ready;
      await Promise.all(document.querySelector('dialog').getAnimations({subtree:true})
        .filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity)
        .map(animation=>animation.finished.catch(()=>{})));
    });
    const violations=await page.evaluate(async()=>(await axe.run(document.querySelector('dialog'))).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
    assert.deepEqual(violations,[]);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
    const screenshot=`offpage-detail-${width}.png`;
    await page.screenshot({path:`artifacts/lighthouse/${screenshot}`});
    detailChecks.push({width,violations,overflow:false,screenshot});
  }
  await page.click('.pp-add');
  const afterDetailAdd=await page.evaluate(()=>JSON.parse(localStorage.getItem('hol:tray')).projects[0].items);
  assert.equal(afterDetailAdd.length,1);
  assert.equal(afterDetailAdd[0].qty,4);
  assert.equal(afterDetailAdd[0].vid,'oak');
  assert.equal(afterDetailAdd[0].lid,'saved-source');
  await page.evaluate(()=>[...document.querySelectorAll('dialog button')].find(button=>button.textContent.trim()==='Save').click());
  await page.waitForSelector('.boardpick');
  await page.evaluate(()=>[...document.querySelectorAll('.boardpick button')].find(button=>button.textContent.includes('Create board')).click());
  await page.type('#nb-name','Saved Oak selection');
  await page.evaluate(()=>[...document.querySelectorAll('.boardpick button')].find(button=>button.textContent==='Create and save').click());
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('hol:boards')).some(board=>board.title==='Saved Oak selection'));
  const savedSelection=await page.evaluate(()=>JSON.parse(localStorage.getItem('hol:boards')).find(board=>board.title==='Saved Oak selection').pins[0]);
  assert.equal(savedSelection.lid,'saved-source');assert.equal(savedSelection.vid,'oak');
  await page.evaluate(()=>{window.fixtureLookupPending=true;window.fixtureRefresh();});
  await page.waitForFunction(()=>document.querySelector('dialog[aria-label="Product availability"]')?.textContent.includes('being checked'));
  assert.equal(await page.$('.pp-add'),null);
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{window.fixtureLookupPending=false;window.fixtureRefresh();});
  await page.waitForFunction(()=>document.querySelector('.tv-main')?.textContent.includes('Offpage'));
  await page.evaluate(()=>{window.fixtureLookupPending=true;window.fixtureRefresh();});
  await page.waitForFunction(()=>document.querySelector('.tv-main')?.textContent.includes('being checked'));
  assert.match(await page.$eval('.tv-sum .total',node=>node.textContent),/Checking saved items/);
  assert.equal(await page.$eval('.tv-sum .btn-ink',node=>node.disabled),true);
  await page.evaluate(()=>{window.fixtureLookupPending=false;window.fixtureLookup=null;window.fixtureRefresh();});
  await page.waitForFunction(()=>document.querySelector('.tv-main')?.textContent.includes('no longer available'));
  assert.equal(await page.$eval('.tv-sum .btn-ink',node=>node.disabled),true);
  const retainedOffpage=await page.evaluate(()=>JSON.parse(localStorage.getItem('hol:tray')));
  assert.equal(retainedOffpage.projects[0].items[0].qty,4);
  assert.equal(retainedOffpage.projects[0].items[0].vid,'oak');
  assert.equal(await page.evaluate(()=>window.fixtureCommands||0),0);
  results.push({offpageProjectHydrated:true,offpageDetailsVerified:true,detailChecks,pendingDetailsBlockActions:true,withdrawalBlocksCheckout:true,savedVariantAndQuantityRetained:true,afterDetailAdd,businessCommands:0});
  await page.goto('http://fixture.invalid');
  await page.evaluate(()=>{localStorage.clear();window.fixtureHydrated=true;window.fixtureBoardHydrated=true;});
  await page.addStyleTag({content:await readFile('dist/assets/'+css,'utf8')});
  for (const file of bundle.outputFiles.filter(file=>file.path.endsWith('.css'))) await page.addStyleTag({content:file.text});
  await page.addStyleTag({content:await readFile('trade/style.css','utf8')});
  await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
  await page.waitForFunction(()=>document.querySelector('main h1')?.textContent==='Verified saved board');
  await page.evaluate(()=>[...document.querySelectorAll('main button')].find(button=>button.textContent==='Shop').click());
  await page.click('main button.th');
  await page.waitForSelector('.pp-price');
  assert.match(await page.$eval('.pp-price', node => node.textContent), /80/);
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>[...document.querySelectorAll('main button')].some(button=>button.textContent==='Add all to tray'&&!button.disabled));
  assert.match(await page.$eval('main',node=>node.textContent),/Offpage/);
  await page.evaluate(()=>[...document.querySelectorAll('main button')].find(button=>button.textContent==='Add all to tray').click());
  const boardAdd=await page.evaluate(()=>JSON.parse(localStorage.getItem('hol:tray')).projects[0].items);
  assert.equal(boardAdd.length,1);assert.equal(boardAdd[0].qty,4);assert.equal(boardAdd[0].vid,'oak');assert.equal(boardAdd[0].lid,'saved-source');
  await page.evaluate(()=>{location.hash='boards';});
  await page.waitForFunction(()=>document.querySelector('main h1')?.textContent.includes('Boards &'));
  await page.waitForFunction(()=>document.querySelector('.bcard .cov > div')?.style.backgroundImage.includes('data:image'));
  await page.evaluate(()=>[...document.querySelectorAll('main button')].find(button=>button.textContent==='Pins').click());
  await page.waitForSelector('main button[aria-label="Add Offpage to project tray"]');
  await page.click('main button[aria-label="Add Offpage to project tray"]');
  const shelfAdd=await page.evaluate(()=>JSON.parse(localStorage.getItem('hol:tray')).projects[0].items);
  assert.equal(shelfAdd.length,1);assert.equal(shelfAdd[0].qty,6);assert.equal(shelfAdd[0].vid,'oak');
  await page.evaluate(()=>{location.hash='profile';});
  await page.waitForFunction(()=>document.querySelector('.bcard .cov > div')?.style.backgroundImage.includes('data:image'));
  await page.evaluate(()=>{location.hash='board';});
  await page.waitForFunction(()=>document.querySelector('main h1')?.textContent==='Verified saved board');
  await page.evaluate(()=>[...document.querySelectorAll('main button')].find(button=>button.textContent==='Shop').click());
  await page.evaluate(()=>{window.fixtureLookupPending=true;window.fixtureRefresh();});
  await page.waitForFunction(()=>document.querySelector('main [role="status"]')?.textContent.includes('Checking saved products'));
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('main button')].find(button=>button.textContent==='Add all to tray').disabled),true);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('hol:boards'))[0].pins.length),1);
  await page.evaluate(()=>{window.fixtureLookupPending=false;window.fixtureLookup.variants=window.fixtureLookup.variants.filter(option=>option.id!=='oak');window.fixtureRefresh();});
  await page.waitForFunction(()=>document.querySelector('main')?.textContent.includes('Unavailable item'));
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('main button')].find(button=>button.textContent==='Add all to tray').disabled),true);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('hol:boards'))[0].pins[0].vid),'oak');
  assert.equal(await page.evaluate(()=>window.fixtureCommands||0),0);
  results.push({offpageBoardHydrated:true,independentBoardAndProfileCovers:true,shelfAddPreservesVariantAndPack:true,nondefaultBoardVariantAndQuantityPreserved:true,pendingBoardPurchaseBlocked:true,removedVariantNotSubstituted:true,businessCommands:0});
  await page.goto('http://fixture.invalid');
  await page.evaluate(()=>{localStorage.clear();localStorage.setItem('hol:boards','[]');location.hash='board';});
  await page.addStyleTag({content:await readFile('trade/style.css','utf8')});
  await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
  await page.waitForFunction(()=>document.querySelector('main h1')?.textContent==='Board unavailable');
  results.push({deletedBoardRecovery:true,businessCommands:0});
  assert.deepEqual(pageErrors, []);
  await writeFile(
    'artifacts/lighthouse/tray-request-browser.json',
    JSON.stringify(results, null, 2)
  );
  console.log(JSON.stringify(results));
} finally {
  await writeFile('artifacts/lighthouse/tray-request-last-state.json', JSON.stringify({ errors: pageErrors, body: await page.evaluate(()=>document.body.innerText).catch(()=>null) }, null, 2));
  await browser.close();
}

