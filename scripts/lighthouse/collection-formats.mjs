/* global document */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, URL } from 'node:url';
import puppeteer from 'puppeteer-core';
const directory = 'artifacts/lighthouse/collection-formats';
await mkdir(directory, { recursive: true });
const source = '/images/brand/mae-dress.png';
const categories = (count) =>
  Array.from({ length: count }, (_, i) => ({
    id: `category-${i}`,
    title: `Category ${i}`,
    image: i === 0 ? source : '',
  }));
const serverBuild = await build({
  stdin: {
    contents: "export {collectionDocument} from './lib/serverCollectionDocument';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  packages: 'external',
});
const modulePath = resolve(directory, 'render.mjs');
await writeFile(modulePath, serverBuild.outputFiles[0].text);
const { collectionDocument } = await import(pathToFileURL(modulePath).href);
const client = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {CollectionRootHero} from './components/CollectionRootHero';const count=Number(new URLSearchParams(location.search).get('count'));const categories=Array.from({length:count},(_,i)=>({id:'category-'+i,title:'Category '+i,image:i===0?'${source}':''}));function App(){React.useEffect(()=>{document.getElementById('lm-collection-document')?.remove()},[]);return <main className="bg-cream min-h-screen pt-20"><section className="relative w-full min-h-screen flex flex-col"><CollectionRootHero collection="fashion" title="Fashion" subtitle="Clothing" categories={categories}/></section></main>};createRoot(document.getElementById('root')).render(<App/>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const manifest = JSON.parse(await readFile('lib/imageManifest.json', 'utf8'))[source];
const assets = new Map(
  manifest.widths.flatMap((w) => [
    [`${manifest.base}-${w}.webp`, 'image/webp'],
    [`${manifest.avifBase}-${w}.avif`, 'image/avif'],
  ])
);
const vite = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
const css = await readFile('dist/' + vite['index.html'].css[0], 'utf8');
const template = `<!doctype html><html lang="en"><head><title>Collection fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><!--product-document--><div id="root"></div><script src="/client.js"></script></body></html>`;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://fixture.invalid');
    if (url.pathname === '/client.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(client.outputFiles[0].text);
      return;
    }
    if (assets.has(url.pathname)) {
      const mode = new URL(req.headers.referer || '/', 'http://fixture.invalid').searchParams.get(
        'mode'
      );
      if (mode === 'all-failed' || (mode === 'failure' && url.pathname.endsWith('.avif'))) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': assets.get(url.pathname),
        'Cache-Control': 'public,max-age=3600',
      });
      res.end(await readFile('public' + url.pathname));
      return;
    }
    if (url.pathname === '/collection/fashion') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        collectionDocument(template, {
          id: 'fashion',
          title: 'Fashion',
          subtitle: 'Clothing',
          primaryCategoryImage: source,
          rootCategories: categories(Number(url.searchParams.get('count'))),
          categories: [],
          cards: [],
        })
      );
      return;
    }
    res.writeHead(404);
    res.end();
  } catch {
    res.writeHead(500);
    res.end();
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
let browser;
const results = [];
try {
  browser = await puppeteer.launch({
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : { channel: 'chrome' }),
    headless: true,
  });
  for (const width of [390, 844, 1440])
    for (const count of [1, 6])
      for (const mode of ['avif', 'disabled', 'failure', 'all-failed', 'nojs']) {
        const context = await browser.createBrowserContext(),
          page = await context.newPage();
        await page.setViewport({ width, height: 900, deviceScaleFactor: 1.75 });
        const requests = [],
          errors = [];
        let heldClient;
        page.on('pageerror', (e) => errors.push(e.message));
        await page.setRequestInterception(true);
        page.on('request', (r) => {
          const path = new URL(r.url()).pathname;
          if (path === '/client.js') {
            heldClient = r;
            return;
          }
          if (assets.has(path)) requests.push(path);
          void r.continue();
        });
        if (mode === 'disabled') {
          const cdp = await page.createCDPSession();
          await cdp.send('Emulation.setDisabledImageTypes', { imageTypes: ['avif'] });
        }
        if (mode === 'nojs') await page.setJavaScriptEnabled(false);
        const navigation = page.goto(
          `http://127.0.0.1:${server.address().port}/collection/fashion?count=${count}&mode=${mode}`,
          { waitUntil: 'networkidle0' }
        );
        await page.waitForSelector('#lm-collection-document');
        await page.waitForFunction(() =>
          [...document.querySelectorAll('#lm-collection-document img')].every((i) => i.complete)
        );
        const initial = await page.$eval('#lm-collection-document', (el) => {
          const img = [...el.querySelectorAll('img')].find((i) => i.checkVisibility());
          const preload = document.querySelector('link[as="image"]');
          const source = el.querySelector('picture source');
          return {
            image: img?.currentSrc,
            preload: preload?.getAttribute('imagesrcset'),
            source: source?.getAttribute('srcset'),
            sizes: source?.getAttribute('sizes'),
            preloadSizes: preload?.getAttribute('imagesizes'),
          };
        });
        assert.equal(initial.preload, undefined);
        assert.ok(initial.source.includes('.avif'));
        if (mode !== 'nojs') {
          assert.ok(heldClient);
          await heldClient.continue();
        }
        await navigation;
        let actual;
        if (mode === 'all-failed') {
          await page.waitForFunction(() => !document.querySelector('#root img'));
          assert.ok(await page.$('#root a'));
          actual = { placeholder: true };
        } else {
          const root = mode === 'nojs' ? '#lm-collection-document' : '#root';
          await page.waitForFunction(
            (root) => {
              const img = [...document.querySelectorAll(root + ' img')].find((i) =>
                i.checkVisibility()
              );
              return img?.complete && img.naturalWidth > 0;
            },
            {},
            root
          );
          actual = await page.$eval(root, (el) => {
            const img = [...el.querySelectorAll('img')].find((i) => i.checkVisibility());
            return {
              source: img.currentSrc,
              alt: img.alt,
              width: img.getBoundingClientRect().width,
              height: img.getBoundingClientRect().height,
            };
          });
          assert.ok(actual.source.endsWith(mode === 'avif' ? '.avif' : '.webp'));
          assert.equal(actual.alt, '');
          if (mode === 'avif') {
            assert.equal(actual.source, initial.image);
            assert.equal(
              requests.length,
              1,
              'One healthy source fetch across server/client handoff'
            );
          }
          if (mode === 'nojs' || mode === 'disabled')
            assert.ok(requests.every((p) => p.endsWith('.webp')));
        }
        assert.deepEqual(errors, []);
        results.push({ width, count, mode, initial, actual, requests });
        await context.close();
      }
  console.log(`${results.length} collection image format/handoff cases passed`);
} finally {
  await writeFile(
    'artifacts/lighthouse/collection-formats-browser.json',
    JSON.stringify(
      {
        expectedCases: 30,
        passed: results.length === 30,
        scope: 'Local collection source document and real React component; no production commands',
        results,
      },
      null,
      2
    )
  );
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  if (browser) await browser.close();
}
