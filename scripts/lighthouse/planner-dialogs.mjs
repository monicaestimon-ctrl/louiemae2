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
const entry = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{FloorPlanEditor,AiRender}from'./trade/app';function Fixture(){const[open,setOpen]=useState(false);return <><button id="opener" onClick={()=>setOpen(true)}>Open floor plan</button>{open&&(window.fixtureKind==='ai'?<AiRender ctx={{}} id="fixture" onClose={()=>setOpen(false)} onRetry={()=>{throw Error("Generation prohibited")}} onShare={()=>{throw Error("Sharing prohibited")}}/>:<FloorPlanEditor ctx={{me:{signedIn:false},toast(){}}} doc={{floor:'oak',wall:'cream'}} units="m" onClose={()=>setOpen(false)} onApply={()=>{throw Error('Apply prohibited')}}/>)}</>};createRoot(document.getElementById('root')).render(<Fixture/>);`;
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
        b.onLoad({ filter: /[\\/]trade[\\/]app\.ts$/ }, async () => ({
          contents:
            (await readFile('trade/app.ts', 'utf8')) + '\nexport {FloorPlanEditor,AiRender};',
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
    enterClosesDraft: true,
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
