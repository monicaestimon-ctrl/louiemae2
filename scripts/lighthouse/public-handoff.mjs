/* global window, document, URL, Event, getComputedStyle */
import { build } from 'esbuild';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
const work = 'tmp/public-handoff-fixture';
await mkdir(work, { recursive: true });
await build({
  stdin: {
    contents: `export { INITIAL_SITE_CONTENT } from './constants';export { pageDocument } from './lib/serverPageDocument';export { collectionDocument } from './lib/serverCollectionDocument';export { journalDocument } from './lib/serverJournalDocument';export { withPublicInitialData } from './lib/serverPublicInitialData';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  outfile: work + '/documents.mjs',
});
const { INITIAL_SITE_CONTENT, pageDocument, journalDocument, collectionDocument, withPublicInitialData } = await import(
  '../../' + work + '/documents.mjs?at=' + Date.now()
);
const site = JSON.parse(JSON.stringify(INITIAL_SITE_CONTENT));
site.story.hero.title = 'Source story';
site.story.hero.subtitle = 'Our journey';
site.story.hero.image = '/fixture.svg';
site.home.shop = { ...site.home.shop, headerImage: '/fixture.svg' };
site.collections = ['furniture','decor','fashion','kids'].map(id => ({ id, title: 'Source '+id, subtitle: 'Verified collection navigation', heroImage: '/fixture.svg', subcategories: [{id:'chairs',title:'Chairs',image:'/fixture.svg'},{id:'tables',title:'Tables',image:'/fixture.svg'}] }));
const collectionPaths = site.collections.map(item => '/collection/'+item.id);
const post = {
  _id: 'story1',
  _creationTime: 1,
  title: 'Source article',
  excerpt: 'Verified initial public text',
  image: '/fixture.svg',
  category: 'Home',
  date: 'November 17, 2026',
  status: 'published',
  content: '',
};
const article = { ...post, contentHtml: '<p>Verified article body from the initial response.</p>' };
const stubs = {
  auth: `export const useAuthActions=()=>({signIn:async()=>{throw Error('No auth permitted')},signOut:async()=>{throw Error('No auth permitted')}});export const useAuthToken=()=>null;`,
  convex: `import {getFunctionName} from 'convex/server';import{useSyncExternalStore}from'react';const subscribe=fn=>{window.addEventListener('fixture-update',fn);return()=>window.removeEventListener('fixture-update',fn)};const version=()=>window.fixtureVersion||0;function result(ref,args){const name=getFunctionName(ref);if(window.fixtureOffline)return new Error('Synthetic offline');if(name==='catalog:kidsRootPreview'){window.fixtureKidsCalls=(window.fixtureKidsCalls||0)+1;return window.fixtureKidsReleased?{ready:!window.fixtureKidsDisabled,version:5,products:window.fixtureKidsDisabled||window.fixtureKidsEmpty?[]:Array.from({length:8},(_,i)=>({_id:'kid'+i,name:'Preview dress '+i,images:['/fixture.svg'],price:32,category:'Dresses',variantCount:1}))}:undefined;}if(name==='catalogReadiness:status'){window.fixtureReadinessCalls=(window.fixtureReadinessCalls||0)+1;return window.fixtureCatalogDisabled?{ready:false,version:1}:undefined;}if(name==='customPages:list')return[];if(name==='siteContent:get')return window.fixtureLive?window.fixtureSite:undefined;if(name==='blogPosts:publicSummaries')return window.fixtureLive?[]:undefined;if(name==='blogPosts:publicDetail')return window.fixtureLive?null:undefined;return undefined;}export function useQueries(queries){useSyncExternalStore(subscribe,version);return Object.fromEntries(Object.entries(queries).map(([key,q])=>[key,result(q.query,q.args)]))}export function useQuery(ref,args){useSyncExternalStore(subscribe,version);return args==='skip'?undefined:result(ref,args)}export const useConvexAuth=()=>({isLoading:false,isAuthenticated:false});export const useMutation=()=>async()=>{window.fixtureCommands=(window.fixtureCommands||0)+1;throw Error('No commands permitted')};export const useAction=useMutation;export const useConvex=()=>({query:async()=>{throw Error('No direct query')}});export const usePaginatedQuery=(ref,args)=>{if(args!=='skip')window.fixturePageCalls=(window.fixturePageCalls||0)+1;return{results:[],status:'Exhausted',loadMore(){}}};`,
};
const bundle = await build({
  stdin: {
    contents: `import React from'react';import{createRoot}from'react-dom/client';import App from'./App';createRoot(document.getElementById('root')).render(<App/>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  outdir: work,
  format: 'iife',
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env': '{}',
    'import.meta.url': '"http://fixture.invalid/module.js"',
  },
  plugins: [
    {
      name: 'read-only-fixtures',
      setup(b) {
        for (const [pattern, name] of [
          [/^convex\/react$/, 'convex'],
          [/^@convex-dev\/auth\/react$/, 'auth'],
        ])
          b.onResolve({ filter: pattern }, () => ({ path: name, namespace: 'fixture' }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (a) => ({
          contents: stubs[a.path],
          loader: 'js',
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});
const assets = await readdir('dist/assets');
const css = assets.find((file) => /^main-.*\.css$/.test(file));
assert.ok(css);
const built = await readFile('dist/index.html', 'utf8');
const styles =
  [...built.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((x) => x[1]).join('\n') +
  (await readFile('dist/assets/' + css, 'utf8')) +
  bundle.outputFiles
    .filter((f) => f.path.endsWith('.css'))
    .map((f) => f.text)
    .join('\n');
const js = bundle.outputFiles.find((f) => f.path.endsWith('.js')).text;
const template = `<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Public fixture</title><link rel="canonical" href="https://www.louiemae.com/"><meta name="description" content="Fixture"><style>${styles}</style></head><body><div id="skip-navigation"></div><!--product-document--><div id="root"></div><script>${js.replaceAll('</script', '<\\/script')}</script></body></html>`;
function html(path) {
  if(collectionPaths.includes(path)) {
    const config=site.collections.find(item=>path==='/collection/'+item.id);
    return withPublicInitialData(collectionDocument(template,{...config,categories:config.subcategories,rootCategories:config.subcategories,cards:[]}),path,{site,...(config.id==='kids'?{kids:{ready:true,version:5,products:Array.from({length:8},(_,i)=>({_id:'kid'+i,name:'Preview dress '+i,images:['/fixture.svg'],price:32,category:'Dresses',variantCount:1}))}}:{})});
  }
  if (path === '/blog')
    return withPublicInitialData(journalDocument(template, [post]), path, { posts: [post] });
  if (path === '/blog/story1')
    return withPublicInitialData(
      journalDocument(template, [], { ...post, content: article.contentHtml }),
      path,
      { article }
    );
  const id = path.slice(1);
  return withPublicInitialData(
    pageDocument(template, {
      id,
      title: id === 'story' ? 'Source story' : 'Louie Mae',
      heroTitle: 'Source story',
      heroSubtitle: 'Our journey',
      description: 'Public source',
      image: '/fixture.svg',
      sections: [],
      links: [],
    }),
    path,
    { site }
  );
}
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://fixture').pathname;
    if (['/shop', '/story', '/blog', '/blog/story1', ...collectionPaths].includes(path)) {
      res.setHeader('Content-Type', 'text/html');
      return res.end(html(path));
    }
    if (path.startsWith('/fonts/')) {
      res.setHeader('Content-Type', 'font/woff2');
      return res.end(await readFile('public' + path));
    }
    res.setHeader('Content-Type', 'image/svg+xml');
    res.end(
      '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#d9cab8"/></svg>'
    );
  } catch {
    res.writeHead(404).end();
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: 'chrome' }),
  headless: true,
});
const results = [];
try {
  for (const [width, height] of [
    [320, 900],
    [844, 390],
    [1440, 900],
  ])
    for (const path of ['/shop', '/story', '/blog', '/blog/story1', ...collectionPaths]) {
      const page = await browser.newPage();
      await page.setViewport({ width, height });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.evaluateOnNewDocument((site) => {
        window.fixtureSite = site;
        window.fixtureVersion = 0;
      }, site);
      await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
      const selector =
        path.startsWith('/collection/') ? `main[data-lm-collection-ready="${path.slice(12)}"]` : path === '/shop' || path === '/story'
          ? `main[data-public-page="${path.slice(1)}"]`
          : `main[data-lm-journal-ready="${path === '/blog' ? 'index' : 'story1'}"]`;
      if (path === '/collection/kids') {
        await page.waitForFunction(() => window.fixtureKidsCalls > 0);
        await page.waitForSelector(selector, {visible:true});
        assert.equal(await page.$('#lm-collection-document'), null);
        assert.equal(await page.$$eval('main h3', nodes => nodes.filter(n => n.textContent.startsWith('Preview dress')).length), 8);
        assert.equal(await page.evaluate(() => Boolean(window.fixtureKidsReleased)), false);
        assert.equal(await page.evaluate(() => window.fixtureReadinessCalls || 0), 0);
        assert.equal(await page.evaluate(() => window.fixturePageCalls || 0), 0);
        await page.evaluate(() => { window.fixtureKidsReleased = true; window.fixtureVersion++; window.dispatchEvent(new Event('fixture-update')); });
      }
      await page.waitForSelector(selector, { visible: true, timeout: 8000 });
      assert.equal(await page.evaluate(() => Boolean(window.fixtureLive)), false);
      assert.equal(await page.$('#lm-page-document,#lm-journal-document,#lm-collection-document'), null);
      if (path === '/blog/story1') {
        // Text over an arbitrary photograph cannot rely on automated contrast detection.
        assert.equal(await page.$eval('header', el => getComputedStyle(el).backgroundColor), 'rgb(249, 247, 242)');
        await page.evaluate(() => window.scrollTo(0, 250));
        await page.waitForFunction(() => document.querySelector('header')?.classList.contains('py-3'));
        assert.equal(await page.$eval('header', el => getComputedStyle(el).backgroundColor), 'rgb(249, 247, 242)');
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      await page.addScriptTag({ content: axe.source });
      assert.deepEqual(await page.evaluate(async () => (await window.axe.run()).violations), []);
      if (path === '/collection/kids') {
        assert.equal(await page.$$eval('main h3', nodes => nodes.filter(n => n.textContent.startsWith('Preview dress')).length), 8);
        const headingGap = await page.evaluate(() => {
          const shop = [...document.querySelectorAll('main button')].find(node => node.textContent.startsWith('Shop all '));
          const heading = [...document.querySelectorAll('main h2')].find(node => node.textContent === 'New Arrivals');
          return heading && shop ? heading.getBoundingClientRect().top - shop.getBoundingClientRect().bottom : null;
        });
        assert.ok(headingGap !== null && headingGap >= 16, 'Kids navigation must not overlap the arrivals heading');
        await page.evaluate(() => { window.fixtureKidsEmpty = true; window.fixtureVersion++; window.dispatchEvent(new Event('fixture-update')); });
        await page.waitForFunction(() => [...document.querySelectorAll('main h3')].filter(n => n.textContent.startsWith('Preview dress')).length === 0);
        assert.notEqual(await page.$(selector), null);
        await page.evaluate(() => { window.fixtureKidsEmpty = false; window.fixtureVersion++; window.dispatchEvent(new Event('fixture-update')); });
        await page.waitForFunction(() => [...document.querySelectorAll('main h3')].filter(n => n.textContent.startsWith('Preview dress')).length === 8);
        await page.evaluate(() => { window.fixtureKidsDisabled = true; window.fixtureVersion++; window.dispatchEvent(new Event('fixture-update')); });
        await page.waitForFunction(() => document.querySelector('main')?.textContent.includes('Products are temporarily unavailable'));
        assert.equal(await page.$(selector), null);
        assert.equal(await page.$$eval('main h3', nodes => nodes.filter(n => n.textContent.startsWith('Preview dress')).length), 0);
        await page.evaluate(() => { window.fixtureKidsDisabled = false; window.fixtureVersion++; window.dispatchEvent(new Event('fixture-update')); });
        await page.waitForSelector(selector, { visible: true });
      }
      if(collectionPaths.includes(path)) {
        assert.equal(await page.evaluate(()=>window.fixtureReadinessCalls||0),0);
        await page.evaluate(path=>{window.location.hash='#collection/'+path.slice(12)+'?cat=All&view=products'},path);
        await page.waitForFunction(()=>!document.querySelector('[data-lm-collection-ready]'));
        await page.evaluate(()=>{window.fixtureCatalogDisabled=true;window.fixtureVersion++;window.dispatchEvent(new Event('fixture-update'))});
        await page.waitForFunction(()=>document.querySelector('main')?.textContent.includes('Products are temporarily unavailable'));
        await page.evaluate(path=>{window.location.hash='#collection/'+path.slice(12)},path);
        await page.waitForSelector(selector,{visible:true});
      }
      await page.evaluate(() => {
        window.fixtureLive = true;
        window.fixtureSite.story.hero.title = 'Updated story';
        window.fixtureVersion++;
        window.dispatchEvent(new Event('fixture-update'));
      });
      if (path === '/story')
        await page.waitForFunction(() =>
          document.querySelector('main h1')?.textContent.includes('Updated story')
        );
      if (path === '/blog')
        await page.waitForFunction(() =>
          document.querySelector('main')?.textContent.includes('New stories are coming soon')
        );
      if (path === '/blog/story1')
        await page.waitForFunction(() =>
          document.querySelector('main')?.textContent.includes('Post not found')
        );
      await page.evaluate(() => {
        window.fixtureOffline = true;
        window.fixtureVersion++;
        window.dispatchEvent(new Event('fixture-update'));
      });
      await page.waitForFunction(() =>
        document.querySelector('main')?.textContent.toLowerCase().includes('unavailable')
      );
      assert.equal(await page.evaluate(() => window.fixtureCommands || 0), 0);
      assert.deepEqual(errors, []);
      results.push({
        path,
        width,
        height,
        initialBeforeLive: true,
        liveWithdrawalOrUpdate: true,
        outageVisible: true,
        axeViolations: 0,
        commands: 0,
      });
      await page.close();
    }
  // With initial site content already live, isolate the Kids first-connection
  // timeout. The verified display must expire rather than remain indefinitely.
  {
    const page = await browser.newPage(); await page.setViewport({width:320,height:900});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.evaluateOnNewDocument(site=>{
      window.fixtureSite=site;window.fixtureLive=true;window.fixtureVersion=0;
      window.localStorage.setItem('lm_newsletter_dismissed','true');
    },site);
    await page.goto(origin+'/collection/kids',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('main[data-lm-collection-ready="kids"]',{visible:true});
    assert.equal(await page.evaluate(()=>Boolean(window.fixtureKidsReleased)),false);
    await page.waitForFunction(()=>document.querySelector('main')?.textContent.includes('Products are temporarily unavailable'),{timeout:13000});
    assert.equal(await page.$('main[data-lm-collection-ready="kids"]'),null);
    assert.equal(await page.$$eval('main h3',nodes=>nodes.filter(n=>n.textContent.startsWith('Preview dress')).length),0);
    await page.evaluate(()=>{window.fixtureKidsReleased=true;window.fixtureVersion++;window.dispatchEvent(new Event('fixture-update'));});
    await page.waitForSelector('main[data-lm-collection-ready="kids"]',{visible:true});
    assert.equal(await page.$$eval('main h3',nodes=>nodes.filter(n=>n.textContent.startsWith('Preview dress')).length),8);
    assert.equal(await page.evaluate(()=>window.fixtureCommands||0),0);assert.deepEqual(errors,[]);
    results.push({path:'/collection/kids',width:320,initialTimeout:true,liveRecovery:true,commands:0,errors});
    await page.close();
  }

  await mkdir('artifacts/lighthouse', { recursive: true });
  await writeFile(
    'artifacts/lighthouse/public-handoff-browser.json',
    JSON.stringify(
      {
        scope:
          'Actual App/server documents with synthetic read-only data transport; no production commands',
        results,
      },
      null,
      2
    )
  );
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
