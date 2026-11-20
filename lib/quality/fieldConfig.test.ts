import { afterEach, expect, it, vi } from 'vitest';
import { qualityEndpoint, fieldEnabled } from './fieldConfig';
afterEach(() => vi.useRealTimers());
const endpoint = 'https://fixture.convex.site/quality';
it('derives only the exact hosted deployment boundary', () => {
  expect(qualityEndpoint('https://fixture.convex.cloud')).toBe(endpoint);
  for (const input of [
    'http://fixture.convex.cloud',
    'https://evil.test',
    'https://fixture.convex.cloud:8443',
    'https://user@fixture.convex.cloud',
    'https://fixture.convex.cloud/path',
    'https://fixture.convex.cloud?secret=x',
    'https://fixture.convex.cloud#private',
  ])
    expect(qualityEndpoint(input)).toBeNull();
});
it('requires the exact enabled response and omits credentials and referrers', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response('{"enabled":true}', { headers: { 'Content-Type': 'application/json' } })
    );
  expect(await fieldEnabled(endpoint, request)).toBe(true);
  expect(request).toHaveBeenCalledWith(
    endpoint + '/config',
    expect.objectContaining({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    })
  );
  for (const body of [
    '{"enabled":false}',
    '{"enabled":true,"extra":1}',
    'true',
    '{"enabled":"true"}',
    'invalid',
    ' '.repeat(129),
  ]) {
    request.mockResolvedValue(
      new Response(body, { headers: { 'Content-Type': 'application/json' } })
    );
    expect(await fieldEnabled(endpoint, request)).toBe(false);
  }
});
it('bounds a stalled fetch and body, including an uncooperative cancellation hook', async () => {
  vi.useFakeTimers();
  const request = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
  const pending = fieldEnabled(endpoint, request);
  await vi.advanceTimersByTimeAsync(5000);
  expect(await pending).toBe(false);
  expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
  request.mockResolvedValue(
    new Response(
      new globalThis.ReadableStream({
        pull: () => new Promise(() => {}),
        cancel: () => new Promise(() => {}),
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  );
  const stream = fieldEnabled(endpoint, request);
  await vi.advanceTimersByTimeAsync(5000);
  expect(await stream).toBe(false);
});
it('never requests an invalid endpoint or accepts failed/non-JSON responses', async () => {
  const request = vi.fn<typeof fetch>();
  expect(await fieldEnabled('https://evil.test/quality', request)).toBe(false);
  expect(request).not.toHaveBeenCalled();
  request.mockResolvedValue(
    new Response('{"enabled":true}', {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  );
  expect(await fieldEnabled(endpoint, request)).toBe(false);
  request.mockResolvedValue(
    new Response('{"enabled":true}', { headers: { 'Content-Type': 'text/html' } })
  );
  expect(await fieldEnabled(endpoint, request)).toBe(false);
});

it('cancels a response arriving after its deadline without reading it', async () => {
  vi.useFakeTimers();
  let resolve!: (response: Response) => void;
  const request = vi.fn<typeof fetch>().mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  const pending = fieldEnabled(endpoint, request);
  await vi.advanceTimersByTimeAsync(5000);
  expect(await pending).toBe(false);
  const cancel = vi.fn();
  resolve(
    new Response(new globalThis.ReadableStream({ cancel }), {
      headers: { 'Content-Type': 'application/json' },
    })
  );
  await vi.advanceTimersByTimeAsync(1);
  expect(cancel).toHaveBeenCalled();
});
