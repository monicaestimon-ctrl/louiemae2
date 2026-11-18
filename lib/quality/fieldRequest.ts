import { FIELD_MAX_BATCH_BYTES, parseFieldBatch, type FieldBatch } from './fieldPolicy';
/** Bound bytes while streaming; Content-Length is an optimization, never the sole size check. */
export async function readFieldRequest(request: Request): Promise<FieldBatch | null> {
  if (
    request.method !== 'POST' ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')
  )
    return null;
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > FIELD_MAX_BATCH_BYTES))
    return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 5000);
  const decoder = new globalThis.TextDecoder('utf-8', { fatal: true });
  let size = 0,
    text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > FIELD_MAX_BATCH_BYTES) {
        void reader.cancel().catch(() => {});
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    if (timedOut) return null;
    text += decoder.decode();
    return parseFieldBatch(JSON.parse(text));
  } catch {
    try {
      void reader.cancel().catch(() => {});
    } catch {
      /* Already failed/cancelled. */
    }
    return null;
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}
