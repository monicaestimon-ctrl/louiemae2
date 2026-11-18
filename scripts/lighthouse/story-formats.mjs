/* global document */
import { build } from 'esbuild';
import { Buffer } from 'node:buffer';
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
              ? `export const useSite=()=>({siteContent:{story:{hero:{title:'Our',subtitle:'Story',image:location.search.includes('empty')?'':'/images/brand/fam2.png'},prologue:{quote:'A considered home',subtext:'Fixture'},chapters:{oneText:"First",twoText:"Second",threeText:"Third",fourText:"Fourth"},epilogue:{},sections:[]}}});`
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
const render = (empty = false) =>
  pageDocument(template, {
    id: 'story',
    title: 'Our Story',
    heroTitle: 'Our',
    heroSubtitle: 'Story',
    description: 'Local image fixture',
    image: empty ? '' : '/images/brand/fam2.png',
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
      const bytes =
        fail === 'corrupt' && u.pathname.endsWith('.avif')
          ? Buffer.from('invalid-avif')
          : await readFile('public' + u.pathname);
      res.writeHead(200, { 'Content-Type': assets.get(u.pathname) });
      res.end(bytes);
      return;
    }
    if (u.pathname === '/story') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(render(u.searchParams.has('empty')));
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
  const loadedBoxes = new Map();
  const modes = [
    'avif',
    'disabled',
    'failure',
    'all-failed',
    'disabled-failed',
    'corrupt',
    'nojs-corrupt',
    'empty',
  ];
  for (const width of [390, 844, 1440])
    for (const mode of modes) {
      const context = await browser.createBrowserContext(),
        page = await context.newPage();
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1.75 });
      const requests = [],
        errors = [];
      let phase = 'server',
        heldClient;
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const path = new URL(request.url()).pathname;
        if (path === '/client.js') {
          heldClient = request;
          return;
        }
        if (assets.has(path)) requests.push({ path, phase, request });
        void request.continue();
      });
      page.on('response', (response) => {
        const record = requests.find((r) => r.request === response.request());
        if (record) record.status = response.status();
      });
      if (mode.startsWith('disabled')) {
        const session = await page.createCDPSession();
        await session.send('Emulation.setDisabledImageTypes', { imageTypes: ['avif'] });
      }
      if (mode === 'nojs-corrupt') await page.setJavaScriptEnabled(false);
      const query =
        mode === 'failure'
          ? '?failure=avif'
          : ['all-failed', 'disabled-failed'].includes(mode)
            ? '?failure=all'
            : mode.includes('corrupt')
              ? '?failure=corrupt'
              : mode === 'empty'
                ? '?empty=1'
                : '';
      const navigation = page.goto(`http://127.0.0.1:${server.address().port}/story${query}`, {
        waitUntil: 'networkidle0',
      });
      // Observe server markup before releasing the blocking interactive bundle.
      await page.waitForSelector('#lm-page-document');
      const serverMarkup = await page.$eval('#lm-page-document', (main) => {
        const source = main.querySelector('picture source'),
          img = main.querySelector('section img'),
          placeholder = main.querySelector('[role="img"]');
        const box = (img || placeholder)?.getBoundingClientRect();
        return {
          avif: source?.getAttribute('srcset'),
          media: source?.getAttribute('media'),
          sizes: source?.getAttribute('sizes'),
          webp: img?.getAttribute('srcset'),
          imageSizes: img?.getAttribute('sizes'),
          placeholder: !!placeholder,
          box: box && { width: box.width, height: box.height },
        };
      });
      if (mode === 'empty') assert.ok(serverMarkup.placeholder);
      else {
        assert.ok(serverMarkup.avif.includes('.avif 640w'));
        assert.ok(serverMarkup.webp.includes('.webp 640w'));
        assert.equal(serverMarkup.sizes, serverMarkup.imageSizes);
        assert.equal(serverMarkup.media, '(scripting: enabled)');
        await page.waitForFunction(
          () => document.querySelector('#lm-page-document section img')?.complete
        );
      }
      if (mode !== 'nojs-corrupt') {
        assert.ok(heldClient, 'Client must be held until server markup is inspected');
        phase = 'client';
        await heldClient.continue();
      }
      await navigation;
      const placeholderExpected = ['all-failed', 'disabled-failed', 'empty'].includes(mode);
      let actual;
      if (placeholderExpected) {
        await page.waitForSelector(
          '#root [role="img"][aria-label="Our Journey image unavailable"]'
        );
        actual = await page.$eval('#root [role="img"]', (e) => ({
          width: e.getBoundingClientRect().width,
          height: e.getBoundingClientRect().height,
        }));
        const baseline = loadedBoxes.get(width);
        assert.ok(
          Math.abs(actual.width - baseline.width) <= 1 &&
            Math.abs(actual.height - baseline.height) <= 1,
          'Placeholder preserves loaded photo width and height'
        );
        if (mode === 'empty')
          assert.ok(
            Math.abs(actual.height - serverMarkup.box.height) <= 1 &&
              Math.abs(actual.width - serverMarkup.box.width) <= 1,
            'Empty server/client geometry matches'
          );
      } else {
        const selector =
          mode === 'nojs-corrupt' ? '#lm-page-document section img' : '#root picture img';
        await page.waitForFunction(
          (selector) => {
            const img = document.querySelector(selector);
            return img?.complete && img.naturalWidth > 0;
          },
          {},
          selector
        );
        actual = await page.$eval(selector, (img) => ({
          source: img.currentSrc,
          alt: img.alt,
          width: img.getBoundingClientRect().width,
          height: img.getBoundingClientRect().height,
        }));
        assert.ok(actual.source.endsWith(mode === 'avif' ? '.avif' : '.webp'));
        assert.equal(actual.alt, 'Our Journey');
        if (mode === 'avif') loadedBoxes.set(width, actual);
      }
      const trace = requests.map(({ path, phase, status }) => ({ path, phase, status }));
      if (['failure', 'all-failed', 'corrupt'].includes(mode)) {
        const avifs = trace.filter((r) => r.path.endsWith('.avif'));
        assert.ok(avifs.length >= 1, 'Failure path must exercise AVIF');
        assert.ok(avifs.every((r) => r.status === (mode === 'corrupt' ? 200 : 404)));
        for (const stage of ['server', 'client'])
          assert.ok(
            avifs.filter((r) => r.phase === stage).length <= 1,
            'At most one AVIF attempt per phase'
          );
        assert.equal(trace.filter((r) => r.path.endsWith('.webp')).length, 1);
      } else if (mode === 'empty') assert.equal(trace.length, 0);
      else if (mode === 'disabled-failed') {
        assert.equal(trace.filter((r) => r.path.endsWith('.avif')).length, 0);
        for (const stage of ['server', 'client'])
          assert.ok(trace.filter((r) => r.phase === stage).length <= 1);
        assert.ok(trace.every((r) => r.status === 404));
      } else assert.equal(trace.length, 1, 'One healthy hero fetch through handoff');
      assert.deepEqual(errors, []);
      results.push({ width, mode, serverMarkup, actual, requests: trace, errors });
      await page.screenshot({ path: `${directory}/${width}-${mode}.png` });
      await context.close();
    }
  console.log(`${results.length} Story format/handoff cases passed`);
} finally {
  try {
    await writeFile(
      'artifacts/lighthouse/story-formats-browser.json',
      JSON.stringify(
        {
          expectedCases: 24,
          passed: results.length === 24,
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
