/* global window, document */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const output = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{HouseStaffGate}from'./trade/admin/HouseStaffGate';function App(){const[admin,setAdmin]=useState(true);window.setAdmin=setAdmin;return <HouseStaffGate admin={admin} toast={()=>{}} Turntable={()=>null}/>};createRoot(document.getElementById('root')).render(<App/>);`,
  },
  loader: { '.css': 'empty' },
  bundle: true,
  write: false,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'isolated-staff',
      setup(b) {
        b.onResolve({ filter: /contexts\/useRecoverableQuery$/ }, () => ({
          path: 'query',
          namespace: 'fixture',
        }));
        b.onResolve({ filter: /^convex\/react$/ }, () => ({
          path: 'convex',
          namespace: 'fixture',
        }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          resolveDir: process.cwd(),
          loader: 'js',
          contents:
            path === 'convex'
              ? `export const useMutation=()=>()=>{window.writes++;throw Error('No writes allowed')}`
              : `import{useState}from'react';import{getFunctionName}from'convex/server';const empty=[];const assets=[{productId:'fixture-chair',name:'Fixture chair',image:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',dimsCm:null}];export function useRecoverableQuery(ref){const[retry,setRetry]=useState(false);window.queries++;return window.location.search.includes('unavailable')&&!retry?{status:'unavailable',retry:()=>{window.retries++;setRetry(true)}}:{status:'ready',data:getFunctionName(ref)==='holmAssets:readiness'?assets:empty,retry:()=>{}}}`,
        }));
      },
    },
  ],
});
const css =
  (await readFile('trade/style.css', 'utf8')) + (await readFile('trade/admin/staff.css', 'utf8'));
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html');
  res.end(
    req.url === '/app.js'
      ? output.outputFiles[0].text
      : `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>House staff fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.writes=0;window.queries=0;window.retries=0;</script><script src="/app.js"></script></body></html>`
  );
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox'],
});
const results = [];
await mkdir('artifacts/lighthouse/house-staff', { recursive: true });
try {
  for (const [width, height] of [
    [390, 900],
    [844, 390],
    [1440, 900],
  ]) {
    const page = await browser.newPage(),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width, height });
    await page.goto(origin, { waitUntil: 'networkidle0' });
    const click = async (name) => {
      const found = await page.evaluate((name) => {
        const b = [...document.querySelectorAll('button')].find(
          (b) => b.textContent.trim() === name
        );
        b?.click();
        return !!b;
      }, name);
      assert.ok(found, name);
    };
    for (const tab of [
      'Trade applications',
      'Sourcing',
      'Pricing',
      'Asset readiness',
      'Partners',
    ]) {
      await click(tab);
      await page.waitForFunction(() => !document.querySelector('[role="status"]'));
      if (tab === 'Asset readiness') {
        await click('Fixture chair');
        await page.waitForSelector('.rd-body');
        await page.focus('input[type=file]');
        assert.equal(
          await page.$eval('input[type=file]', (e) => e === document.activeElement),
          true
        );
      }
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(() => window.axe.run());
      assert.deepEqual(
        violations.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
        [],
        tab
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
        tab + ' overflow'
      );
      await page.screenshot({
        path: `artifacts/lighthouse/house-staff/${tab.replaceAll(' ', '-')}-${width}.png`,
        fullPage: true,
      });
    }
    assert.equal(await page.evaluate(() => window.writes), 0, 'Tab checks attempted a mutation');
    await page.goto(origin + '?unavailable', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[role="alert"]');
    await click('Try again');
    await page.waitForFunction(() => !document.querySelector('[role="alert"]'));
    assert.equal(await page.evaluate(() => window.retries), 1);
    await page.evaluate(() => window.setAdmin(false));
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Team only');
    assert.equal(await page.evaluate(() => window.writes), 0);
    assert.deepEqual(errors, []);
    results.push({
      width,
      height,
      tabs: 5,
      axeViolations: 0,
      overflow: false,
      retry: true,
      roleLoss: true,
      writes: 0,
    });
    await page.close();
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
await writeFile(
  'artifacts/lighthouse/house-staff/results.json',
  JSON.stringify(
    {
      scope:
        'Actual staff module, isolated subscriptions and forbidden mutations. Does not prove production authorization or financial workflows.',
      results,
    },
    null,
    2
  )
);
console.log(JSON.stringify(results));
