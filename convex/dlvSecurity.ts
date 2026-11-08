import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { viewer } from './holmAccess';
import { CommerceError } from '../lib/errors';
import { stableStringify } from '../lib/zuoImport';

export async function digest(value: unknown): Promise<string> {
  const bytes = new globalThis.TextEncoder().encode(stableStringify(value));
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
}
export function capability() {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
}
export async function authorizeEstimate(
  ctx: QueryCtx | MutationCtx,
  estimate: Doc<'dlvEstimates'>,
  token?: string
) {
  const me = await viewer(ctx);
  if (estimate.userId) {
    if (me?.userId !== estimate.userId) throw new CommerceError('FORBIDDEN');
  } else if (
    !token ||
    !/^[a-f0-9]{64}$/.test(token) ||
    !estimate.guestCapabilityHash ||
    (await digest(token)) !== estimate.guestCapabilityHash
  ) {
    throw new CommerceError('FORBIDDEN');
  }
  return me;
}
