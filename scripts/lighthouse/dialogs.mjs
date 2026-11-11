/* global document */
import puppeteer from 'puppeteer-core';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('artifacts/lighthouse', { recursive: true });
const fixture = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{Modal}from'./components/Modal';function Example(){const[outer,setOuter]=useState(false);const[inner,setInner]=useState(false);const[trigger,setTrigger]=useState(true);return <><main id="main-content" tabIndex={-1}>Fixture</main>{trigger&&<button id="trigger" onClick={()=>setOuter(true)}>Open</button>}<button id="behind">Behind</button><Modal open={outer} label="Outer" onClose={()=>setOuter(false)}><button id="first">First</button><input aria-label="Fixture field"/><button id="nested" onClick={()=>setInner(true)}>Nested</button><button id="remove" onClick={()=>{setTrigger(false);setOuter(false)}}>Remove trigger and close</button><Modal open={inner} label="Inner" onClose={()=>setInner(false)}><button id="inner-first">Inner first</button><button id="inner-last" onClick={()=>setInner(false)}>Close inner</button></Modal><button id="last" onClick={()=>setOuter(false)}>Close outer</button></Modal></>};createRoot(document.getElementById('root')).render(<Example/>);`;
const bundled = await build({
  stdin: { contents: fixture, resolveDir: process.cwd(), loader: 'tsx' },
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
  await page.setContent(
    '<style>dialog{padding:30px}button{margin:10px}</style><div id="root"></div>'
  );
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  await page.waitForSelector('#trigger');
  await page.evaluate(() => document.body.style.setProperty('overflow', 'auto', 'important'));
  await page.click('#trigger');
  const results = [];
  for (const name of ['Outer', 'Inner']) {
    if (name === 'Inner') await page.click('#nested');
    for (const key of ['Tab', 'Shift+Tab'])
      for (let i = 0; i < 12; i++) {
        if (key === 'Shift+Tab') await page.keyboard.down('Shift');
        await page.keyboard.press('Tab');
        if (key === 'Shift+Tab') await page.keyboard.up('Shift');
        const label = await page.evaluate(() =>
          document.activeElement.closest('dialog')?.getAttribute('aria-label')
        );
        if (label !== name) throw Error(`${key} escaped ${name}: ${label}`);
      }
    const blocked = await page.evaluate(() => {
      document.querySelector('#behind').focus();
      return document.activeElement.id !== 'behind';
    });
    if (!blocked) throw Error('Background was focusable');
    results.push({ dialog: name, tabContainment: true, backgroundInert: true });
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog[aria-label="Inner"]'));
  const inner = await page.evaluate(() => ({
    focus: document.activeElement.id,
    locked: document.body.style.overflow,
    outer: !!document.querySelector('dialog[aria-label="Outer"]'),
  }));
  if (inner.focus !== 'nested' || inner.locked !== 'hidden' || !inner.outer)
    throw Error(JSON.stringify(inner));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement.id === 'trigger');
  await page.click('#trigger');
  await page.click('#remove');
  await page.waitForFunction(() => document.activeElement.id === 'main-content');
  const end = await page.evaluate(() => ({
    focus: document.activeElement.id,
    overflow: document.body.style.overflow,
    priority: document.body.style.getPropertyPriority('overflow'),
    dialogs: document.querySelectorAll('dialog').length,
  }));
  if (end.overflow !== 'auto' || end.priority !== 'important' || end.dialogs !== 0)
    throw Error(JSON.stringify(end));
  const receipt = {
    browser: await browser.version(),
    scope: 'Actual shared Modal in an isolated non-commerce fixture; no financial action',
    results,
    inner,
    end,
  };
  await writeFile(
    'artifacts/lighthouse/shared-modal-browser.json',
    JSON.stringify(receipt, null, 2)
  );
  console.log(JSON.stringify(receipt));
} finally {
  await browser.close();
}
