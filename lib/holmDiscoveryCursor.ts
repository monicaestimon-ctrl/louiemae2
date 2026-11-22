export type DiscoveryCursor = { version: 1; binding: string; group: number; cursor: string | null };
export function encodeDiscoveryCursor(binding: string, group: number, cursor: string | null): string {
  return JSON.stringify({ version: 1, binding, group, cursor });
}
/** A binding is not an authorization token. The server recomputes viewer access
 * and the request/generation binding before validating every supplied cursor. */
export function decodeDiscoveryCursor(value: string | null, binding: string, groups: number): DiscoveryCursor {
  if (value === null) return { version: 1, binding, group: 0, cursor: null };
  if (value.length > 16_000) throw new Error('Invalid catalog cursor.');
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid catalog cursor.');
  const cursor = parsed as Record<string, unknown>;
  if (Object.keys(cursor).sort().join(',') !== 'binding,cursor,group,version' || cursor.version !== 1 || cursor.binding !== binding
    || !Number.isSafeInteger(cursor.group) || (cursor.group as number) < 0 || (cursor.group as number) >= groups
    || (cursor.cursor !== null && (typeof cursor.cursor !== 'string' || cursor.cursor.length > 12_000))) throw new Error('Invalid catalog cursor.');
  return cursor as DiscoveryCursor;
}
