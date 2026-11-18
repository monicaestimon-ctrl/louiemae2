/* global window, document, Event, MouseEvent */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

await mkdir('artifacts/lighthouse', { recursive: true });
const results = [];
const browser = await puppeteer.launch({
  headless: true,
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: 'chrome' }),
});
try {
  for (const entry of ['retail', 'trade']) {
    const bundled = await build({
      entryPoints: [entry === 'retail' ? 'index.tsx' : 'trade/main.tsx'],
      bundle: true,
      write: false,
      format: 'iife',
      plugins: [
        {
          name: 'fixture-boundaries',
          setup(b) {
            b.onResolve({ filter: /visibleStartup$/ }, () => ({
              path: 'startup',
              namespace: 'fixture',
            }));
            b.onResolve({ filter: /privateIndexing$/ }, () => ({
              path: path.resolve('lib/privateIndexing.ts'),
            }));
            b.onResolve({ filter: /moduleRecovery$/ }, () => ({
              path: path.resolve('lib/moduleRecovery.ts'),
            }));
            b.onResolve({ filter: /\.css$/ }, () => ({ path: 'css', namespace: 'fixture' }));
            b.onResolve({ filter: /\/boot$/ }, () => ({ path: 'boot', namespace: 'fixture' }));
            b.onLoad({ filter: /.*/, namespace: 'fixture' }, (a) => ({
              contents:
                a.path === 'startup'
                  ? `import{startAfterVisibleContent as actual}from'./lib/visibleStartup.ts';export const startAfterVisibleContent=(start,...args)=>actual(()=>{window.fixtureStarts=(window.fixtureStarts||0)+1;start()},...args);`
                  : a.path === 'boot'
                    ? 'window.fixtureBoots=(window.fixtureBoots||0)+1;if(window.fixtureFail)throw Error("Synthetic boot failure");'
                    : '',
              loader: 'js',
              resolveDir: process.cwd(),
            }));
          },
        },
      ],
    });
    for (const mode of [
      'paint',
      'private-route',
      'pointerdown',
      'keydown',
      'click',
      'hashchange',
      'popstate',
      'timeout',
      'unsupported',
      'unsupported-paint',
      'blank',
      'failure',
      'native-paint',
      'observe-failure',
      'hidden',
    ]) {
      const page = await browser.newPage();
      await page.setContent(
        `<main ${mode === 'blank' ? '' : `id="${entry === 'trade' ? 'holm-shell' : 'lm-page-document'}"`}>Visible server content<button><span>Open tray</span></button></main><div id="root"></div>`
      );
      if (mode === 'private-route') {
        await page.evaluate(
          () =>
            new Promise((resolve) => {
              window.addEventListener('hashchange', () => resolve(), { once: true });
              window.location.hash = '#checkout';
            })
        );
      }
      await page.evaluate((mode) => {
        window.fixtureFail = mode === 'failure';
        window.fixtureDisconnects = 0;
        const schedule = window.setTimeout.bind(window),
          cancel = window.clearTimeout.bind(window);
        const timers = new Map();
        let now = 0,
          next = 1000000;
        window.setTimeout = (callback, delay, ...args) => {
          if (delay !== 1500) return schedule(callback, delay, ...args);
          const id = ++next;
          timers.set(id, { due: now + delay, callback: () => callback(...args) });
          return id;
        };
        window.clearTimeout = (id) => {
          if (!timers.delete(id)) cancel(id);
        };
        window.fixtureAdvance = (elapsed) => {
          now += elapsed;
          for (const [id, timer] of timers)
            if (timer.due <= now) {
              timers.delete(id);
              timer.callback();
            }
        };

        if (mode === 'native-paint') return;
        if (mode === 'hidden')
          Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => 'hidden',
          });
        if (mode === 'unsupported') window.PerformanceObserver = undefined;
        else
          window.PerformanceObserver = class {
            static supportedEntryTypes = mode === 'unsupported-paint' ? ['resource'] : ['paint'];
            constructor(callback) {
              window.fixturePaint = () => callback({ getEntriesByName: () => [{}] });
            }
            observe() {
              if (mode === 'observe-failure') throw Error('Unsupported paint observer');
            }
            disconnect() {
              window.fixtureDisconnects++;
            }
          };
      }, mode);
      await page.addScriptTag({ content: bundled.outputFiles[0].text });
      if (mode === 'private-route') {
        assert.match(await page.$eval('meta[name=robots]', (e) => e.content), /noindex/);
      }
      if (
        ![
          'blank',
          'unsupported',
          'unsupported-paint',
          'native-paint',
          'observe-failure',
          'hidden',
        ].includes(mode)
      ) {
        assert.equal(
          await page.evaluate(() => window.fixtureBoots || 0),
          0,
          `${entry}/${mode} must wait`
        );
        if (mode === 'paint' || mode === 'failure' || mode === 'private-route')
          await page.evaluate(() => window.fixturePaint());
        else if (mode === 'timeout') {
          await page.evaluate(() => window.fixtureAdvance(1499));
          assert.equal(await page.evaluate(() => window.fixtureStarts || 0), 0);
          await page.evaluate(() => window.fixtureAdvance(1));
        } else if (mode === 'click')
          await page.$eval('main button span', (element) =>
            element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
          );
        else await page.evaluate((mode) => window.dispatchEvent(new Event(mode)), mode);
      }
      await page.waitForFunction(() => window.fixtureBoots === 1 && window.fixtureStarts === 1, {
        timeout: 3000,
      });
      if (mode === 'failure') {
        await page.waitForSelector('#startup-error-heading');
        assert.equal(
          await page.$eval('#root h1', (e) => e.textContent),
          'This page could not be loaded'
        );
        assert.equal(
          await page
            .$$(entry === 'trade' ? '#holm-shell' : '#lm-page-document')
            .then((v) => v.length),
          0
        );
      }
      await page.evaluate(() => {
        window.fixtureAdvance(5000);
        window.fixturePaint?.();
        window.dispatchEvent(new Event('pointerdown'));
      });
      assert.equal(await page.evaluate(() => window.fixtureBoots), 1);
      assert.equal(await page.evaluate(() => window.fixtureStarts), 1);
      results.push({ entry, mode, starts: 1, boots: 1, recovery: mode === 'failure' });
      await page.close();
    }
  }
  await writeFile(
    'artifacts/lighthouse/visible-startup-browser.json',
    JSON.stringify(
      {
        scope:
          'Actual retail/HOLM entries and helper/recovery/indexing; synthetic boot boundary, controlled plus native paint; no network or commerce',
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
