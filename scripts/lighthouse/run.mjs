import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { URL } from 'node:url';
import { execFileSync } from 'node:child_process';
import lighthouse, { desktopConfig } from 'lighthouse';
import { launch } from 'chrome-launcher';
import puppeteer from 'puppeteer-core';
import { assessRun, assessBatch } from './policy.mjs';

// Public read-only navigation only. No login, cart mutation or payment action.
const base = new URL(process.env.AUDIT_BASE_URL || 'https://www.louiemae.com');
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
  throw new Error('Use a plain HTTP(S) origin without credentials, path, query or hash');
}
if (!process.env.CHROME_PATH || !process.env.AUDIT_CHROME_VERSION) {
  throw new Error('Set CHROME_PATH and the exact AUDIT_CHROME_VERSION to pin the browser');
}
const registry = JSON.parse(await readFile(new URL('../../docs/quality/routes.json', import.meta.url), 'utf8'));
const runCount = Number(process.env.AUDIT_RUNS || 5);
if (![1, 5].includes(runCount)) throw new Error('AUDIT_RUNS must be 1 (diagnostic) or 5 (release)');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const directory = resolve('artifacts/lighthouse', stamp);
await mkdir(directory, { recursive: true });
const results = [];
const profileRoot = resolve('tmp/lighthouse-profiles');
await mkdir(profileRoot, { recursive: true });
const manifest = { scope: registry.scope, pendingCoverage: registry.pendingCoverage,
  baseUrl: base.origin, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  deploymentCommit: process.env.AUDIT_DEPLOYMENT_COMMIT || null,
  node: process.version, platform: process.platform, startedAt: stamp, batches: results };
let failed = false;
for (const route of registry.routes) {
  for (const device of ['mobile', 'desktop']) {
    const runs = [];
    for (let index = 1; index <= runCount; index++) {
      const name = `${route.id}-${device}-${index}`;
      const url = new URL(route.path, base.origin).href;
      let chrome, browser, profile;
      try {
        profile = await mkdtemp(resolve(profileRoot, 'run-'));
        chrome = await launch({ chromePath: process.env.CHROME_PATH, userDataDir: profile,
          chromeFlags: ['--headless=new', '--disable-extensions'] });
        browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}`, defaultViewport: null });
        const browserVersion = (await browser.version()).split('/').at(-1);
        if (browserVersion !== process.env.AUDIT_CHROME_VERSION) throw new Error(`Browser version mismatch: ${browserVersion}`);
        const page = await browser.newPage();
        const result = await lighthouse(url, { port: chrome.port, output: ['json', 'html'],
          logLevel: 'error', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
          }, device === 'desktop' ? desktopConfig : undefined, page);
        if (!result) throw new Error('Lighthouse returned no report');
        await writeFile(resolve(directory, `${name}.json`), result.report[0]);
        await writeFile(resolve(directory, `${name}.html`), result.report[1]);
        // Inspect the actual audited tab, not a second successful navigation.
        const body = await page.$eval('body', element => element.innerText);
        const markers = await page.$$(route.readySelector);
        const markerVisible = markers.length === 1 && await markers[0].isVisible();
        const health = { url: page.url(), browserVersion, checkedAt: new Date().toISOString(),
          ok: markerVisible && body.includes(route.requiredText)
            && !/Something went wrong|temporarily unavailable|Opening House of Louie Mae|restocked\. Please/i.test(body) };
        await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage: false });
        await writeFile(resolve(directory, `${name}.health.json`), JSON.stringify(health, null, 2));
        runs.push(assessRun(result.lhr, health, { url, device }));
      } catch (error) {
        runs.push({ valid: false, errors: [String(error.message || error)], scores: {} });
      } finally {
        if (browser) await browser.close().catch(() => {});
        if (chrome) { try { await chrome.kill(); } catch (error) { console.error('Chrome cleanup:', error.message); } }
        // Delete only the newly created profile inside this workspace's dedicated root.
        if (profile && resolve(profile).startsWith(profileRoot + (process.platform === 'win32' ? '\\' : '/'))) {
          try { await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
          catch (error) { console.error('Temporary profile cleanup:', error.message); }
        }
      }
      await writeFile(resolve(directory, `${name}.assessment.json`), JSON.stringify(runs.at(-1), null, 2));
    }
    const assessment = assessBatch(runs);
    if (!assessment.passed) failed = true;
    results.push({ route: route.id, device, ...assessment });
    await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`${route.id} ${device}: ${assessment.passed ? 'PASS' : 'FAIL'} ${assessment.errors.join('; ')}`);
  }
}
console.log(`Reports: ${directory}. Scope: ${registry.scope}`);
if (failed) process.exitCode = 1;
