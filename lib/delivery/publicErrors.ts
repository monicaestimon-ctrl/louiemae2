import { CommerceError, commerceErrorData } from '../errors';

/** Preserve the actionable code, never internal detail, custom text or provider messages. */
export function publicDeliveryError(error: unknown) {
  const data = commerceErrorData(error);
  if (data && data.code !== 'TEMPORARILY_UNAVAILABLE') return new CommerceError(data.code);
  const existing = /^[a-f0-9]{24}$/.test(data?.requestId ?? '') ? data!.requestId : undefined;
  const requestId =
    existing ??
    Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('');
  // A correlation reference is useful for support. The original error may contain customer or supplier data.
  if (!existing) console.warn('Delivery request failed', requestId);
  return new CommerceError('TEMPORARILY_UNAVAILABLE', undefined, undefined, requestId);
}
export async function customerFacing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw publicDeliveryError(error);
  }
}
