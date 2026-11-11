/* global document, window, navigator */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
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
    contents: `import React from'react';import{createRoot}from'react-dom/client';import CreatorHub from'./components/CreatorHub';createRoot(document.getElementById('root')).render(<CreatorHub/>);`,
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
      name: 'local-enrollment-only',
      setup(b) {
        b.onResolve({ filter: /^convex\/react$/ }, () => ({
          path: 'convex',
          namespace: 'fixture',
        }));
        b.onResolve({ filter: /^@convex-dev\/auth\/react$/ }, () => ({
          path: 'auth',
          namespace: 'fixture',
        }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents:
            args.path === 'auth'
              ? `export const useAuthActions=()=>({signIn:async()=>{throw Error('Forbidden fixture command')},signOut:async()=>{throw Error('Forbidden fixture command')}});`
              : `import{getFunctionName}from'convex/server';const data={'v2Admin:publicFlags':{creatorEnrollment:false},'holm:me':{signedIn:true},'holmPartners:hub':{refCode:'FIXTURE',tier:'active',clicks30:12,orders:1,quotes:0,payoutSetup:{enabled:false,connected:false,ready:false,due:0},payoutMinCents:5000,pendingCents:20000,clearedCents:0,paidCents:0,creditCents:0,commissions:[{source:'storefront_order',baseCents:200000,amountCents:20000,status:'pending',clearsAt:0,createdAt:0,channel:'pin',board:null,note:null,lines:[{type:'furniture',baseCents:200000,rateBps:1200,amountCents:20000,capped:false}]}]}};export const useQuery=ref=>data[getFunctionName(ref)];export const useMutation=ref=>async()=>{if(getFunctionName(ref)==='holm:ensureProfile')return;window.fixtureCommands=(window.fixtureCommands||0)+1;throw Error('Local fixture rejection')};export const useAction=useMutation;`,
          resolveDir: process.cwd(),
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
  for (const [site, cssPrefix] of [['creator', 'main']])
    for (const [width, height] of [
      [320, 900],
      [844, 390],
      [1440, 900],
    ]) {
      const page = await browser.newPage();
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
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
      await page.waitForSelector('table');
      await page.addScriptTag({ content: axe.source });
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          value: {
            writeText: async () => {
              throw Error('Fixture denied');
            },
          },
          configurable: true,
        });
        const button = [...document.querySelectorAll('button')].find(
          (b) => b.textContent.trim() === 'Copy'
        );
        button.click();
      });
      await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'alert');
      assert.equal(await page.evaluate(() => window.fixtureCommands || 0), 0);
      const violations = await page.evaluate(async () =>
        (await axe.run(document.querySelector('main'))).violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        }))
      );

      assert.deepEqual(violations, []);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
      );

      assert.equal(overflow, false);
      assert.deepEqual(pageErrors, []);
      results.push({
        site,
        width,
        height,
        violations,
        overflow,
        clipboardFailureFeedback: true,
      });
      await page.screenshot({
        path: `artifacts/lighthouse/legacy-creator-${site}-${width}.png`,
        fullPage: false,
      });
      await page.close();
    }
  await writeFile(
    'artifacts/lighthouse/legacy-creator-browser.json',
    JSON.stringify(
      {
        scope:
          'Legacy CreatorHub with synthetic balances and blocked clipboard; network blocked; no real enrollment, account or payout changes',
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
