// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createFieldTransport } from './fieldTransport';
const batch = {
  version: 1 as const,
  documentToken: 'a'.repeat(32),
  release: 'b'.repeat(40),
  route: 'retail-home' as const,
  device: 'mobile' as const,
  samples: [{ name: 'LCP' as const, value: 2100, revision: 1 }],
};
const endpoint = 'https://test.convex.site/quality';
it('sends only with consent and explicitly omits credentials and referrer', async () => {
  let allowed = false;
  const request = vi.fn(async () => new Response(null, { status: 204 }));
  const sender = createFieldTransport(endpoint, () => allowed, request);
  expect(await sender.send(batch)).toBe('skipped');
  expect(request).not.toHaveBeenCalled();
  allowed = true;
  expect(await sender.send(batch)).toBe('sent');
  expect(request).toHaveBeenCalledWith(
    endpoint,
    expect.objectContaining({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      keepalive: true,
      mode: 'cors',
    })
  );
  expect(await sender.send(batch)).toBe('skipped');
  expect(request).toHaveBeenCalledTimes(1);
});
it('aborts in-flight delivery and does not revive the revoked visit', async () => {
  let options: RequestInit | undefined;
  let finish: ((r: Response) => void) | undefined;
  const request = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
    options = init;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  const sender = createFieldTransport(endpoint, () => true, request);
  const promise = sender.send(batch);
  expect(await sender.send(batch)).toBe('skipped');
  sender.revoke();
  expect(options?.signal?.aborted).toBe(true);
  finish!(new Response(null, { status: 204 }));
  expect(await promise).toBe('failed');
  expect(await sender.send(batch)).toBe('skipped');
});
it('bounds failed attempts without scheduling retries', async () => {
  const request = vi.fn(async () => new Response(null, { status: 503 }));
  const sender = createFieldTransport(endpoint, () => true, request);
  for (let i = 0; i < 10; i++) expect(await sender.send(batch)).toBe('failed');
  expect(await sender.send(batch)).toBe('skipped');
  expect(request).toHaveBeenCalledTimes(10);
});
it('rejects private additions and untrusted endpoint shapes', async () => {
  const request = vi.fn(async () => new Response(null, { status: 204 }));
  const sender = createFieldTransport(endpoint, () => true, request);
  expect(await sender.send({ ...batch, email: 'private' } as typeof batch)).toBe('skipped');
  expect(request).not.toHaveBeenCalled();
  for (const url of [
    'http://test.convex.site/quality',
    'https://test.convex.site.evil/quality',
    'https://test.convex.site/quality?token=private',
    'https://user@test.convex.site/quality',
  ])
    expect(() => createFieldTransport(url, () => true, request)).toThrow();
});

it('times out a stalled request without automatic retries or stranding the pending batch', async () => {
  vi.useFakeTimers();
  try {
    const request = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const sender = createFieldTransport(endpoint, () => true, request);
    const sending = sender.send(batch);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await sending).toBe('failed');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    request.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await sender.send(batch)).toBe('sent');
    expect(request).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
