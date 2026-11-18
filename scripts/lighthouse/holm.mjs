/* global document, window, location, Event */
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
  convex: `import{getFunctionName}from'convex/server';import{useSyncExternalStore}from'react';const subscribe=fn=>{window.addEventListener('fixture-auth',fn);return()=>window.removeEventListener('fixture-auth',fn)};export const useQuery=(ref)=>{const signedIn=useSyncExternalStore(subscribe,()=>!!window.fixtureSignedIn);return getFunctionName(ref)==='holm:me'?{signedIn,verified:false,admin:false,tradeStatus:'none'}:undefined;};export const useQueries=q=>Object.fromEntries(Object.entries(q).map(([k,v])=>[k,v.args.productIds?v.args.productIds.map(productId=>({productId,item:null})):{ready:true,items:v.args.legacyIds.map(legacyId=>({legacyId,status:'unavailable',item:null}))}]));export const useMutation=ref=>async()=>{if(getFunctionName(ref)==='holm:ensureProfile')return;window.fixtureCommands=(window.fixtureCommands||0)+1;throw Error('No mutation permitted')};export const usePaginatedQuery=()=>({results:[],status:'Exhausted',loadMore(){}});export const useAction=useMutation;export const useConvexAuth=()=>({isLoading:false,isAuthenticated:false});`,
};
const entry = `import React from'react';import{createRoot}from'react-dom/client';import{App,setProducts}from'./trade/app';const image='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';const products=Array.from({length:24},(_,i)=>({id:i+1,lid:'fixture'+i,vid:'fixture'+i,variants:[],name:'Fixture '+(i+1),full:'Fixture '+(i+1),line:'Chair',type:'sofa',mat:'leather',tone:'#6B4A33',price:100,trade:null,seats:1,oos:false,note:'Fixture only',facts:'',img:image,imgs:[image],ar:1,sku:'FIXTURE',likes:0,widthCm:50,dimsCm:{w:50,d:50,h:50},dimsSource:'fixture',cutout:null,cutAR:null,model:null,modelLow:null,hangs:false,mountCm:null,minimum:1,increment:1,checkoutMode:'quote'}));setProducts(products);const root=createRoot(document.getElementById('root'));root.render(<App/>);window.fixtureRemoveProduct=id=>{setProducts(products.filter(p=>p.id!==id))};window.fixtureSingleProduct=()=>setProducts(products.slice(0,1));`;
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
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
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
  await page.waitForSelector('.pin-open');
  await page.addScriptTag({ content: axe.source });
  const discoveryViolations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.target) })));
  await writeFile('artifacts/lighthouse/holm-discovery-accessibility.json', JSON.stringify(discoveryViolations, null, 2));
  assert.deepEqual(discoveryViolations, []);
  await page.click('main.wrap .filters button[aria-expanded]');
  await page.setViewport({ width: 320, height: 900 });
  const expandedViolations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.target) })));
  assert.deepEqual(expandedViolations, []);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: 'artifacts/lighthouse/holm-discovery-filters-320.png' });
  await page.click('main.wrap .filters button[aria-expanded]');
  await page.setViewport({ width: 390, height: 844 });
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
  assert.match(await page.$eval('meta[name=robots]', n => n.content), /noindex/);
  await page.$eval('.tv-quote', button => button.scrollIntoView({ block: 'center' }));
  await page.waitForFunction(() => {
    const button = document.querySelector('.tv-quote');
    if (!button) return false;
    const rect = button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  });
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
  await page.focus('[aria-label="View Fixture 1 Chair"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog');
  await page.evaluate(() => window.fixtureRemoveProduct(1));
  await page.waitForSelector('dialog[aria-label="Product unavailable"]');
  assert.equal(await page.$eval('dialog', node => [...node.querySelectorAll('button')].some(b => /Add.*project|Add.*tray/i.test(b.textContent))), false);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog'));
  assert.equal(await page.evaluate(() => document.body.style.overflow), '');
  await page.evaluate(() => { window.fixtureSingleProduct(); location.hash = 'home'; });
  await page.waitForSelector('main.home');
  await page.waitForSelector('.qs-lines .qs-line');
  assert.equal(await page.$('meta[name=robots]'), null);
  await page.evaluate(() => { window.fixtureSignedIn = true; window.dispatchEvent(new Event('fixture-auth')); });
  await page.waitForFunction(() => document.querySelector('meta[name=robots]')?.content.includes('noindex'));
  await page.evaluate(() => { window.fixtureSignedIn = false; window.dispatchEvent(new Event('fixture-auth')); });
  await page.waitForFunction(() => !document.querySelector('meta[name=robots]'));
  assert.equal(await page.evaluate(() => window.fixtureCommands || 0), 0);
  assert.deepEqual(pageErrors, []);
  const result = {
    scope:
      'Actual HOLM App with 24 explicit fixture products; queries mocked, commands prohibited, network blocked',
    privateTrayAndSyntheticAccountIndexing: true,
    singleProductHome: true,
    keyboardOpensProduct: true,
    removedOpenProductBlocked: true,
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
