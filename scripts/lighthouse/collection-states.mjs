/* global window,document,innerWidth,URLSearchParams,location,Event,requestAnimationFrame,getComputedStyle */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
const mocks = {
  '/BlogContext': `export const useSite=()=>({isLoading:false,siteContentStatus:'ready',siteContent:{collections:[{id:'furniture',title:'Furniture',subtitle:'Considered pieces',heroImage:'',subcategories:[{id:'seating',title:'Seating',isMainCategory:true},{id:'sofas',title:'Sofas',parentCategory:'Seating',image:''},{id:'chairs',title:'Chairs',parentCategory:'Seating',image:''}]}]}});`,
  '/useRecoverableQuery': `export const useRecoverableQuery=()=>({status:'ready',data:{ready:true}});`,
  '/useKidsRootPreview': `export const useKidsRootPreview=()=>({products:[],loading:false,unavailable:false});`,
  '/NewsletterContext': `export const useNewsletter=()=>({addSubscriberWithTags:()=>{throw Error('Subscription prohibited in this fixture')}});`,
  '/LazyProductPreview': `export const LazyProductPreview=()=>null;`,
  '/useStoreCatalog': `export function useStoreCatalog(config,category,ready,sort){window.lastSort=sort;const s=window.catalogFixture;const rows=s.mode==='populated'||s.mode==='partial-error'?[{id:'sofa',name:'Fixture sofa',images:[],price:1000,category:'Sofas',variantCount:2,isNew:true,inStock:false}]:[];return{products:ready?rows:[],loading:s.mode==='loading',unavailable:s.mode==='failed',complete:s.mode==='empty'||s.mode==='populated',canLoadMore:s.mode==='incomplete',loadingMore:false,additionalLoadingFailed:s.mode==='partial-error',loadMore:()=>{window.catalogFixture={mode:'populated'};window.dispatchEvent(new Event('fixture'));}}}export const useStoreCategoryOptions=()=>({categories:['All','Sofas','Chairs'],canLoadMore:false,loading:false});`,
};
const bundle = await build({
  stdin: {
    contents: `import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{StorePage}from'./components/StorePage';window.catalogFixture={mode:'populated'};function App(){const[,render]=useState(0);useEffect(()=>{const next=()=>render(n=>n+1);window.addEventListener('fixture',next);window.addEventListener('hashchange',next);return()=>{window.removeEventListener('fixture',next);window.removeEventListener('hashchange',next)}},[]);const q=new URLSearchParams(location.hash.split('?')[1]);return <StorePage key={location.hash} collection="furniture" initialCategory={q.get('cat')||'Seating'} forceProductView={q.get('view')==='products'}/>};createRoot(document.getElementById('root')).render(<App/>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  plugins: [
    {
      name: 'local-catalog-only',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => {
          const key = Object.keys(mocks).find((key) => args.path.endsWith(key));
          return key ? { path: key, namespace: 'fixture' } : undefined;
        });
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents: mocks[args.path],
          loader: 'tsx',
        }));
      },
    },
  ],
});
const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
const css = await readFile('dist/' + manifest['index.html'].css[0], 'utf8');
await mkdir('artifacts/lighthouse', { recursive: true });
const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: 'chrome' }),
  headless: true,
});
const results = [];
try {
  for (const width of [320, 844, 1440]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setRequestInterception(true);
    const fixtureOrigin = 'https://collection-fixture.invalid';
    page.on('request', async (request) => {
      try {
        const url = new URL(request.url());
        if (request.method() !== 'GET' || url.origin !== fixtureOrigin)
          return await request.abort();
        if (url.pathname === '/')
          return await request.respond({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><html lang="en"><head><title>Local collection interaction fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>',
          });
        const root = path.resolve('public'),
          file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
        if (!file.startsWith(root + path.sep)) return await request.abort();
        const body = await readFile(file);
        await request.respond({
          status: 200,
          contentType: file.endsWith('.woff2')
            ? 'font/woff2'
            : file.endsWith('.svg')
              ? 'image/svg+xml'
              : file.endsWith('.webp')
                ? 'image/webp'
                : 'application/octet-stream',
          body,
        });
      } catch {
        if (!request.isInterceptResolutionHandled()) await request.respond({ status: 404 });
      }
    });
    await page.goto(fixtureOrigin + '/');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForSelector('h3 button');
    await page.focus('h3 button');
    await page.keyboard.press('Enter');
    await page.waitForSelector('select[aria-label="Sort products"]');
    assert.equal(
      await page.evaluate(() => new URLSearchParams(location.hash.split('?')[1]).get('cat')),
      'Sofas'
    );
    assert.equal(await page.$eval('button[aria-pressed=true]', (e) => e.textContent), 'Sofas');
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('aria-pressed')),
      'true',
      'Category activation restores focus after route remount'
    );
    await page.select('select', 'price-desc');
    assert.equal(await page.evaluate(() => window.lastSort), 'price-desc');
    await page.focus('select[aria-label="Sort products"]');
    assert.equal(
      await page.$eval('select', (element) => {
        const style = window.getComputedStyle(element);
        return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
      }),
      true,
      'Sort retains a visible keyboard focus outline'
    );
    for (const mode of ['incomplete', 'populated', 'partial-error', 'empty', 'failed']) {
      await page.evaluate((mode) => {
        window.catalogFixture = { mode };
        window.dispatchEvent(new Event('fixture'));
      }, mode);
      await page.waitForFunction(
        (mode) =>
          mode === 'incomplete'
            ? document.body.innerText.includes('No matching products in the loaded page')
            : mode === 'populated'
              ? document.body.innerText.includes('All matching products shown')
              : mode === 'partial-error'
                ? document.body.innerText.includes('More products could not be loaded')
                : mode === 'empty'
                  ? Boolean(document.querySelector('form[aria-label="Early access to Sofas"]'))
                  : document.body.innerText.includes('Products are temporarily unavailable'),
        {},
        mode
      );
      if (mode === 'populated' || mode === 'partial-error') {
        await page.waitForSelector('button[aria-label="Quick View Fixture sofa"]', {
          visible: true,
        });
      }
      await page.waitForFunction(() => !document.querySelector('.lm-reveal.translate-y-16'));
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getTiming().iterations !== Infinity)
            .map((a) => a.finished.catch(() => {}))
        );
      });
      await page.evaluate(() => document.fonts.ready);
      const loadedFonts = await page.evaluate(() =>
        [...document.fonts].filter((font) => font.status === 'loaded').map((font) => font.family)
      );
      assert.ok(
        loadedFonts.some((family) => family.includes('Cormorant')),
        'Render the actual collection heading font'
      );
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(async () =>
        (await window.axe.run()).violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
        }))
      );
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (mode === 'empty' && width === 320) {
        await page.focus('select[aria-label="Sort products"]');
        for (const selector of ['form input[type="email"]', 'form button[type="submit"]']) {
          let reached = false;
          for (let step = 0; step < 20; step++) {
            await page.keyboard.press('Tab');
            reached = await page.evaluate(
              (selector) => document.activeElement?.matches(selector),
              selector
            );
            if (reached) break;
          }
          assert.ok(reached, `Keyboard reaches ${selector}`);
          const focus = await page.evaluate(() => {
            const element = document.activeElement;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            const spread = Math.max(
              0,
              parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset)
            );
            const bounds = {
              left: rect.left - spread,
              right: rect.right + spread,
              top: rect.top - spread,
              bottom: rect.bottom + spread,
            };
            const clipped = [];
            for (let parent = element.parentElement; parent; parent = parent.parentElement) {
              const css = getComputedStyle(parent),
                box = parent.getBoundingClientRect();
              if (
                /(hidden|clip|auto|scroll)/.test(css.overflowX) &&
                (bounds.left < box.left || bounds.right > box.right)
              )
                clipped.push(parent.tagName);
              if (
                /(hidden|clip|auto|scroll)/.test(css.overflowY) &&
                (bounds.top < box.top || bounds.bottom > box.bottom)
              )
                clipped.push(parent.tagName);
            }
            return {
              visible: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2,
              clipped,
            };
          });
          assert.ok(focus.visible, `${selector} has a visible focus outline`);
          assert.deepEqual(focus.clipped, [], `${selector} outline is not clipped`);
        }
      }
      await page.screenshot({
        path: `artifacts/lighthouse/collection-coverage-${mode}-${width}.png`,
      });
      results.push({
        width,
        mode,
        loadedFonts,
        violations,
        overflow,
        overflowElements: overflow
          ? await page.evaluate(() =>
              [...document.querySelectorAll('main *')]
                .filter((e) => e.getBoundingClientRect().right > innerWidth)
                .map((e) => ({
                  tag: e.tagName,
                  classes: e.className,
                  right: e.getBoundingClientRect().right,
                }))
                .slice(0, 8)
            )
          : [],
        errors: [...errors],
      });
      if (mode === 'incomplete') {
        await page.evaluate(() =>
          [...document.querySelectorAll('button')]
            .find((b) => b.textContent === 'Load more products')
            .focus()
        );
        await page.keyboard.press('Enter');
        await page.waitForFunction(() =>
          document.body.innerText.includes('All matching products shown')
        );
        await page.waitForSelector('button[aria-label="Quick View Fixture sofa"]', {
          visible: true,
        });
      }
    }
    await page.close();
  }
  console.log(JSON.stringify(results));
  assert.equal(results.length, 15);
  assert.ok(results.every((r) => !r.violations.length && !r.overflow && !r.errors.length));
} finally {
  try {
    await writeFile(
      'artifacts/lighthouse/collection-states-browser.json',
      JSON.stringify(
        {
          scope: 'Isolated actual StorePage with local catalog; not production coverage',
          expectedCases: 15,
          passed:
            results.length === 15 &&
            results.every((r) => !r.violations.length && !r.overflow && !r.errors.length),
          results,
        },
        null,
        2
      )
    );
  } finally {
    await browser.close();
  }
}
