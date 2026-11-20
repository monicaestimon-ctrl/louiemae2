/** Verify the actual public build before and after auditing, not just an input label. */
export async function verifyDeployment(origin, expectedCommit, request = globalThis.fetch) {
  if (!/^[a-f0-9]{40}$/.test(expectedCommit ?? '')) throw new Error('Supply the full expected production commit');
  const response = await request(new globalThis.URL('/build-info.json', origin), {
    cache: 'no-store', redirect: 'error', signal: globalThis.AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Build identity request failed: ${response.status}`);
  const identity = await response.json();
  if (identity.schemaVersion !== 1 || identity.commit !== expectedCommit) throw new Error('Production changed or does not match the expected commit');
  return { commit: identity.commit, checkedAt: new Date().toISOString() };
}
