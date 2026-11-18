/* global window, document */
import { build } from 'esbuild';
import { URL } from 'node:url';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const directory = 'artifacts/lighthouse/board-controls';
await mkdir(directory, { recursive: true });
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{SaveBoardMenu}from'./trade/SaveBoardMenu';
import{CatalogProductCard}from'./trade/CatalogProductCard';
import{Modal}from'./components/Modal';
const product={id:42,lid:'source',vid:'walnut',name:'Chair',line:'Walnut',price:199,trade:179,img:'/images/product-unavailable.svg',ar:1};
const boards=[{id:'b1',title:'Living room',pins:[{pid:42,lid:'source',vid:'walnut'}]},{id:'b2',title:'Private study',secret:true,pins:[]}];
const save=(p,b)=>window.saves.push({p,b});const create=(title,p)=>{window.creates.push({title,p});return 'new'};
function Card(){return <div style={{width:180,marginLeft:'auto'}}><CatalogProductCard product={product} boards={boards} mode='trade' available pinterestUrl='https://www.pinterest.com/' icons={{down:null,pinterest:null,studio:null,add:null}} onOpen={()=>{}} onSave={save} onStudio={()=>{}} onAdd={()=>{}} renderSaveMenu={(close,trigger)=><SaveBoardMenu returnFocus={trigger} align='left' product={product} catalog={new Map()} boards={boards} onSave={save} onCreate={create} onClose={close}/>}/><button id='after' style={{position:'fixed',bottom:12,left:12}}>After picker</button></div>}
function Content(){const[open,setOpen]=useState(false);return <><button id="before">Before picker</button><div className="pin" style={{width:90,marginLeft:'auto'}}><button id="trigger" onClick={()=>setOpen(true)}>Save piece</button>{open&&<SaveBoardMenu align="left" product={product} catalog={new Map()} boards={[{id:'b1',title:'Living room',pins:[]},{id:'b2',title:'Private study',secret:true,pins:[]}]} onSave={(p,b)=>window.saves.push({p,b})} onCreate={(title,p)=>{window.creates.push({title,p});return 'new'}} onClose={()=>setOpen(false)}/>}</div><button id="after" style={{position:"fixed",bottom:12,left:12}}>After picker</button></>}
function Fixture(){const[modal,setModal]=useState(window.nested);return <main style={{padding:24}}><h1>Save a piece</h1>{window.nested?<Modal open={modal} label="Product details" onClose={()=>{window.parentClosed++;setModal(false)}}><div style={{padding:24,width:'min(600px,100vw)'}}><h2>Chair</h2><Content/></div></Modal>:(window.card?<Card/>:<Content/>)}</main>}
createRoot(document.getElementById('root')).render(<Fixture/>);`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  outdir: 'tmp/board-browser',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'read-only-shelf',
      setup(b) {
        b.onResolve({ filter: /useSavedBoardShelf$/ }, () => ({
          path: 'shelf',
          namespace: 'fixture',
        }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: 'export const useSavedBoardShelf=()=>({productFor:()=>null})',
          loader: 'js',
        }));
      },
    },
  ],
});
const css = await readFile('trade/style.css', 'utf8');
const browser = await puppeteer.launch({
  headless: true,
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: 'chrome' }),
});
const results = [];
try {
  for (const width of [320, 390, 844, 1440])
    for (const mode of ['page', 'nested', 'card']) {
      const nested = mode === 'nested';
      const page = await browser.newPage();
      await page.setViewport({ width, height: 700 });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setRequestInterception(true);
      page.on('request', async (r) => {
        if (r.isNavigationRequest())
          return r.respond({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Board picker fixture</title></head><body><div id="root"></div></body></html>',
          });
        const u = new URL(r.url());
        if (
          u.origin === 'https://fixture.invalid' &&
          u.pathname === '/images/product-unavailable.svg'
        )
          return r.respond({
            status: 200,
            contentType: 'image/svg+xml',
            body: await readFile('public/images/product-unavailable.svg'),
          });
        if (
          u.origin === 'https://fixture.invalid' &&
          /^\/fonts\/[a-z0-9-]+\.woff2$/.test(u.pathname)
        )
          return r.respond({
            status: 200,
            contentType: 'font/woff2',
            body: await readFile('public' + u.pathname),
          });
        return r.abort();
      });
      await page.goto('https://fixture.invalid');
      await page.evaluate((n) => {
        window.nested = n === 'nested';
        window.card = n === 'card';
        window.saves = [];
        window.creates = [];
        window.parentClosed = 0;
      }, mode);
      await page.addStyleTag({
        content:
          css +
          bundle.outputFiles
            .filter((f) => f.path.endsWith('.css'))
            .map((f) => f.text)
            .join(''),
      });
      await page.addScriptTag({
        content: bundle.outputFiles.find((f) => f.path.endsWith('.js')).text,
      });
      if (mode === 'card') {
        await page.waitForSelector('[aria-label="Saved Chair to board"]');
        await page.$eval('[aria-label="Saved Chair to board"]', (b) => (b.id = 'trigger'));
      }
      await page.waitForSelector('#trigger');
      await page.click('#trigger');
      await page.waitForSelector('[aria-label="Search your boards"]');
      await page.evaluate(() => document.fonts.ready);
      const bounds = await page.$eval('.boardpick', (el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      });
      assert(
        bounds.left >= 11 && bounds.right <= width - 11,
        JSON.stringify({ width, nested, bounds })
      );
      assert(bounds.top >= 11 && bounds.bottom <= 689);
      assert.equal(
        await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
        'Search your boards'
      );
      await page.screenshot({ path: `${directory}/${width}-${mode}-open.png` });
      await page.addScriptTag({ content: axe.source });
      const audit = await page.evaluate(() =>
        axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] },
        })
      );
      assert.deepEqual(
        audit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
        []
      );
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.boardpick'));
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'trigger');
      assert.equal(await page.evaluate(() => window.parentClosed), 0);
      await page.click('#trigger');
      await page.waitForSelector('.boardpick');
      await page.evaluate(() =>
        [...document.querySelectorAll('.boardpick button')]
          .find((b) => b.textContent.includes('Create board'))
          ?.click()
      );
      await page.waitForSelector('input[placeholder*="Fernwood"]');
      await page.keyboard.type('Kitchen');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.querySelector('.boardpick'));
      assert.deepEqual(await page.evaluate(() => window.creates), [
        {
          title: 'Kitchen',
          p: {
            id: 42,
            lid: 'source',
            vid: 'walnut',
            name: 'Chair',
            line: 'Walnut',
            price: 199,
            trade: 179,
            img: '/images/product-unavailable.svg',
            ar: 1,
          },
        },
      ]);
      await page.click('#trigger');
      await page.waitForSelector('.boardpick');
      await page.evaluate(() =>
        [...document.querySelectorAll('.boardpick .bp')]
          .find((b) => b.textContent.includes('Living room'))
          ?.click()
      );
      await page.waitForFunction(() => !document.querySelector('.boardpick'));
      assert.equal(await page.evaluate(() => window.saves[0].p.vid), 'walnut');
      await page.click('#trigger');
      await page.waitForSelector('.boardpick');
      await page.click('#after');
      await page.waitForFunction(() => !document.querySelector('.boardpick'));
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'after');
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `${directory}/${width}-${mode}.png` });
      results.push({ width, mode, bounds, axe: 0, errors: 0, passed: true });
      console.log(JSON.stringify({ width, mode, passed: true }));
      await page.close();
    }
  await writeFile(
    'artifacts/lighthouse/board-controls-browser.json',
    JSON.stringify(
      {
        scope:
          'Actual typed catalog and board components, trade styles and native Modal; synthetic read-only data and local callbacks; not production eligibility verification',
        results,
      },
      null,
      2
    ) + '\n'
  );
  console.log(results.length + ' board picker browser cases passed');
} finally {
  await browser.close();
}
