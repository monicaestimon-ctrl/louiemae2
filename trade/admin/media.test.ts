import { afterEach, expect, it, vi } from 'vitest';
import { uploadBlob } from './media';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('bounds signing and prevents a late signing result from uploading after timeout', async () => {
  vi.useFakeTimers();
  let resolve!: (url: string) => void;
  const signing = new Promise<string>((r) => {
    resolve = r;
  });
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const result = uploadBlob(() => signing, new Blob(['image']));
  const failure = expect(result).rejects.toThrow('Upload timed out');
  await vi.advanceTimersByTimeAsync(30_000);
  await failure;
  resolve('https://upload.example.test');
  await Promise.resolve();
  expect(fetch).not.toHaveBeenCalled();
});

it('bounds response parsing even if a transport ignores cancellation', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
  vi.stubGlobal('fetch', fetch);
  const result = uploadBlob(async () => 'https://upload.example.test', new Blob(['image']));
  const failure = expect(result).rejects.toThrow('Upload timed out');
  await vi.advanceTimersByTimeAsync(30_000);
  await failure;
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
});

it('accepts a validated storage ID and sends neither credentials nor a referrer', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ storageId: 'storage-image' }) });
  vi.stubGlobal('fetch', fetch);
  const blob = new Blob(['image'], { type: 'image/png' });
  await expect(uploadBlob(async () => 'https://upload.example.test', blob)).resolves.toBe(
    'storage-image'
  );
  expect(fetch).toHaveBeenCalledWith(
    'https://upload.example.test',
    expect.objectContaining({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      body: blob,
    })
  );
});

it('rejects malformed success bodies rather than approving a missing asset', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ storageId: 42 }) })
  );
  await expect(uploadBlob(async () => 'https://upload.example.test', new Blob())).rejects.toThrow(
    'Invalid upload response'
  );
});
