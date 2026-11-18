import { setTimeout as delay } from 'node:timers/promises';
/* global document, window, localStorage */
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const built = await build({
  stdin: {
    contents: `import React from'react';import{createRoot}from'react-dom/client';import{NewsletterPopup}from'./components/NewsletterPopup';createRoot(document.getElementById('root')).render(<main><h1>Newsletter loading verification</h1><button id="before">Browse</button><NewsletterPopup/></main>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  splitting: true,
  format: 'esm',
  outdir: 'tmp/newsletter-browser-fixture',
  write: false,
  metafile: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'source-boundaries',
      setup(b) {
        b.onResolve({ filter: /NewsletterContext$/ }, () => ({
          path: 'newsletter',
          namespace: 'fixture',
        }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `export const useNewsletter=()=>({addSubscriber:async()=>{window.fixtureCalls=(window.fixtureCalls||0)+1;if(!window.fixtureSuccess)throw Error('Synthetic failure');return true}});`,
          loader: 'js',
        }));
      },
    },
  ],
});
const files = new Map(built.outputFiles.map((f) => ['/' + path.basename(f.path), f.contents]));
const output = Object.entries(built.metafile.outputs);
const entry = '/' + path.basename(output.find(([, v]) => v.entryPoint === '<stdin>')[0]);
const form =
  '/' +
  path.basename(output.find(([, v]) => v.entryPoint?.endsWith('NewsletterPopupContent.tsx'))[0]);
const css = (await readdir('dist/assets')).find((n) => /^main-.*\.css$/.test(n));
const stylesheet = Buffer.concat([
  await readFile('dist/assets/' + css),
  ...built.outputFiles.filter((f) => f.path.endsWith('.css')).map((f) => Buffer.from(f.contents)),
]);
let mode = 'ready',
  requests = 0;
const pending = [];
const server = createServer(async (req, res) => {
  try {
    const name = new URL(req.url, 'http://local').pathname;
    if (req.method !== 'GET') {
      res.writeHead(405);
      return res.end();
    }
    if (name === form) {
      requests++;
      if (mode === 'failed') {
        res.writeHead(503);
        return res.end();
      }
      if (mode === 'held' || mode === 'timeout') await new Promise((r) => pending.push(r));
    }
    if (files.has(name)) {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(files.get(name));
    }
    if (name === '/main.css') {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      return res.end(stylesheet);
    }
    if (name === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(
        `<!doctype html><html lang="en"><head><title>Newsletter verification</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/main.css"></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`
      );
    }
    const root = path.resolve('public'),
      file = path.resolve(root, '.' + decodeURIComponent(name));
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    const bytes = await readFile(file);
    res.writeHead(200, {
      'Content-Type': name.endsWith('.woff2')
        ? 'font/woff2'
        : name.endsWith('.webp')
          ? 'image/webp'
          : 'image/png',
    });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: 'chrome' }),
  headless: true,
});
await mkdir('artifacts/lighthouse', { recursive: true });
const results = [];
try {
  for (const scenario of ['ready', 'held', 'failed', 'timeout'])
    for (const width of [320, 844, 1440]) {
      mode = scenario;
      requests = 0;
      const page = await browser.newPage();
      await page.setCacheEnabled(false);
      await page.setViewport({ width, height: 900 });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.evaluateOnNewDocument(() => localStorage.removeItem('lm_newsletter_dismissed'));
      await page.goto(origin, { waitUntil: 'networkidle2' });
      await page.focus('#before');
      assert.equal(requests, 0, 'Form must not load during initial startup');
      await page.evaluate(() => {
        const blocker = document.createElement('dialog');
        blocker.id = 'fixture-blocker';
        blocker.innerHTML = '<button>Other dialog</button>';
        document.body.append(blocker);
        blocker.showModal();
      });
      await delay(10500);
      assert.equal(requests, 0, 'No form prefetch while another dialog prevents opening');
      await page.evaluate(() => {
        const blocker = document.getElementById('fixture-blocker');
        blocker.close();
        blocker.remove();
        document.getElementById('before').focus();
      });
      await page.waitForSelector('dialog[open]', { timeout: 15000 });
      let loadingAxeViolations = null;
      await page.focus('button[aria-label="Close newsletter popup"]');
      await page.evaluate(() => {
        window.loadingClose = document.activeElement;
      });
      if (scenario === 'held' || scenario === 'timeout') {
        await page.waitForFunction(() =>
          document.body.textContent.includes('Opening the newsletter form')
        );
        const deadline = Date.now() + 5000;
        while (requests === 0 && Date.now() < deadline) await delay(10);
        assert.equal(requests, 1);
        await page.addScriptTag({ content: axe.source });
        loadingAxeViolations = await page.evaluate(async () =>
          (await window.axe.run(document.querySelector('dialog'))).violations.map((v) => v.id)
        );
        assert.deepEqual(loadingAxeViolations, []);
        assert.equal(
          await page.$eval('[data-newsletter-panel]', (e) => e.scrollWidth > e.clientWidth),
          false
        );
        if (scenario === 'held') for (const done of pending.splice(0)) done();
      }
      if (scenario === 'failed' || scenario === 'timeout') {
        await page.waitForFunction(() =>
          document.body.textContent.includes('newsletter form could not be loaded')
        );
        assert.equal(
          await page.evaluate(() => document.activeElement === window.loadingClose),
          true
        );
        for (const done of pending.splice(0)) done();
      } else {
        await page.waitForSelector('input[type="email"]');
        assert.equal(
          await page.evaluate(() => document.activeElement === window.loadingClose),
          true
        );
        await page.type('input[type="email"]', 'reader@example.com');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() =>
          document.querySelector('[role="alert"]')?.textContent.includes('Please try again')
        );
        assert.equal(await page.$eval('input', (i) => i.value), 'reader@example.com');
      }
      assert.equal(requests, 1, 'Request the form exactly once when it opens');
      assert.equal(
        await page.$eval('[data-newsletter-panel]', (e) => e.scrollWidth > e.clientWidth),
        false
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
        false,
        'No horizontal overflow'
      );
      await page.addScriptTag({ content: axe.source });
      const scan = await page.evaluate(() => window.axe.run(document.querySelector('dialog')));
      assert.deepEqual(
        scan.violations.map((v) => v.id),
        []
      );
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `artifacts/lighthouse/newsletter-${scenario}-${width}.png` });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'before');
      results.push({
        scenario,
        width,
        deferredUntilOpening: true,
        requests,
        axeViolations: 0,
        loadingAxeViolations,
        retainedCloseFocus: true,
        errors,
        dismissalRestoresFocus: true,
        noHorizontalOverflow: true,
      });
      await page.close();
    }
  await writeFile(
    'artifacts/lighthouse/newsletter-split-browser.json',
    JSON.stringify(
      {
        scope: 'Isolated actual components and built CSS, real opening delay, mocked signup only',
        results,
      },
      null,
      2
    )
  );
  console.log(`${results.length} deferred newsletter browser cases passed.`);
} finally {
  for (const done of pending.splice(0)) done();
  await browser.close();
  await new Promise((r) => server.close(r));
}
