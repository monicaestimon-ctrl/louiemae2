import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { documentCommit, captureDocuments } from './document-identity.mjs';
import { expectedRelease } from './expected-release.mjs';
const a = 'a'.repeat(40),
  b = 'b'.repeat(40),
  url = 'https://www.louiemae.com/';
const html = (commit) =>
  `<html><head><meta name="lm-build-commit" content="${commit}"></head><body>Ready</body></html>`;
test('served document identity rejects absent, duplicate and substituted releases', () => {
  assert.equal(documentCommit(html(a), a), a);
  for (const text of [
    '',
    html(b),
    html(a).replace('</head>', `<meta name="lm-build-commit" content="${a}"></head>`),
  ])
    assert.throws(() => documentCommit(text, a));
});
function browser() {
  const page = new EventEmitter();
  let current = url;
  const frame = { url: () => current };
  page.mainFrame = () => frame;
  page.url = () => current;
  return {
    page,
    document: (commit, target = url) => {
      current = target;
      page.emit('framenavigated', frame);
      page.emit('response', {
        url: () => target,
        status: () => 200,
        frame: () => frame,
        request: () => ({ isNavigationRequest: () => true }),
        text: async () => html(commit),
      });
    },
    navigate: (target) => {
      current = target;
      page.emit('framenavigated', frame);
    },
  };
}
test('captures transient wrong documents and route changes even after return', async () => {
  for (const mode of ['stable', 'wrong-release', 'route-away', 'missing']) {
    const c = browser(),
      capture = captureDocuments(c.page, url, a);
    if (mode !== 'missing') c.document(a);
    if (mode === 'wrong-release') {
      c.document(b);
      c.document(a);
    }
    if (mode === 'route-away') {
      c.navigate(url + 'other');
      c.navigate(url);
    }
    if (mode === 'stable') assert.equal((await capture.verify()).commit, a);
    else await assert.rejects(capture.verify());
    capture.dispose();
    assert.equal(c.page.listenerCount('response'), 0);
  }
});
test('scheduled identity follows successful deployment records rather than a docs-only HEAD', async () => {
  const responses = [
    [
      { id: 2, sha: b, environment: 'Production' },
      { id: 1, sha: a, environment: 'Production' },
    ],
    [{ state: 'pending', created_at: '2026-11-18T10:00:00Z' }],
    [{ state: 'success', created_at: '2026-11-18T09:00:00Z' }],
  ];
  const request = async () => ({ ok: true, json: async () => responses.shift() });
  const r = await expectedRelease({ repository: 'owner/repo', token: 'fixture', request });
  assert.equal(r.commit, a);
  assert.equal(r.deploymentId, 1);
  assert.equal((await expectedRelease({ commit: b })).commit, b);
  await assert.rejects(expectedRelease({ commit: 'main' }));
  await assert.rejects(
    expectedRelease({
      repository: 'owner/repo',
      token: 'fixture',
      request: async () => ({ ok: true, json: async () => [] }),
    })
  );
});

test('only the Lighthouse runner can exempt its browser-owned bf-cache probe', async () => {
  for (const allowLighthouseReset of [false, true]) {
    const c = browser(),
      capture = captureDocuments(c.page, url, a, { allowLighthouseReset });
    c.document(a);
    c.document(b, 'chrome://terms/');
    c.document(a);
    if (allowLighthouseReset) assert.equal((await capture.verify()).commit, a);
    else await assert.rejects(capture.verify());
    c.navigate(url + 'other');
    c.navigate(url);
    await assert.rejects(capture.verify());
    capture.dispose();
  }
});
