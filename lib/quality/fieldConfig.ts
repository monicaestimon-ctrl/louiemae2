/** Public deployment configuration only; no cookies, identifiers or automatic retries. */
export function qualityEndpoint(deployment: string): string | null {
  try {
    const u = new URL(deployment);
    if (
      u.protocol !== 'https:' ||
      !/^[a-z0-9-]+\.convex\.cloud$/.test(u.hostname) ||
      u.port ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== '/'
    )
      return null;
    return `https://${u.hostname.replace(/\.cloud$/, '.site')}/quality`;
  } catch {
    return null;
  }
}
export async function fieldEnabled(
  endpoint: string,
  request: typeof fetch = fetch
): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (
    u.protocol !== 'https:' ||
    !/^[a-z0-9-]+\.convex\.site$/.test(u.hostname) ||
    u.port ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== '/quality'
  )
    return false;
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reader: globalThis.ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new Error('Configuration deadline'));
      }, 5000);
    });
    return await Promise.race([
      timeout,
      (async () => {
        const response = await request(`${endpoint}/config`, {
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
          mode: 'cors',
          signal: abort.signal,
        });
        if (abort.signal.aborted) {
          if (response.body) void response.body.cancel().catch(() => {});
          return false;
        }
        if (
          !response.ok ||
          !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '') ||
          !response.body
        )
          return false;
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        while (!abort.signal.aborted) {
          const result = await reader.read();
          if (result.done) break;
          length += result.value.byteLength;
          if (length > 128) return false;
          chunks.push(result.value);
        }
        if (abort.signal.aborted) return false;
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const value: unknown = JSON.parse(new globalThis.TextDecoder('utf-8', { fatal: true }).decode(bytes));
        return (
          !!value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          Object.keys(value).length === 1 &&
          Object.hasOwn(value, 'enabled') &&
          (value as { enabled?: unknown }).enabled === true
        );
      })(),
    ]);
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    abort.abort();
    if (reader) void reader.cancel().catch(() => {});
  }
}
