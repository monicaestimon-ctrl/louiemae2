import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyDeployment } from './deployment.mjs';
import { assessRelease } from './policy.mjs';

const commit = 'a'.repeat(40);
test('verifies the served commit and rejects changed, malformed and unavailable releases', async () => {
  const request = async () => ({ ok: true, json: async () => ({ schemaVersion: 1, commit }) });
  assert.equal((await verifyDeployment('https://www.louiemae.com', commit, request)).commit, commit);
  await assert.rejects(verifyDeployment('https://www.louiemae.com', 'b'.repeat(40), request), /does not match/);
  await assert.rejects(verifyDeployment('https://www.louiemae.com', 'main', request), /full expected/);
  await assert.rejects(verifyDeployment('https://www.louiemae.com', commit, async () => ({ ok: false, status: 503 })), /503/);
});
test('missing post-audit identity cannot become a successful release report', () => {
  const result = assessRelease({ deploymentVerificationRequired: true, deploymentCommit: commit, deploymentBefore: { commit } });
  assert.ok(result.errors.includes('Production identity was not verified before and after the audit'));
});
