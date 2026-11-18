/* global document */
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL, URL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const directory = 'artifacts/lighthouse/story-formats';
await mkdir(directory, { recursive: true });
const serverBundle = await build({
  stdin: {
    contents: "export {pageDocument} from './lib/serverPageDocument';",
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
await writeFile(modulePath, serverBundle.outputFiles[0].text);
const { pageDocument } = await import(pathToFileURL(modulePath).href);
const client = await build({
  stdin: {
    contents:
      "import React from'react';import{createRoot}from'react-dom/client';import{StoryPage}from'./components/StoryPage';createRoot(document.getElementById('root')).render(<StoryPage/>);",
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'local-story',
      setup(b) {
        b.onResolve({ filter: /BlogContext$/ }, () => ({ path: 'site', namespace: 'fixture' }));
        b.onResolve({ filter: /DynamicPage$/ }, () => ({ path: 'sections', namespace: 'fixture' }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents:
            args.path === 'site'
              ? `export const useSite=()=>({siteContent:{story:{hero:{title:'Our',subtitle:'Story',image:'/images/brand/fam2.png'},prologue:{quote:'A considered home',subtext:'Fixture'},chapters:{oneText:"First",twoText:"Second",threeText:"Third",fourText:"Fourth"},epilogue:{},sections:[]}}});`
              : 'export const DynamicSectionRenderer=()=>null;',
          loader: 'js',
        }));
      },
    },
  ],
});
const manifest = JSON.parse(await readFile('lib/imageManifest.json', 'utf8'));
const entry = manifest['/images/brand/fam2.png'];
const assets = new Map(
  entry.widths.flatMap((w) => [
    [`${entry.base}-${w}.webp`, 'image/webp'],
    [`${entry.avifBase}-${w}.avif`, 'image/avif'],
  ])
);
const vite = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
const css = await readFile('dist/' + vite['index.html'].css[0], 'utf8');
const template = `<!doctype html><html lang="en"><head><title>Story fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><!--product-document--><div id="root"></div><script src="/client.js"></script></body></html>`;
const html = pageDocument(template, {
  id: 'story',
  title: 'Our Story',
  heroTitle: 'Our',
  heroSubtitle: 'Story',
  description: 'Local image fixture',
  image: '/images/brand/fam2.png',
  sections: [],
  links: [],
});
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://fixture.invalid');
    if (u.pathname === '/client.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(client.outputFiles[0].text);
      return;
    }
    if (assets.has(u.pathname)) {
      const fail = new URL(req.headers.referer || '/', 'http://fixture.invalid').searchParams.get(
        'failure'
      );
      if (fail === 'all' || (fail === 'avif' && u.pathname.endsWith('.avif'))) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': assets.get(u.pathname) });
      res.end(await readFile('public' + u.pathname));
      return;
    }
    if (u.pathname === '/story') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
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
    for (const mode of ['avif', 'disabled', 'failure', 'all-failed']) {
      const context = await browser.createBrowserContext(),
        page = await context.newPage();
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1.75 });
      const requests = [],
        errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('request', (r) => {
        const path = new URL(r.url()).pathname;
        if (assets.has(path)) requests.push(path);
      });
      if (mode === 'disabled') {
        const session = await page.createCDPSession();
        await session.send('Emulation.setDisabledImageTypes', { imageTypes: ['avif'] });
      }
      await page.goto(
        `http://127.0.0.1:${server.address().port}/story${mode === 'failure' ? '?failure=avif' : mode === 'all-failed' ? '?failure=all' : ''}`,
        { waitUntil: 'networkidle0' }
      );
      if (mode === 'all-failed') {
        await page.waitForSelector('[role="img"][aria-label="Our Journey image unavailable"]');
        const box = await page.$eval(
          '[role="img"][aria-label="Our Journey image unavailable"]',
          (e) => ({
            width: e.getBoundingClientRect().width,
            height: e.getBoundingClientRect().height,
          })
        );
        assert.ok(
          Math.abs(box.height / box.width - entry.ratio) < 0.01,
          'Failure reserves the photo geometry'
        );
        assert.ok(requests.length <= 3, 'All-media failure cannot loop');
        assert.equal(requests.filter((r) => r.endsWith('.webp')).length, 1);
        assert.deepEqual(errors, []);
        results.push({ width, mode, box, requests, errors });
        await page.screenshot({ path: `${directory}/${width}-${mode}.png` });
        await context.close();
        continue;
      }
      await page.waitForFunction(() => {
        const img = document.querySelector('main[data-public-page="story"] picture img');
        return img?.complete && img.naturalWidth > 0;
      });
      const actual = await page.$eval('main picture img', (img) => ({
        source: img.currentSrc,
        alt: img.alt,
        width: img.getBoundingClientRect().width,
      }));
      assert.ok(actual.source.endsWith(mode === 'avif' ? '.avif' : '.webp'));
      assert.equal(actual.alt, 'Our Journey');
      if (mode === 'failure') {
        assert.ok(
          requests.length <= 3,
          'At most one failed AVIF request per server/client document, then one WebP'
        );
        assert.equal(requests.filter((r) => r.endsWith('.webp')).length, 1);
      } else assert.equal(requests.length, 1, 'No duplicate healthy hero fetch during handoff');
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `${directory}/${width}-${mode}.png` });
      assert.ok(requests.length <= (mode === 'failure' ? 3 : 1));
      results.push({ width, mode, actual, requests, errors });
      await context.close();
    }
  console.log(`${results.length} Story format/handoff cases passed`);
} finally {
  try {
    await writeFile(
      'artifacts/lighthouse/story-formats-browser.json',
      JSON.stringify(
        {
          expectedCases: 12,
          passed: results.length === 12,
          scope: 'Local actual StoryPage and initial server document; no commerce commands',
          results,
        },
        null,
        2
      )
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (browser) await browser.close();
  }
}
