/* global document, window */
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
    contents: `import React from'react';import{createRoot}from'react-dom/client';import ProgramHubV2 from'./components/partner/ProgramHubV2';createRoot(document.getElementById('root')).render(<main><h1>Creator Hub</h1><h2>Your membership &amp; earnings</h2><ProgramHubV2 site={window.fixtureSite==='trade'?'trade':'creators'}/></main>);`,
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
          path: 'auth',
          namespace: 'fixture',
        }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `import{getFunctionName}from'convex/server';export const useQuery=ref=>getFunctionName(ref)==='v2Admin:publicFlags'?{creatorEnrollment:true}:getFunctionName(ref)==='prgMemberships:myPrograms'?{creator:{state:'profile'},trade:null,beneficiary:null,creatorTerms:{_id:'fixture',version:1},referralTerms:{_id:'fixture',version:1}}:undefined;export const useMutation=()=>async()=>{window.fixtureCommands=(window.fixtureCommands||0)+1;throw Error('Local fixture rejection')};export const useAction=useMutation;`,
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
      await page.addScriptTag({ content: axe.source });
      await page.click('form button[type=submit]');
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('role')), 'alert');
      assert.equal(await page.evaluate(() => window.fixtureCommands || 0), 0);
      await page.click('[role=alert] a');
      assert.equal(await page.evaluate(() => document.activeElement.tagName), 'INPUT');
      await page.type('form input', 'Fixture Creator');
      await page.type('textarea', 'javascript:alert(1)');
      await page.click('form button[type=submit]');
      assert.equal(await page.evaluate(() => window.fixtureCommands || 0), 0);
      await page.$eval('textarea', (element) => element.select());
      await page.keyboard.type('https://instagram.com/fixture');
      await page.click('form button[type=submit]');
      await page.waitForFunction(() => window.fixtureCommands === 1);
      await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'alert');
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
      results.push({
        site,
        width,
        height,
        violations,
        overflow,
        localValidation: true,
        mockCommands: 1,
      });
      await page.screenshot({
        path: `artifacts/lighthouse/enrollment-${site}-${width}.png`,
        fullPage: true,
      });
      await page.close();
    }
  await writeFile(
    'artifacts/lighthouse/enrollment-browser.json',
    JSON.stringify(
      {
        scope:
          'Actual ProgramHubV2 enrollment with rejected local membership commands; network blocked; no real enrollment, email or account changes',
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
