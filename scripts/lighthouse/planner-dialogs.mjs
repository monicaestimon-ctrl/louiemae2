/* global document, window, location, setTimeout */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
const assets = await readdir('dist/assets').catch((cause) => {
  throw new Error('Missing production assets. Run npm run build first.', { cause });
});
const css = assets.find((file) => /^trade-.*\.css$/.test(file));
assert.ok(css, 'Missing trade stylesheet. Run npm run build first.');
const stubs = {
  auth: `export const useAuthActions=()=>({signIn:async()=>{throw Error('No auth permitted')},signOut:async()=>{throw Error('No auth permitted')}});export const useAuthToken=()=>null;`,
  convex: `import{getFunctionName}from'convex/server';export const useQuery=(ref)=>getFunctionName(ref)==='holmRender:one'?window.fixtureRender:getFunctionName(ref)==='holm:me'?{signedIn:false,verified:false,admin:false,tradeStatus:'none'}:undefined;export const useQueries=q=>Object.fromEntries(Object.keys(q).map(k=>[k,undefined]));export const useMutation=()=>async()=>{window.fixtureCommands=(window.fixtureCommands||0)+1;throw Error('No mutation permitted')};export const usePaginatedQuery=()=>({results:[],status:'Exhausted',loadMore(){}});export const useAction=useMutation;export const useConvexAuth=()=>({isLoading:false,isAuthenticated:false});`,
};
const entry = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{FloorPlanEditor,AiRender}from'./trade/editors';function Fixture(){const[open,setOpen]=useState(false);return <><button id="opener" onClick={()=>setOpen(true)}>Open floor plan</button>{open&&(window.fixtureKind==='ai'?<AiRender ctx={{}} id="fixture" onClose={()=>setOpen(false)} onRetry={()=>{throw Error("Generation prohibited")}} onShare={()=>{throw Error("Sharing prohibited")}}/>:<FloorPlanEditor ctx={{me:{signedIn:false},toast(){}}} doc={{floor:'oak',wall:'cream'}} units="m" onClose={()=>setOpen(false)} onApply={value=>{window.fixturePlan=value}}/>)}</>};createRoot(document.getElementById('root')).render(<Fixture/>);`;
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
        b.onLoad({ filter: /[\\/]trade[\\/]editors\.ts$/ }, async () => ({
          contents:
            (await readFile('trade/editors.ts', 'utf8')) + '\nexport {FloorPlanEditor,AiRender};',
          loader: 'ts',
          resolveDir: resolve('trade'),
        }));
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
  await page.setContent(
    '<!doctype html><html lang="en"><head><title>HOLM integration fixture</title><meta http-equiv="Content-Security-Policy" content="connect-src \'none\';img-src data:"></head><body><div id="root"></div></body></html>'
  );
  await page.evaluate(() => {
    location.hash = 'discover';
  });
  await page.addStyleTag({ content: await readFile('dist/assets/' + css, 'utf8') });
  for (const f of bundle.outputFiles.filter((f) => f.path.endsWith('.css')))
    await page.addStyleTag({ content: f.text });
  await page.addStyleTag({ content: await readFile('trade/style.css', 'utf8') });
  await page.addScriptTag({ content: bundle.outputFiles.find((f) => f.path.endsWith('.js')).text });
  await page.waitForSelector('#opener');
  await page.click('#opener');
  await page.waitForSelector('dialog[open]');
  await page.evaluate(() => [...document.querySelectorAll('button')].find(e => e.textContent === 'Scale').click());
  const calibration = await (await page.$('.fp-sheet svg')).boundingBox();
  await page.mouse.click(calibration.x + calibration.width * .25, calibration.y + calibration.height * .25);
  await page.mouse.click(calibration.x + calibration.width * .25, calibration.y + calibration.height * .25);
  await page.type('input[aria-label="Real length of the wall"]', '2');
  await page.evaluate(() => [...document.querySelectorAll('button')].find(e => e.textContent === 'Set scale').click());
  await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent.includes('distinct points'));
  assert.equal(await page.$eval('.fp-tools .seg .on', e => e.textContent), 'Scale');
  assert.ok(await page.evaluate(() => document.body.textContent.includes('1 px = 2.0 cm')), 'Previous valid scale retained');
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find((e) => e.textContent === 'Draw a room').click()
  );
  const svg = await page.$('.fp-sheet svg');
  const rect = await svg.boundingBox();
  await page.mouse.click(rect.x + rect.width * 0.25, rect.y + rect.height * 0.25);
  await page.mouse.click(rect.x + rect.width * 0.5, rect.y + rect.height * 0.25);
  assert.equal(await page.$$eval('.fp-draft', (e) => e.length), 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.$$eval('dialog[open]', (e) => e.length), 1);
  assert.equal(await page.$$eval('.fp-draft', (e) => e.length), 0);
  await page.mouse.click(rect.x + rect.width * 0.25, rect.y + rect.height * 0.25);
  await page.mouse.click(rect.x + rect.width * 0.5, rect.y + rect.height * 0.25);
  await page.mouse.click(rect.x + rect.width * 0.5, rect.y + rect.height * 0.5);
  await page.keyboard.press('Enter');
  assert.equal(await page.$$eval('.fp-zone', (e) => e.length), 1);
  assert.equal(await page.$$eval('.fp-draft', (e) => e.length), 0);
  for (let i = 0; i < 35; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog')), true);
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'opener');
  assert.equal(await page.evaluate(() => window.fixtureCommands || 0), 0);
  // Coordinate entry exercises the real editor without pointer drawing or backend commands.
  const activate = async text => {
    await page.evaluate(text => [...document.querySelectorAll('button')].find(e => e.textContent.trim() === text).focus(), text);
    await page.keyboard.press('Enter');
  };
  const number = async (index, value) => {
    const fields = await page.$$('.fp-point-entry input');
    await fields[index].focus();
    await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');
    await page.keyboard.type(String(value));await page.keyboard.press('Enter');
  };
  const point = async (x,y) => {await number(0,x);await number(1,y);await activate('Add corner')};
  await activate('Open floor plan');await activate('Draw a room');
  await point(10,10);await point(30,10);await point(50,10);await activate('Finish room');
  await page.waitForFunction(() => document.querySelector('[role=alert]')?.textContent.includes('without crossing'));
  assert.equal(await page.$$eval('.fp-zone', e=>e.length),0);
  assert.ok(await page.$eval('.fp-point-entry',e=>e.textContent.includes('3 corners placed')));
  await activate('Undo last point');await point(30,40);await point(10,40);await activate('Finish room');
  await page.waitForSelector('.fp-zone');
  await activate('Draw a room');await point(60,10);await point(70,10);await point(80,10);
  await activate('Finish room');await activate('Use this plan');
  await page.waitForFunction(()=>document.querySelector('[role=alert]')?.textContent.includes('Finish or discard'));
  assert.equal(await page.evaluate(()=>window.fixturePlan),undefined,'An unfinished draft prevents apply even with an existing valid room');
  assert.ok(await page.$eval('.fp-point-entry',e=>e.textContent.includes('3 corners placed')));
  await page.keyboard.press('Escape');
  await activate('Columns');await activate('Place column');
  await page.addScriptTag({ content: axe.source });
  for (const width of [390,1440]) {
    await page.setViewport({width,height:900});
    const layout = await page.$eval('.fp-block-coordinates',e=>{
      const row=e.getBoundingClientRect(),fields=[...e.querySelectorAll('input')].map(i=>{const r=i.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}});
      return {width:row.width,fields,overflow:e.scrollWidth>e.clientWidth};
    });
    assert.equal(layout.overflow,false);assert.ok(layout.fields.every(f=>f.width>=90));
    assert.ok(layout.fields[0].right<=layout.fields[1].left,'Column coordinates do not overlap');
    await page.$eval('.fp-block-coordinates',e=>e.scrollIntoView({block:'center'}));
    await page.screenshot({path:`artifacts/lighthouse/planner-blocks-${width}.png`});
    const violations=await page.evaluate(async()=> (await axe.run(document.querySelector('dialog'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
    assert.deepEqual(violations,[],JSON.stringify({width,violations}));
  }
  await page.setViewport({width:390,height:844});
  await activate('Use this plan');
  const plan = await page.evaluate(()=>window.fixturePlan);
  assert.ok(plan && plan.W>0 && plan.D>0, 'Coordinate-only plan has a valid area');
  assert.equal(plan.zones[0].poly.length,4);
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
  await page.addScriptTag({ content: axe.source });
  const states = [];
  for (const state of ['rendering', 'ready', 'failed']) {
    await page.evaluate((state) => {
      window.fixtureKind = 'ai';
      window.fixtureRender = {
        status: state,
        title: 'Fixture room',
        error: 'Fixture generation failure',
        url:
          state === 'ready'
            ? 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
            : undefined,
      };
    }, state);
    await page.click('#opener');
    await page.waitForSelector('dialog[open]');
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog')), true);
    }
    await new Promise((r) => setTimeout(r, 1200));
    const violations = await page.evaluate(async () =>
      (await axe.run(document.querySelector('dialog'))).violations.map((v) => v.id)
    );
    assert.deepEqual(violations, []);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog'));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'opener');
    states.push({ state, violations, focusRestored: true });
  }
  assert.deepEqual(pageErrors, []);
  assert.equal(await page.evaluate(() => window.fixtureCommands || 0), 0);
  const result = {
    scope: 'Actual FloorPlanEditor, local draw only, no uploads or commands',
    draftEscapeBeforeClose: true,
    coincidentCalibrationRejected: true,
    enterClosesDraft: true,
    coordinateOnlyRoomApplied: true,
    unfinishedDraftBlocksApply: true,
    columnCoordinatesFitMobileAndDesktop: true,
    degenerateDraftRetainedAndRepaired: true,
    tabContained: true,
    focusRestored: true,
    renderStates: states,
  };
  await writeFile(
    'artifacts/lighthouse/planner-dialogs-browser.json',
    JSON.stringify(result, null, 2)
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
