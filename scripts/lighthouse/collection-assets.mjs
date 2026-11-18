/* global document, window */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import { URL, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import axe from 'axe-core';
const data = {
  id: 'kids',
  title: 'Louie Kids & Co.',
  subtitle: 'Small wonders',
  primaryCategoryImage: '/images/brand/girls-dress.png',
  categories: [],
  cards: [],
  rootCategories: [
    'girls-dress',
    'boys-category',
    'toys-category',
    'nursery-category',
    'playroom-scene-v2',
  ].map((name, i) => ({
    id: 'category-' + i,
    title: ['Girls', 'Boys', 'Toys', 'Nursery', 'Playroom'][i],
    image: '/images/brand/' + name + '.png',
    isMainCategory: true,
  })),
};
const directory = 'artifacts/lighthouse/collection-assets';
await rm('artifacts/lighthouse/collection-assets-browser.json', { force: true });
await mkdir(directory, { recursive: true });
const serverBundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: "export{collectionDocument}from'./lib/serverCollectionDocument';",
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  external: ['react', 'react-dom/server'],
  plugins: [],
});
await writeFile(directory + '/render.mjs', serverBundle.outputFiles[0].text);
const { collectionDocument } = await import(pathToFileURL(path.resolve(directory + '/render.mjs')));
const client = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `import React,{useLayoutEffect}from'react';import{createRoot}from'react-dom/client';import{CollectionRootHero}from'./components/CollectionRootHero';const data=${JSON.stringify(data)};function App(){useLayoutEffect(()=>{document.getElementById('lm-collection-document').remove();},[]);return <main data-client className='bg-cream min-h-screen pt-20'><section className='relative w-full min-h-screen flex flex-col'><div className='absolute inset-0 bg-cream z-0'/><CollectionRootHero collection='kids' title={data.title} subtitle={data.subtitle} categories={data.rootCategories}/></section></main>}createRoot(document.getElementById('root')).render(<App/>);`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  plugins: [],
  define: { 'process.env.NODE_ENV': '"production"' },
});
const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8')),
  css = await readFile('dist/' + manifest['index.html'].css[0], 'utf8');
const html = collectionDocument(
  `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kids image fixture</title><link rel="preload" as="font" href="/fonts/cormorant-garamond-latin-400-normal.woff2" crossorigin><link rel="preload" as="font" href="/fonts/cormorant-garamond-latin-400-italic.woff2" crossorigin><style>${css}</style></head><body><!--product-document--><div id="root"></div></body></html>`,
  data
);
let requests = [];
const root = path.resolve('public');
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(html);
    }
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep)) throw Error('Unknown source');
    const bytes = await readFile(file);
    if (url.pathname.includes('/girls-dress-')) requests.push(url.pathname);
    res.writeHead(200, {
      'Content-Type': url.pathname.endsWith('.woff2')
        ? 'font/woff2'
        : url.pathname.endsWith('.webp')
          ? 'image/webp'
          : 'application/octet-stream',
      'Cache-Control': 'public,max-age=86400',
    });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
let browser;
const results = [];
const geometry = () => {
  const image = Array.from(document.querySelectorAll('main img')).find(
    (e) => e.getClientRects().length
  );
  const r = image.getBoundingClientRect();
  return {
    src: image.currentSrc,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
    layoutWidth: image.clientWidth,
    layoutHeight: image.clientHeight,
  };
};
try {
  browser = await puppeteer.launch({
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : { channel: 'chrome' }),
    headless: true,
  });
  for (const [width, dpr] of [
    [320, 1],
    [390, 1.75],
    [844, 1],
    [1440, 2],
  ])
    for (const javascript of [false, true]) {
      requests = [];
      const context = await browser.createBrowserContext(),
        page = await context.newPage(),
        errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setViewport({ width, height: 900, deviceScaleFactor: dpr });
      await page.setJavaScriptEnabled(javascript);
      await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil: 'networkidle2' });
      await page.waitForFunction(
        () =>
          Array.from(document.querySelectorAll('main img')).find((e) => e.getClientRects().length)
            ?.naturalWidth > 0
      );
      const before = await page.evaluate(geometry);
      assert.ok(before.src.includes('/girls-dress-'));
      const required = Math.ceil(
        Math.max(before.layoutWidth, before.layoutHeight / (800 / 533)) * dpr
      );
      const widthInSource = Number(before.src.match(/-(\d+)\.webp$/)[1]);
      assert.ok(widthInSource >= required, JSON.stringify({ before, required, dpr }));
      if (width === 390) assert.ok(before.src.endsWith('-360.webp'));
      if (javascript) {
        await page.addScriptTag({ content: client.outputFiles[0].text });
        await page.waitForSelector('[data-client]');
        const after = await page.evaluate(geometry);
        assert.deepEqual(after, before);
        await page.addScriptTag({ content: axe.source });
        const scan = await page.evaluate(() => window.axe.run());
        assert.deepEqual(
          scan.violations.map((v) => v.id),
          []
        );
      }
      assert.equal(requests.length, 1, JSON.stringify(requests));
      assert.deepEqual(errors, []);
      await page.screenshot({
        path: `artifacts/lighthouse/collection-assets-${width}-${dpr}-${javascript}.png`,
      });
      results.push({ width, dpr, javascript, before, required, requests: [...requests], errors });
      await context.close();
    }
  console.log('All 8 collection source/handoff cases passed');
} finally {
  await browser?.close();
  server.close();
  await writeFile(
    'artifacts/lighthouse/collection-assets-browser.json',
    JSON.stringify(
      {
        scope:
          'Actual shared collection renderer and hero; synthetic read-only categories; no commerce authority or production score claim',
        expectedCases: 8,
        passed: results.length === 8,
        results,
      },
      null,
      2
    )
  );
}
