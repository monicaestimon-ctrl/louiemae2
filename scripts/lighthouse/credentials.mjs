/* global document, window */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
const assets = await readdir('dist/assets').catch((cause) => {
  throw new Error('Missing production assets. Run "npm run build" first.', { cause });
});
const styles = Object.fromEntries(
  ['main', 'trade'].map((prefix) => {
    const css = assets.find((file) => file.startsWith(prefix + '-') && file.endsWith('.css'));
    assert.ok(css, `Missing dist/assets/${prefix}-*.css. Run "npm run build" first.`);
    return [prefix, css];
  })
);
const bundle = await build({
  stdin: {
    contents: `import React from'react';import{createRoot}from'react-dom/client';import{CredentialsForm}from'./components/account/CredentialsForm';createRoot(document.getElementById('root')).render(<main><h1>Account fixture</h1><CredentialsForm site={window.fixtureSite} googleEnabled afterSignIn="projects"/></main>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  outdir: 'artifacts/lighthouse/account-fixture',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'local-auth-only',
      setup(b) {
        b.onResolve({ filter: /^@convex-dev\/auth\/react$/ }, () => ({
          path: 'auth',
          namespace: 'fixture',
        }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `export function useAuthActions(){return{signIn:async()=>{window.authFixtureCalls=(window.authFixtureCalls||0)+1;throw Error('Local fixture rejection')}}}`,
          loader: 'js',
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
const results = [];
try {
  for (const [site, cssPrefix] of [
    ['creator', 'main'],
    ['trade', 'trade'],
  ])
    for (const [width, height] of [
      [320, 900],
      [844, 390],
      [1440, 900],
    ]) {
      const page = await browser.newPage();
      await page.setViewport({ width, height });
      await page.setContent(
        '<!doctype html><html lang="en"><head><title>Account verification</title><meta http-equiv="Content-Security-Policy" content="connect-src \'none\'"></head><body><div id="root"></div></body></html>'
      );
      await page.evaluate((value) => {
        window.fixtureSite = value;
      }, site);
      await page.addStyleTag({
        content: await readFile('dist/assets/' + styles[cssPrefix], 'utf8'),
      });
      for (const file of bundle.outputFiles.filter((f) => f.path.endsWith('.css')))
        await page.addStyleTag({ content: file.text });
      await page.addStyleTag({
        content: 'body{margin:0;background:#fff}main{padding:16px;max-width:700px}',
      });
      await page.addScriptTag({
        content: bundle.outputFiles.find((f) => f.path.endsWith('.js')).text,
      });
      await page.waitForSelector('form');
      await page.click('.credentials-primary');
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('role')), 'alert');
      assert.equal(await page.evaluate(() => window.authFixtureCalls || 0), 0);
      await page.click('[role=alert] a');
      assert.equal(await page.evaluate(() => document.activeElement.type), 'email');
      await page.type('input[type=email]', 'fixture@example.com');
      await page.type('input[type=password]', 'fixture-password');
      await page.click('.credentials-primary');
      await page.waitForFunction(
        () =>
          document.querySelector('[role=alert]')?.textContent.includes('That email') ||
          document.querySelector('[role=alert]')?.textContent.includes('We could not')
      );
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('role')), 'alert');
      const state = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        fields: [...document.querySelectorAll('input')].every(
          (e) => e.getBoundingClientRect().height >= 44
        ),
        calls: window.authFixtureCalls,
      }));
      assert.equal(state.overflow, false);
      assert.equal(state.fields, true);
      assert.equal(state.calls, 1);
      await page.screenshot({
        path: `artifacts/lighthouse/credentials-${site}-${width}.png`,
        fullPage: true,
      });
      results.push({
        site,
        width,
        height,
        ...state,
        validationFocus: true,
        failedProviderFocus: true,
      });
      await page.close();
    }
  await writeFile(
    'artifacts/lighthouse/credentials-browser.json',
    JSON.stringify(
      {
        scope:
          'Actual credentials component with local rejected auth fixture; network blocked; no real login, email or account creation',
        results,
      },
      null,
      2
    )
  );
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
