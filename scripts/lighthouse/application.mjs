/* global document, window, setTimeout, innerWidth */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
const assets = await readdir('dist/assets').catch((cause) => {
  throw new Error('Run npm run build before the application browser check.', { cause });
});
const css = assets.find((file) => /^trade-.*\.css$/.test(file));
assert.ok(css, 'Missing trade stylesheet. Run npm run build first.');
const bundle = await build({
  stdin: {
    contents: `import React from'react';import{createRoot}from'react-dom/client';import{TradeApplication}from'./trade/TradeApplication';createRoot(document.getElementById('root')).render(<TradeApplication me={{signedIn:true,verified:false}} onNavigate={()=>{throw Error('Navigation prohibited')}} onSignIn={()=>{throw Error('Sign-in prohibited')}}/>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  outdir: 'artifacts/lighthouse/application-fixture',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'mock-application',
      setup(b) {
        b.onResolve({ filter: /^convex\/react$/ }, () => ({
          path: 'convex',
          namespace: 'fixture',
        }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `export const useQuery=()=>null;export const useMutation=()=>async()=>{window.fixtureCommands=(window.fixtureCommands||0)+1;throw Error('Local fixture rejection')}`,
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
  for (const [width, height] of [
    [320, 900],
    [844, 390],
    [1440, 900],
  ]) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewport({ width, height });
    await page.setContent(
      '<!doctype html><html lang="en"><head><title>Trade application fixture</title><meta http-equiv="Content-Security-Policy" content="connect-src \'none\'"></head><body><div id="root"></div></body></html>'
    );
    await page.addStyleTag({ content: await readFile('dist/assets/' + css, 'utf8') });
    for (const file of bundle.outputFiles.filter((file) => file.path.endsWith('.css')))
      await page.addStyleTag({ content: file.text });
    await page.addScriptTag({
      content: bundle.outputFiles.find((file) => file.path.endsWith('.js')).text,
    });
    await page.waitForSelector('form');
    await page.addScriptTag({ content: axe.source });
    const check = async (stage) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const state = await page.evaluate(async () => ({
        violations: (await axe.run(document.querySelector('main'))).violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
      assert.deepEqual(state.violations, [], JSON.stringify({ width, stage, state }));
      assert.equal(state.overflow, false, stage);
      results.push({ width, height, stage, ...state });
    };
    const fill = async (label, text) => {
      const id = await page.evaluate(
        (label) =>
          [...document.querySelectorAll('label')].find((element) => element.textContent === label)
            ?.htmlFor,
        label
      );
      assert.ok(id, label);
      await page.type(`[id="${id}"]`, text);
    };
    const next = () => page.click('form > .row > .btn-ink');
    await next();
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('role')), 'alert');
    await check('business-type-error');
    await page.click('.typec:nth-child(2)');
    await next();
    assert.equal(
      await page.evaluate(() => document.activeElement.textContent),
      'Tell us about the business'
    );
    await next();
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('role')), 'alert');
    assert.equal(await page.evaluate(() => window.fixtureCommands || 0), 0);
    await check('business-details-errors');
    await fill('Legal business name', 'Fixture Studio');
    await fill('EIN', '123456789');
    await fill('Website or business Instagram', '@fixturestudio');
    await next();
    await next();
    await check('credential-error');
    await page.type('form fieldset input', 'Fixture portfolio');
    await next();
    await page.click('input[type=checkbox]');
    await check('tax-certificate');
    await next();
    await check('review');
    assert.equal(
      await page.evaluate(() => document.querySelector('main').textContent.includes('12-3456789')),
      false
    );
    await next();
    await page.waitForSelector('[role=alert]');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('role')), 'alert');
    assert.equal(await page.evaluate(() => window.fixtureCommands || 0), 1);
    await check('mock-rejection');
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: `artifacts/lighthouse/trade-application-${width}.png`,
      fullPage: true,
    });
    await page.close();
  }
  await writeFile(
    'artifacts/lighthouse/trade-application-browser.json',
    JSON.stringify(results, null, 2)
  );
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
