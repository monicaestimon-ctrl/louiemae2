/* global window, document, Event */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';

// Isolated UI acceptance. No production memberships, links or payments are created.
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import Referral from './components/partner/ProductRetailReferral';
window.fixtureState={status:'ready',data:{status:'eligible',category:'decor',applicableRateBps:800,productName:'Arden Lamp',destinationUrl:'https://www.louiemae.com/products/example?variant=brass',exceptionNote:'This item follows the décor schedule.',disclosureExample:'#ad — I earn a commission if you buy through my link.'}};
createRoot(document.getElementById('root')).render(<main><h1>Product referral verification</h1><Referral productId='example' variantId='brass' viewerKey='fixture' onAccount={()=>{}}/></main>);`;
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, outdir: 'artifacts/lighthouse/referral-fixture', format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  plugins: [{ name: 'inert-referrals', setup(b) {
    b.onResolve({ filter: /useRecoverableQuery$/ }, () => ({ path: 'query', namespace: 'fixture' }));
    b.onResolve({ filter: /^convex\/react$/ }, () => ({ path: 'mutation', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', resolveDir: process.cwd(), contents: args.path === 'query'
      ? `import{useEffect,useState}from'react';export function useRecoverableQuery(){const[,set]=useState(0);useEffect(()=>{const fn=()=>set(v=>v+1);window.addEventListener('fixture-change',fn);return()=>window.removeEventListener('fixture-change',fn)},[]);return {...window.fixtureState,retry:()=>{}}}`
      : `export function useMutation(){return async()=>({url:'https://www.louiemae.com/r/fixture-only'})}` }));
  } }],
});
await mkdir('artifacts/lighthouse', { recursive: true });
const browser = await puppeteer.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
const results = [];
try {
  for (const width of [320, 1440]) {
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width, height: 900 });
    await page.setContent('<!doctype html><html lang="en"><head><title>Product referral verification</title><meta http-equiv="Content-Security-Policy" content="connect-src \'none\';img-src data:"></head><body><div id="root"></div></body></html>');
    await page.addStyleTag({ content: await readFile('trade/style.css', 'utf8') });
    await page.addStyleTag({ content: 'main{max-width:600px;margin:auto;padding:16px}.pp-block{min-width:0}' });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
    await page.waitForSelector('section[aria-label="Retail referrals"] button');
    assert.equal(await page.$eval('section a', node => node.href), 'https://www.louiemae.com/products/example?variant=brass');
    await page.click('section button');
    await page.waitForSelector('input[aria-label="Retail referral link"]');
    assert.equal(await page.$eval('input', node => node.value), 'https://www.louiemae.com/r/fixture-only');
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(row => row.id));
    assert.deepEqual(violations, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: `artifacts/lighthouse/product-referral-${width}.png` });
    await page.evaluate(() => { window.fixtureState = {status:'ready',data:{status:'unavailable',message:'This option is not currently available for retail referrals.'}};window.dispatchEvent(new Event('fixture-change')); });
    await page.waitForFunction(() => document.body.textContent.includes('not currently available'));
    assert.equal(await page.$('section button'), null);
    assert.equal(await page.$('section input'), null);
    assert.deepEqual(errors, []);
    results.push({ width, retailDestination: true, manualCopy: true, eligibilityWithdrawal: true, axeViolations: 0 });
    await page.close();
  }
} finally { await browser.close(); }
await writeFile('artifacts/lighthouse/product-referral-browser.json', JSON.stringify({ isolatedFixture: true, results }, null, 2));
console.log(`Product referral checks passed at ${results.map(row => row.width).join(', ')}px.`);
