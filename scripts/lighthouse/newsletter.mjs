/* global document, window */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
const css = (await readdir('dist/assets')).find(file => /^trade-.*\.css$/.test(file));
assert.ok(css, 'Build the application first.');
const bundle = await build({
  stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import{TradeNewsletter}from'./trade/TradeNewsletter';createRoot(document.getElementById('root')).render(<main><h1>Newsletter fixture</h1><TradeNewsletter/></main>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'mock-newsletter', setup(b) {
    b.onResolve({ filter: /^convex\/react$/ }, () => ({ path: 'convex', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `export const useMutation=()=>async args=>{window.fixtureCalls=(window.fixtureCalls||0)+1;window.fixtureArgs=args;if(window.fixtureSuccess)return 'fixture-id';throw Error('Fixture failure')}` }));
  } }],
});
const browser = await puppeteer.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
try {
  const results = [];
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width, height: 900 });
    await page.setContent('<!doctype html><html lang="en"><head><title>Newsletter fixture</title><meta http-equiv="Content-Security-Policy" content="connect-src \'none\'"></head><body><div id="root"></div></body></html>');
    await page.addStyleTag({ content: await readFile(`dist/assets/${css}`, 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForSelector('input');
    await page.click('button');
    assert.equal(await page.$eval('input', input => input === document.activeElement && input.getAttribute('aria-invalid') === 'true'), true);
    assert.equal(await page.evaluate(() => window.fixtureCalls || 0), 0);
    await page.type('input', 'Test@Example.com');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[role="status"]').textContent.includes('could not confirm'));
    assert.equal(await page.$eval('input', input => input.value), 'Test@Example.com');
    await page.evaluate(() => { window.fixtureSuccess = true; });
    await page.click('button');
    await page.waitForFunction(() => document.querySelector('[role="status"]').textContent.includes('You’re subscribed'));
    assert.equal(await page.$eval('input', input => input.value), '');
    assert.equal(await page.evaluate(() => window.fixtureArgs.email), 'test@example.com');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => ({ id: v.id, impact: v.impact })));
    assert.deepEqual(violations, []);
    assert.deepEqual(errors, []);
    results.push({ width, validationFocus: true, failureRetainsInput: true, confirmedSuccessOnly: true, noOverflow: true, violations });
    await page.close();
  }
  await writeFile('artifacts/lighthouse/newsletter-browser.json', JSON.stringify({ scope: 'Actual component, production CSS, mocked responses, network blocked; no real subscriptions', results }, null, 2));
  console.log('Newsletter responsive, keyboard, feedback and axe checks passed.');
} finally { await browser.close(); }
