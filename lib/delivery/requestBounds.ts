import { CommerceError } from '../errors.js';
import type { AddressIn } from './destination';

export const DELIVERY_BODY_BYTES = 65536;
type Input = {
  lines?: readonly { productId: string; variantId: string; packs: number }[];
  address?: AddressIn;
  zip?: string;
  postalCode?: string;
  visitorKey?: string;
  service?: string;
  email?: string;
};
const bounded = (value: string | undefined, max: number) =>
  value === undefined || value.length <= max;
/** Enforce before hashing, database work, carton expansion or provider calls. Never truncate items. */
export function assertDeliveryBounds(input: Input, maxLines = 30) {
  let serialized: string;
  try {
    serialized = JSON.stringify(input, (_key, value: unknown) => {
      if (
        typeof value === 'bigint' ||
        value instanceof globalThis.ArrayBuffer ||
        globalThis.ArrayBuffer.isView(value)
      )
        throw new CommerceError('INVALID_INPUT');
      return value;
    });
  } catch {
    throw new CommerceError('INVALID_INPUT');
  }
  if (
    new globalThis.TextEncoder().encode(serialized).byteLength > DELIVERY_BODY_BYTES ||
    !bounded(input.zip, 10) ||
    !bounded(input.postalCode, 10) ||
    !bounded(input.visitorKey, 200) ||
    !bounded(input.service, 80) ||
    !bounded(input.email, 254)
  )
    throw new CommerceError('INVALID_INPUT');
  if (
    input.lines &&
    (!input.lines.length ||
      input.lines.length > maxLines ||
      input.lines.some(
        (l) =>
          !l.productId ||
          l.productId.length > 200 ||
          !l.variantId ||
          l.variantId.length > 200 ||
          !Number.isSafeInteger(l.packs) ||
          l.packs < 1 ||
          l.packs > 10000
      ))
  )
    throw new CommerceError('INVALID_INPUT');
  const a = input.address;
  if (
    a &&
    (!bounded(a.recipientName, 150) ||
      !bounded(a.phone, 50) ||
      !bounded(a.line1, 200) ||
      !bounded(a.line2, 200) ||
      !bounded(a.city, 100) ||
      !bounded(a.state, 2) ||
      !bounded(a.postalCode, 10) ||
      !bounded(a.country, 2))
  )
    throw new CommerceError('INVALID_INPUT');
}

/** The Content-Length header is only an early check; streamed bytes enforce the real limit. */
export async function readDeliveryJson(request: Request): Promise<unknown> {
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
  )
    throw new CommerceError('INVALID_INPUT');
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > DELIVERY_BODY_BYTES))
    throw new CommerceError('INVALID_INPUT');
  const reader = request.body?.getReader();
  if (!reader) throw new CommerceError('INVALID_INPUT');
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new CommerceError('INVALID_INPUT')), 5000);
  });
  try {
    while (true) {
      const part = await Promise.race([reader.read(), expired]);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > DELIVERY_BODY_BYTES) throw new CommerceError('INVALID_INPUT');
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value: unknown = JSON.parse(
      new globalThis.TextDecoder('utf-8', { fatal: true }).decode(bytes)
    );
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new CommerceError('INVALID_INPUT');
    return value;
  } catch {
    throw new CommerceError('INVALID_INPUT');
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
}
