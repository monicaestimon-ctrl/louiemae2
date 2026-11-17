import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('./write-build-info.mjs', import.meta.url));
test('release identity accepts verified sources and rejects conflicting or malformed sources', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'louiemae-build-identity-'));
  try {
    await mkdir(join(directory, 'dist'));
    const environment = { ...process.env };
    delete environment.VERCEL_GIT_COMMIT_SHA;
    delete environment.BUILD_SOURCE_COMMIT;
    const commit = 'a'.repeat(40);
    for (const source of [{ VERCEL_GIT_COMMIT_SHA: commit }, { BUILD_SOURCE_COMMIT: commit },
      { VERCEL_GIT_COMMIT_SHA: commit, BUILD_SOURCE_COMMIT: commit }]) {
      const result = spawnSync(process.execPath, [script], { cwd: directory, env: { ...environment, ...source }, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(await readFile(join(directory, 'dist/build-info.json'), 'utf8')), { schemaVersion: 1, commit });
    }
    for (const source of [{ BUILD_SOURCE_COMMIT: 'main' },
      { VERCEL_GIT_COMMIT_SHA: commit, BUILD_SOURCE_COMMIT: 'b'.repeat(40) }]) {
      await rm(join(directory, 'dist/build-info.json'), { force: true });
      const result = spawnSync(process.execPath, [script], { cwd: directory, env: { ...environment, ...source }, encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      await assert.rejects(readFile(join(directory, 'dist/build-info.json')), { code: 'ENOENT' });
    }
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('louiemae-build-identity-'));
    await rm(directory, { recursive: true, force: true });
  }
});
