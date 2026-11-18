import { FIELD_MAX_BATCH_BYTES, parseFieldBatch, type FieldBatch } from './fieldPolicy';
/** Best-effort delivery only; never use sendBeacon, cookies, referral state or automatic retries. */
export function createFieldTransport(
  endpoint: string,
  allowed: () => boolean,
  request: typeof fetch = fetch
) {
  const url = new URL(endpoint);
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.convex.site') ||
    url.pathname !== '/quality' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw Error('Invalid quality endpoint');
  const controller = new globalThis.AbortController(),
    pending = new Set<string>(),
    delivered = new Set<string>();
  let attempts = 0,
    revoked = false;
  return {
    async send(batch: FieldBatch): Promise<'sent' | 'skipped' | 'failed'> {
      if (revoked || !allowed() || attempts >= 10 || !parseFieldBatch(batch)) return 'skipped';
      const body = JSON.stringify(batch);
      if (
        new globalThis.TextEncoder().encode(body).byteLength > FIELD_MAX_BATCH_BYTES ||
        pending.has(body) ||
        delivered.has(body)
      )
        return 'skipped';
      attempts++;
      pending.add(body);
      try {
        const response = await request(url.href, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          mode: 'cors',
          keepalive: true,
          signal: controller.signal,
        });
        if (!response.ok || revoked) return 'failed';
        delivered.add(body);
        return 'sent';
      } catch {
        return 'failed';
      } finally {
        pending.delete(body);
      }
    },
    revoke() {
      revoked = true;
      controller.abort();
      pending.clear();
      delivered.clear();
    },
  };
}
