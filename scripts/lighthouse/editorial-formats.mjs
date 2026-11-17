/* global document */
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL, URL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const directory = 'artifacts/lighthouse/editorial-format-fixture';
await mkdir(directory, { recursive: true });
const manifest = JSON.parse(await readFile('lib/editorialImageManifest.json', 'utf8'));
const [source, entry] = Object.entries(manifest)[0];
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {JournalIndexLead,JournalArticleHero} from './components/JournalLead';export const render=(kind,post)=>renderToStaticMarkup(React.createElement(kind==='index'?JournalIndexLead:JournalArticleHero,kind==='index'?{featuredPost:post}:{post}));`,
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
await writeFile(modulePath, bundle.outputFiles[0].text);
const { render } = await import(pathToFileURL(modulePath).href);
const post = {
  id: 'fixture',
  image: source,
  title: 'A thoughtful home',
  excerpt: 'Public editorial fixture',
  category: 'Home',
  date: 'November 17, 2026',
};
const assets = new Map(
  Object.values(entry.windows).flatMap((image) =>
    image.widths.flatMap((width) => [
      [`${image.base}-${width}.webp`, 'image/webp'],
      [`${image.avifBase}-${width}.avif`, 'image/avif'],
    ])
  )
);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://fixture.invalid');
    if (assets.has(url.pathname)) {
      res.writeHead(200, { 'Content-Type': assets.get(url.pathname) });
      res.end(await readFile('public' + url.pathname));
      return;
    }
    if (url.pathname === '/index' || url.pathname === '/article') {
      const kind = url.pathname.slice(1);
      res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
      res.end(
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Editorial format fixture</title><style>body{margin:0}picture{display:block;width:100vw}picture img{display:block;width:100%;height:auto}.index picture{width:calc(100vw - 48px);max-width:1280px}@media(min-width:768px){.index picture{width:calc(100vw - 96px)}}</style></head><body class="' +
          kind +
          '">' +
          render(kind, post) +
          '</body></html>'
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
  for (const width of [390, 768, 1440])
    for (const kind of ['index', 'article'])
      for (const fallback of [false, true]) {
        const page = await browser.newPage();
        await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
        const client = await page.createCDPSession();
        if (fallback)
          await client.send('Emulation.setDisabledImageTypes', { imageTypes: ['avif'] });
        const requests = [];
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('request', (req) => {
          if (req.resourceType() === 'image') requests.push(new URL(req.url()).pathname);
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/${kind}`, {
          waitUntil: 'networkidle0',
        });
        await page.waitForFunction(() => {
          const img = document.querySelector('picture img');
          return img?.complete && img.naturalWidth > 0;
        });
        const actual = await page.$eval('picture img', (img) => ({
          src: img.currentSrc,
          width: img.naturalWidth,
          height: img.naturalHeight,
          alt: img.alt,
        }));
        const crop = entry.windows[`${kind}${width >= 768 ? 'Desktop' : 'Mobile'}`];
        const base = fallback ? crop.base : crop.avifBase;
        const extension = fallback ? 'webp' : 'avif';
        assert.ok(new URL(actual.src).pathname.startsWith(base + '-'));
        assert.ok(actual.src.endsWith('.' + extension));
        assert.equal(actual.alt, kind === 'index' ? '' : post.title);
        assert.equal(
          requests.length,
          1,
          'The picture must not preload/download its fallback as well'
        );
        assert.deepEqual(errors, []);
        const screenshot = `${kind}-${width}-${extension}.png`;
        // Full-page capture can temporarily resize Chrome and trigger another media source.
        // Keep the measured viewport intact, and assert the request count after capture too.
        await page.screenshot({ path: resolve(directory, screenshot), fullPage: false });
        assert.equal(requests.length, 1, 'Capture must preserve the measured responsive source');
        results.push({ kind, width, fallback, actual, requests, errors, screenshot });
        await page.close();
      }
  await writeFile(
    'artifacts/lighthouse/editorial-formats-browser.json',
    JSON.stringify(
      {
        scope:
          'Actual shared server/client picture renderer; verified local originals and derivatives; AVIF disabled with browser protocol for fallback cases; no business commands',
        results,
      },
      null,
      2
    )
  );
  console.log(JSON.stringify(results));
} finally {
  try {
    if (browser) await browser.close();
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
