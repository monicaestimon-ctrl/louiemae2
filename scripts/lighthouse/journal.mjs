/* global window, document, location, innerWidth, URL, Event, getComputedStyle */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile, readdir, writeFile } from 'node:fs/promises';
const css = (await readdir('dist/assets')).find((file) => /^main-.*\.css$/.test(file));
assert.ok(css, 'Build before the journal fixture.');
const post = {
  _id: 'journal-fixture',
  id: 'journal-fixture',
  title: 'A thoughtful home',
  excerpt: 'A public journal story.',
  category: 'Home',
  date: 'November 17, 2026',
  image: '',
  status: 'published',
  content:
    '<h2>Make room for everyday life</h2><p>A readable story with <strong>meaningful details</strong> and a <a href="/shop">shop link</a>.</p><script>window.fixtureAttack=true</script><img src="javascript:bad" onerror="window.fixtureAttack=true">',
};
const sanitizer = await build({
  entryPoints: ['lib/journalContent.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { journalHtml } = await import(
  'data:text/javascript;base64,' + Buffer.from(sanitizer.outputFiles[0].text).toString('base64')
);
const publicDetail = { ...post, contentHtml: journalHtml(post.content) };
delete publicDetail.content;
const stubs = {
  site: `export const useSite=()=>({posts:[${JSON.stringify(post)}],editorialStatus:'ready'});`,
  newsletter: `export const useNewsletter=()=>({addSubscriber:async()=>{window.fixtureCommands++;throw Error('No commands permitted')}});`,
  convex: `import{useEffect,useState}from'react';const post=${JSON.stringify(publicDetail)};export function useQueries(queries){const[,change]=useState(0);useEffect(()=>{const update=()=>change(x=>x+1);window.addEventListener('fixturechange',update);return()=>window.removeEventListener('fixturechange',update)},[]);return Object.fromEntries(Object.keys(queries).map(key=>[key,window.fixtureState==='missing'?null:window.fixtureState==='failed'?new Error('Fixture unavailable'):window.fixtureState==='pending'?undefined:post]));}`,
};
const bundle = await build({
  stdin: {
    contents: `import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';import{BlogPage}from'./components/BlogPage';import{BlogPostView}from'./components/BlogPostView';import{storefrontRoute}from'./lib/storefrontNavigation';function Root(){const[route,setRoute]=useState(()=>storefrontRoute(location));useEffect(()=>{const update=()=>setRoute(storefrontRoute(location));window.addEventListener('popstate',update);window.addEventListener('hashchange',update);return()=>{window.removeEventListener('popstate',update);window.removeEventListener('hashchange',update)}},[]);return route.startsWith('#blog/')?<BlogPostView postId={route.slice(6)}/>:<BlogPage/>}window.fixtureCommands=0;createRoot(document.getElementById('root')).render(<Root/>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'journal-boundaries',
      setup(b) {
        b.onResolve({ filter: /contexts\/BlogContext$/ }, () => ({
          path: 'site',
          namespace: 'fixture',
        }));
        b.onResolve({ filter: /contexts\/NewsletterContext$/ }, () => ({
          path: 'newsletter',
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
const html = `<!doctype html><html lang="en"><head><title>Journal fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="canonical" href="https://www.louiemae.com/blog"><meta name="description" content="Journal fixture"><style>${await readFile('dist/assets/' + css, 'utf8')}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
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
  ]) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewport({ width, height });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (
        request.isNavigationRequest() &&
        new URL(request.url()).origin === 'http://fixture.invalid'
      )
        void request.respond({ status: 200, contentType: 'text/html', body: html });
      else void request.abort();
    });
    await page.goto('http://fixture.invalid/blog');
    await page.waitForSelector('[data-lm-journal-ready="index"]');
    await page.addScriptTag({ content: axe.source });
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.lm-reveal')].every(
        (node) => getComputedStyle(node).opacity === '1'
      )
    );
    const indexViolations = await page.evaluate(async () =>
      (await axe.run(document.querySelector('main'))).violations.map((value) => ({
        id: value.id,
        nodes: value.nodes.map((node) => node.target),
      }))
    );
    await page.focus('a[href="/blog/journal-fixture"]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-lm-journal-ready="journal-fixture"]');
    assert.equal(await page.evaluate(() => location.pathname), '/blog/journal-fixture');
    assert.equal(
      await page.$eval('link[rel="canonical"]', (element) => element.href),
      'https://www.louiemae.com/blog/journal-fixture'
    );
    assert.equal(await page.evaluate(() => Boolean(window.fixtureAttack)), false);
    assert.equal(
      await page.$eval('main h1', (element) => element === document.activeElement),
      true
    );
    await page.addScriptTag({ content: axe.source });
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.lm-reveal')].every(
        (node) => getComputedStyle(node).opacity === '1'
      )
    );
    const violations = await page.evaluate(async () =>
      (await axe.run(document.querySelector('main'))).violations.map((value) => ({
        id: value.id,
        impact: value.impact,
        nodes: value.nodes.map((node) => node.target),
      }))
    );
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    await page.screenshot({ path: `artifacts/lighthouse/journal-${width}.png` });
    await page.evaluate(() => {
      window.fixtureState = 'missing';
      window.dispatchEvent(new Event('fixturechange'));
    });
    await page.waitForFunction(
      () => document.querySelector('h1')?.textContent === 'Post not found'
    );
    assert.equal(await page.$('[data-lm-journal-ready]'), null);
    assert.equal(await page.$('#lm-journal-structured-data'), null);
    assert.equal(await page.$eval('meta[name="robots"]', (node) => node.content), 'noindex');
    await page.evaluate(() => {
      window.fixtureState = 'failed';
      window.dispatchEvent(new Event('fixturechange'));
    });
    await page.waitForFunction(() =>
      [...document.querySelectorAll('button')].some((node) => node.textContent === 'Retry story')
    );
    await page.evaluate(() => {
      window.fixtureState = 'ready';
      window.dispatchEvent(new Event('fixturechange'));
    });
    await page.waitForSelector('[data-lm-journal-ready="journal-fixture"]');
    assert.equal(await page.$('meta[name="robots"]'), null);
    await page.goBack();
    await page.waitForSelector('[data-lm-journal-ready="index"]');
    assert.equal(await page.evaluate(() => window.fixtureCommands), 0);
    results.push({
      width,
      height,
      violations: [...indexViolations, ...violations],
      overflow,
      errors,
      keyboardNavigation: true,
      withdrawal: true,
      recovery: true,
      history: true,
      commands: 0,
    });
    await page.close();
  }
  await writeFile(
    'artifacts/lighthouse/journal-browser.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        scope: 'Local synthetic fixture; no production mutations, sign-in or financial testing',
        results,
      },
      null,
      2
    )
  );
  console.log(JSON.stringify(results));
  assert.ok(
    results.every((row) => !row.violations.length && !row.overflow && !row.errors.length),
    'Journal browser checks failed'
  );
} finally {
  await browser.close();
}
