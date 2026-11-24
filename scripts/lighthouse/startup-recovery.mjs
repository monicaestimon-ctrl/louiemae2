/* global document, window, getComputedStyle */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const bundle = await build({
  stdin: {
    contents:
      "import{showStartupFailure}from'./lib/moduleRecovery';window.failStartup=()=>showStartupFailure(new Error('Synthetic module failure'));",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
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
  for (const source of [
    'lm-product-document',
    'lm-collection-document',
    'lm-page-document',
    'lm-journal-document',
  ]) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844 });
    await page.setContent(
      `<style>#${source}~#root{visibility:hidden}</style><main id="${source}">Initial public content</main><div id="root"></div>`
    );
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => window.failStartup());
    const result = await page.evaluate(() => ({
      mainCount: document.querySelectorAll('main').length,
      recoveryVisibility: getComputedStyle(document.getElementById('root')).visibility,
      heading: document.querySelector('#root h1')?.textContent,
    }));
    assert.equal(result.mainCount, 1);
    assert.equal(result.recoveryVisibility, 'visible');
    assert.ok(result.heading);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BUTTON');
    results.push({ source, ...result, keyboardRecovery: true });
    await page.screenshot({ path: `artifacts/lighthouse/startup-recovery-${source}.png` });
    await page.close();
  }
  await writeFile(
    'artifacts/lighthouse/startup-recovery-browser.json',
    JSON.stringify(
      {
        scope:
          'Actual startup recovery with synthetic initial documents; no network or commerce commands',
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
