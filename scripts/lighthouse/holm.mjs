/* global document, window, location */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
const stubs = {
  auth: `export const useAuthActions=()=>({signIn:async()=>{throw Error('No auth permitted')},signOut:async()=>{throw Error('No auth permitted')}});export const useAuthToken=()=>null;`,
  convex: `import{getFunctionName}from'convex/server';export const useQuery=(ref)=>getFunctionName(ref)==='holm:me'?{signedIn:false,verified:false,admin:false,tradeStatus:'none'}:undefined;export const useQueries=q=>Object.fromEntries(Object.keys(q).map(k=>[k,undefined]));export const useMutation=()=>async()=>{window.fixtureCommands=(window.fixtureCommands||0)+1;throw Error('No mutation permitted')};export const usePaginatedQuery=()=>({results:[],status:'Exhausted',loadMore(){}});export const useAction=useMutation;export const useConvexAuth=()=>({isLoading:false,isAuthenticated:false});`,
};
const entry = `import React from'react';import{createRoot}from'react-dom/client';import{App,setProducts}from'./trade/app';const image='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';const products=Array.from({length:24},(_,i)=>({id:i+1,lid:'fixture'+i,vid:'fixture'+i,variants:[],name:'Fixture '+(i+1),full:'Fixture '+(i+1),line:'Chair',type:'sofa',mat:'leather',tone:'#6B4A33',price:100,trade:null,seats:1,oos:false,note:'Fixture only',facts:'',img:image,imgs:[image],ar:1,sku:'FIXTURE',likes:0,widthCm:50,dimsCm:{w:50,d:50,h:50},dimsSource:'fixture',cutout:null,cutAR:null,model:null,modelLow:null,hangs:false,mountCm:null,minimum:1,increment:1,checkoutMode:'quote'}));setProducts(products);createRoot(document.getElementById('root')).render(<App/>);`;
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
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('Fixture error:', e.message));
  await page.setViewport({ width: 390, height: 844 });
  await page.setContent(
    '<!doctype html><html lang="en"><head><title>HOLM integration fixture</title><meta http-equiv="Content-Security-Policy" content="connect-src \'none\';img-src data:"></head><body><div id="root"></div></body></html>'
  );
  await page.evaluate(() => {
    location.hash = 'discover';
  });
  const css = (await readdir('dist/assets')).find((f) => /^trade-.*\.css$/.test(f));
  await page.addStyleTag({ content: await readFile('dist/assets/' + css, 'utf8') });
  for (const f of bundle.outputFiles.filter((f) => f.path.endsWith('.css')))
    await page.addStyleTag({ content: f.text });
  await page.addStyleTag({ content: await readFile('trade/style.css', 'utf8') });
  await page.addScriptTag({ content: bundle.outputFiles.find((f) => f.path.endsWith('.js')).text });
  await page.waitForSelector('.pin-open');
  await page.focus('.pin-open');
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog');
  assert.equal(
    await page.evaluate(() => document.activeElement.closest('dialog')?.getAttribute('aria-label')),
    'Fixture 1 Chair'
  );
  for (let i = 0; i < 45; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog')), true);
  }
  await page.click('.pp-add');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog'));
  assert.equal(await page.evaluate(() => document.activeElement.className), 'pin-open');
  await page.click('[aria-label="Open project tray"]');
  await page.waitForSelector('dialog[aria-label="Project tray"]');
  await page.click('.tv-quote');
  await page.waitForSelector('dialog[aria-label="Client quotes"]');
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    assert.equal(
      await page.evaluate(() =>
        document.activeElement.closest('dialog')?.getAttribute('aria-label')
      ),
      'Client quotes'
    );
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelectorAll('dialog').length === 1);
  assert.equal(await page.evaluate(() => document.activeElement.className), 'tv-quote');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog'));
  assert.equal(
    await page.evaluate(() => document.activeElement.getAttribute('aria-label')),
    'Open project tray'
  );
  await page.click('[aria-label="Open menu"]');
  await page.waitForSelector('dialog[aria-label="Menu"]');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('href')), '#discover');
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    assert.equal(
      await page.evaluate(() =>
        document.activeElement.closest('dialog')?.getAttribute('aria-label')
      ),
      'Menu'
    );
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog'));
  assert.equal(
    await page.evaluate(() => document.activeElement.getAttribute('aria-label')),
    'Open menu'
  );
  assert.equal(await page.evaluate(() => document.body.style.overflow), '');
  assert.equal(await page.evaluate(() => window.fixtureCommands || 0), 0);
  const result = {
    scope:
      'Actual HOLM App with 24 explicit fixture products; queries mocked, commands prohibited, network blocked',
    keyboardOpensProduct: true,
    focusContained: true,
    escapeRestoresCard: true,
    nestedTrayQuote: true,
    menuContainment: true,
    scrollRestored: true,
    commands: 0,
  };
  await writeFile(
    'artifacts/lighthouse/holm-modal-integration.json',
    JSON.stringify(result, null, 2)
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
