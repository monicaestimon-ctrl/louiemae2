/* global window, document, innerWidth */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
const css = (await readdir('dist/assets')).find(file => /^main-.*\.css$/.test(file));
assert.ok(css, 'Build before checking collection forms.');
const bundle = await build({
  stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import{CollectionSignup}from'./components/CollectionSignup';createRoot(document.getElementById('root')).render(<main style={{padding:24,background:'#292524',color:'white',minHeight:'100vh'}}><h1>Collection updates</h1><CollectionSignup category="Lighting"/></main>)`, loader: 'tsx', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'local-subscription', setup(b) {
    b.onResolve({ filter: /\/NewsletterContext$/ }, () => ({ path: 'newsletter', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export function useNewsletter(){return{addSubscriberWithTags:async()=>{window.fixtureCalls=(window.fixtureCalls||0)+1;if(!window.fixtureSuccess)throw Error('Fixture unavailable');return true}}}` }));
  } }],
});
const browser = await puppeteer.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
const results = [];
try {
  for (const [width, height] of [[320, 900], [844, 390], [1440, 900]]) {
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width, height });
    await page.setContent('<!doctype html><html lang="en"><head><title>Collection form fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>');
    await page.addStyleTag({ content: await readFile(`dist/assets/${css}`, 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForSelector('input');
    await page.click('button');
    assert.equal(await page.evaluate(() => window.fixtureCalls || 0), 0);
    await page.type('input', 'fixture@example.com');
    await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[role=status]').textContent.includes('could not confirm'));
    assert.equal(await page.$eval('input', node => node.value), 'fixture@example.com');
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => (await window.axe.run()).violations.map(row => row.id));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    await page.evaluate(() => { window.fixtureSuccess = true; });
    await page.focus('button');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[role=status]').textContent.includes('on the list'));
    assert.equal(await page.evaluate(() => window.fixtureCalls), 2);
    assert.equal(await page.$eval('input', node => node.value), '');
    assert.deepEqual(errors, []); assert.deepEqual(violations, []); assert.equal(overflow, false);
    await page.screenshot({ path: `artifacts/lighthouse/collection-signup-${width}.png` });
    results.push({ width, height, violations, overflow, errors, fixtureCalls: 2 });
    await page.close();
  }
  await writeFile('artifacts/lighthouse/collection-signup-browser.json', JSON.stringify({ at: new Date().toISOString(), scope: 'Actual component with local subscription fixture; no real subscriptions', results }, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); }
