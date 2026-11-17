/* global document, window */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
const files = await readdir('dist/assets');
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import{FadeIn}from'./components/FadeIn';window.IntersectionObserver=class{constructor(cb){window.reveal=()=>cb([{isIntersecting:true}])}observe(){}unobserve(){}};createRoot(document.getElementById('root')).render(<main><FadeIn delay={100}><h1>New arrivals</h1><p>Current product information remains readable.</p><a href='#details'>View details</a></FadeIn></main>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: 'chrome' }),
  headless: true,
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setContent(
    '<!doctype html><html lang="en"><head><title>Reveal contrast fixture</title></head><body><div id="root"></div></body></html>'
  );
  const styles = files.filter((name) => /^main-.*\.css$/.test(name));
  assert.equal(styles.length, 1, 'Build the current retail stylesheet before this fixture');
  for (const file of styles)
    await page.addStyleTag({ content: await readFile('dist/assets/' + file, 'utf8') });
  await page.addStyleTag({ content: 'body {background:#faf8f2;color:#3b2d24} a {color:inherit}' });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.waitForSelector('.lm-reveal');
  await page.addScriptTag({ content: axe.source });
  const results = [];
  for (const stage of ['before', 'moving', 'focused', 'reduced-motion']) {
    if (stage === 'moving') {
      await page.evaluate(() => window.reveal());
      await page.waitForFunction(() => {
        const value = window.getComputedStyle(document.querySelector('.lm-reveal')).transform;
        const y = new window.DOMMatrix(value).m42;
        return y > 0 && y < 60;
      });
    }
    if (stage === 'focused') await page.focus('a');
    if (stage === 'reduced-motion') {
      await page.$eval('a', (element) => element.blur());
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    }
    const state = await page.$eval('.lm-reveal', (element) => {
      const css = window.getComputedStyle(element);
      return {
        opacity: css.opacity,
        transitionProperty: css.transitionProperty,
        transform: css.transform,
      };
    });
    assert.equal(state.opacity, '1');
    assert.notEqual(state.transitionProperty, 'all');
    const violations = await page.evaluate(async () =>
      (await axe.run(document.querySelector('main'))).violations.map((v) => v.id)
    );
    assert.deepEqual(violations, []);
    if (stage === 'focused' || stage === 'reduced-motion') assert.equal(state.transform, 'none');
    results.push({ stage, ...state, violations });
  }
  await mkdir('artifacts/lighthouse', { recursive: true });
  await writeFile('artifacts/lighthouse/reveal-browser.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
