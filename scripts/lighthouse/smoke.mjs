import { captureDocuments } from './document-identity.mjs';
/* global window */
import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
import { verifyDeployment } from './deployment.mjs';
import { captureRouteReadiness, inspectRouteHealth } from './health.mjs';
import { assessSmoke, smokeRoutes, smokeDevices } from './smoke-policy.mjs';

const origin = 'https://www.louiemae.com';
const expectedCommit = process.env.AUDIT_DEPLOYMENT_COMMIT;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const directory = `artifacts/lighthouse/smoke-${stamp}`;
await mkdir(directory, { recursive: true });
const report = {
  expectedCommit,
  startedAt: stamp,
  node: process.version,
  chrome: process.env.AUDIT_CHROME_VERSION,
  scope:
    'Read-only synthetic public availability and axe; not Lighthouse scores, private journey proof or field metrics',
  results: [],
};
let browser;
try {
  report.stage = 'setup';
  assert.match(expectedCommit ?? '', /^[a-f0-9]{40}$/);
  assert.ok(
    process.env.CHROME_PATH && process.env.AUDIT_CHROME_VERSION,
    'Use the pinned browser installer'
  );
  const registry = JSON.parse(await readFile('docs/quality/routes.json', 'utf8'));
  const routes = smokeRoutes.map((id) => {
    const matches = registry.routes.filter((route) => route.id === id);
    assert.equal(matches.length, 1, `Missing or duplicate registered route ${id}`);
    return matches[0];
  });
  report.before = await verifyDeployment(origin, expectedCommit);
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  assert.equal((await browser.version()).split('/').at(-1), process.env.AUDIT_CHROME_VERSION);
  for (const route of routes)
    for (const device of smokeDevices) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      const result = {
        route: route.id,
        device: device.name,
        status: null,
        sameUrl: false,
        healthy: false,
        commands: 0,
        stage: 'opening',
        errors: [],
        axe: [],
      };
      report.results.push(result);
      try {
        await page.setViewport({
          width: device.width,
          height: 900,
          isMobile: device.name === 'mobile',
          hasTouch: device.name === 'mobile',
          deviceScaleFactor: device.name === 'mobile' ? 2 : 1,
        });
        // Store identifiers/messages only; do not retain arbitrary console payloads or customer text.
        page.on('pageerror', () => result.errors.push('page-error'));
        page.on('console', (message) => {
          if (message.type() === 'error') result.errors.push('console-error');
        });
        await page.setRequestInterception(true);
        page.on('request', (request) => {
          const pathname = new URL(request.url()).pathname;
          if (
            /\/api\/(mutation|action)$|\/stripe\/(checkout|create)|\/delivery\/.*(estimate|pay)/.test(
              pathname
            )
          ) {
            result.commands++;
            void request.abort().catch(() => {});
          } else void request.continue().catch(() => {});
        });
        const url = new URL(route.path, origin).href;
        const documents = captureDocuments(page, url, expectedCommit);
        result.stage = 'navigation';
        const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
        result.status = response?.status() ?? null;
        result.sameUrl = page.url() === url;
        result.stage = 'readiness';
        await page.waitForSelector(route.readySelector, { visible: true, timeout: 20000 });
        result.healthy = (
          await inspectRouteHealth(page, route, await captureRouteReadiness(page, route))
        ).ok;
        result.stage = 'accessibility';
        await page.addScriptTag({ content: axe.source });
        result.axe = await page.evaluate(async () =>
          (await window.axe.run()).violations.map((row) => row.id)
        );
        result.stage = 'document-identity';
        result.documentIdentity = await documents.verify();
        const screenshot = await page.screenshot({ fullPage: false });
        result.documentIdentity = await documents.verify();
        result.sameUrl = page.url() === url;
        await writeFile(`${directory}/${route.id}-${device.name}.png`, screenshot);
        result.stage = 'complete';
        documents.dispose();
      } catch {
        result.errors.push('verification-failed');
      } finally {
        await context.close();
      }
      await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
    }
  report.after = await verifyDeployment(origin, expectedCommit);
} catch {
  report.failure = 'Deployment, browser or runner verification failed';
} finally {
  if (browser) await browser.close().catch(() => {});
  report.assessment = assessSmoke(report);
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report.assessment));
if (!report.assessment.passed) process.exitCode = 1;
