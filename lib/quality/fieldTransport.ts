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
    url.port ||
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
      if (controller.signal.aborted) return 'skipped';
      attempts++;
      pending.add(body);
      const delivery = new globalThis.AbortController();
      let rejectDelivery: (reason: Error) => void = () => {};
      const cancellation = new Promise<Response>((_, reject) => {
        rejectDelivery = reject;
      });
      const abort = () => {
        delivery.abort();
        rejectDelivery(new Error('Measurement delivery canceled'));
      };
      const timeout = setTimeout(abort, 5000);
      controller.signal.addEventListener('abort', abort, { once: true });
      try {
        const response = await Promise.race([
          request(url.href, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            mode: 'cors',
            keepalive: true,
            signal: delivery.signal,
          }),
          cancellation,
        ]);
        if (!response.ok || revoked) return 'failed';
        delivered.add(body);
        return 'sent';
      } catch {
        return 'failed';
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener('abort', abort);
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
