// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { readFieldRequest } from './fieldRequest';
const batch = {
  version: 1,
  documentToken: 'a'.repeat(32),
  release: 'b'.repeat(40),
  route: 'retail-home',
  device: 'mobile',
  samples: [{ name: 'LCP', value: 2100, revision: 1 }],
};
function request(body: string, headers: Record<string, string> = {}) {
  return new Request('https://example.com/api/quality', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}
it('accepts only the allowlisted bounded batch shape', async () => {
  expect(await readFieldRequest(request(JSON.stringify(batch)))).toEqual(batch);
  expect(
    await readFieldRequest(request(JSON.stringify({ ...batch, referrer: 'private' })))
  ).toBeNull();
});
it('rejects methods, media types, malformed JSON and claimed oversized lengths', async () => {
  expect(await readFieldRequest(new Request('https://example.com'))).toBeNull();
  expect(
    await readFieldRequest(request(JSON.stringify(batch), { 'content-type': 'text/plain' }))
  ).toBeNull();
  expect(await readFieldRequest(request('{'))).toBeNull();
  expect(
    await readFieldRequest(request(JSON.stringify(batch), { 'content-length': '3000' }))
  ).toBeNull();
  expect(
    await readFieldRequest(request(JSON.stringify(batch), { 'content-length': 'nonsense' }))
  ).toBeNull();
});
it('enforces actual streamed bytes even when length is missing or underreported', async () => {
  for (const headers of [{}, { 'content-length': '1' }])
    expect(await readFieldRequest(request(' '.repeat(2049), headers))).toBeNull();
});
it('cancels an oversized stream and rejects malformed UTF8', async () => {
  let cancelled = false;
  const body = new globalThis.ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(2049));
    },
    cancel() {
      cancelled = true;
    },
  });
  const r = new Request('https://example.com', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    duplex: 'half',
  } as RequestInit);
  expect(await readFieldRequest(r)).toBeNull();
  expect(cancelled).toBe(true);
  const malformed = new Request('https://example.com', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: new Uint8Array([0xff]),
  });
  expect(await readFieldRequest(malformed)).toBeNull();
});

it('cancels a stalled body within the total read deadline', async () => {
  vi.useFakeTimers();
  try {
    let cancelled = false;
    const body = new globalThis.ReadableStream({
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request('https://example.com', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      duplex: 'half',
    } as RequestInit);
    const reading = readFieldRequest(request);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await reading).toBeNull();
    expect(cancelled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('does not await an underlying cancellation hook after rejecting an oversized body', async () => {
  const body = new globalThis.ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(2049));
    },
    cancel() {
      return new Promise<void>(() => {});
    },
  });
  const request = new Request('https://example.com', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    duplex: 'half',
  } as RequestInit);
  expect(await readFieldRequest(request)).toBeNull();
});
