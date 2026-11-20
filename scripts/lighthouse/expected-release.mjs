import assert from 'node:assert/strict';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export async function expectedRelease({ repository, commit, token, request = globalThis.fetch }) {
  if (commit) {
    assert.match(commit, /^[a-f0-9]{40}$/);
    return { commit, source: 'explicit verified release input' };
  }
  assert.match(repository ?? '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.ok(token, 'GitHub deployment-read token is required');
  const get = async (path) => {
    const r = await request('https://api.github.com' + path, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
      signal: globalThis.AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (!r.ok) throw Error('Production deployment record unavailable');
    return r.json();
  };
  const records = await get(`/repos/${repository}/deployments?environment=Production&per_page=20`);
  assert.ok(Array.isArray(records));
  const candidates = await Promise.all(
    records
      .filter(
        (d) =>
          d.environment === 'Production' &&
          Number.isSafeInteger(d.id) &&
          /^[a-f0-9]{40}$/.test(d.sha)
      )
      .map(async (d) => {
        const statuses = await get(`/repos/${repository}/deployments/${d.id}/statuses?per_page=1`);
        assert.ok(Array.isArray(statuses));
        const s = statuses[0];
        return s?.state === 'success' && Number.isFinite(Date.parse(s.created_at))
          ? {
              commit: d.sha,
              deploymentId: d.id,
              promotedAt: s.created_at,
              source: 'GitHub Production deployment status',
            }
          : null;
      })
  );
  const active = candidates
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.promotedAt) - Date.parse(a.promotedAt));
  assert.ok(
    active.length,
    'No successful active Production record in the most recent 20 deployments; supply a verified explicit release'
  );
  return active[0];
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await mkdir('artifacts/lighthouse', { recursive: true });
  let evidence;
  try {
    evidence = await expectedRelease({
      repository: process.env.GITHUB_REPOSITORY,
      commit: process.env.EXPECTED_DEPLOYMENT_COMMIT,
      token: process.env.GH_TOKEN,
    });
    assert.ok(process.env.GITHUB_ENV);
    await appendFile(process.env.GITHUB_ENV, `AUDIT_DEPLOYMENT_COMMIT=${evidence.commit}\n`);
  } catch {
    evidence = {
      error: 'Expected production release could not be resolved from independent records',
    };
    process.exitCode = 1;
  }
  await writeFile('artifacts/lighthouse/expected-release.json', JSON.stringify(evidence, null, 2));
}
