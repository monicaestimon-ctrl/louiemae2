/* global window, document */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const app = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `import React from'react';import{createRoot}from'react-dom/client';import{LiveShell}from'./trade/LiveShell';const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<LiveShell/>);window.render();`,
  },
  bundle: true,
  write: false,
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'read-only-entry',
      setup(b) {
        b.onResolve({ filter: /^convex\/react$/ }, () => ({
          path: 'convex',
          namespace: 'fixture',
        }));
        b.onResolve({ filter: /^\.\/app$/ }, () => ({ path: 'app', namespace: 'fixture' }));
        b.onResolve({ filter: /contexts\/useRecoverableQuery$/ }, () => ({
          path: 'staff',
          namespace: 'fixture',
        }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          resolveDir: process.cwd(),
          loader: 'js',
          contents:
            path === 'app'
              ? `export const App=()=>null;export const Turntable=()=>null;export const setProducts=()=>{};`
              : path === 'staff'
                ? `const rows=[];export const useRecoverableQuery=()=>({status:'ready',data:rows,retry:()=>{}});`
                : `import{getFunctionName}from'convex/server';const rows=[];export const useConvexAuth=()=>({isLoading:false,isAuthenticated:window.me.signedIn});export const useQuery=(ref)=>getFunctionName(ref)==='holm:me'?window.me:rows;export const usePaginatedQuery=()=>{window.catalogQueries++;return{results:rows,status:'Exhausted',loadMore:()=>{}}};export const useMutation=()=>()=>{window.writes++;throw Error('Forbidden fixture write')};`,
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
      ? app.outputFiles[0].text
      : `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Staff entry fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="holm-shell">Startup</div><div id="root"></div><script>window.me={signedIn:false,admin:false};window.catalogQueries=0;window.writes=0;</script><script src="/app.js"></script></body></html>`
  );
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await puppeteer.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox'],
});
const results = [];
await mkdir('artifacts/lighthouse/staff-entry', { recursive: true });
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
    await page.goto(origin + '/#admin', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Team only');
    assert.equal(await page.evaluate(() => window.catalogQueries), 0);
    await page.evaluate(() => {
      window.me = { signedIn: true, admin: true, email: 'staff@example.test' };
      window.render();
    });
    await page.waitForFunction(
      () => document.querySelector('h1')?.textContent === 'House management'
    );
    assert.equal(await page.evaluate(() => window.catalogQueries), 0);
    await page.addScriptTag({ content: axe.source });
    assert.deepEqual(
      (await page.evaluate(() => window.axe.run())).violations.map((v) => v.id),
      []
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true
    );
    await page.screenshot({
      path: `artifacts/lighthouse/staff-entry/staff-${width}.png`,
      fullPage: true,
    });
    await page.evaluate(() => {
      window.me = { signedIn: true, admin: false, email: 'staff@example.test' };
      window.render();
    });
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Team only');
    assert.equal(await page.$('.house-staff'), null);
    await page.click('a[href="#home"]');
    await page.waitForFunction(() => document.body.innerText.includes('No products are available'));
    assert.ok((await page.evaluate(() => window.catalogQueries)) > 0);
    assert.equal(await page.evaluate(() => window.writes), 0);
    assert.deepEqual(errors, []);
    results.push({
      width,
      height,
      staffIndependentOfCatalog: true,
      anonymousDenied: true,
      roleLoss: true,
      catalogRecovery: true,
      axeViolations: 0,
      writes: 0,
    });
    await page.close();
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
await writeFile(
  'artifacts/lighthouse/staff-entry/results.json',
  JSON.stringify(
    {
      scope:
        'Real LiveShell and staff entry with isolated read-only account/catalog transport; no production authentication or mutations.',
      results,
    },
    null,
    2
  )
);
console.log(JSON.stringify(results));
