import { stableStringify } from '../canonicalJson.js';

export type RequestProof = { issuedAt: number; nonce: string; rateKey: string; signature: string };
export type DeliveryOperation = 'estimate' | 'quote';
const bytes = (text: string) => new globalThis.TextEncoder().encode(text);
const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
async function payload(
  operation: DeliveryOperation,
  input: unknown,
  proof: Omit<RequestProof, 'signature'>
) {
  return bytes(
    stableStringify({
      operation,
      ...proof,
      bodyHash: hex(
        await globalThis.crypto.subtle.digest('SHA-256', bytes(stableStringify(input)))
      ),
    })
  );
}
async function key(secret: string) {
  return globalThis.crypto.subtle.importKey(
    'raw',
    bytes(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}
/** Server use only: the shared secret must never enter a client environment or response. */
export async function signRequest(
  secret: string,
  operation: DeliveryOperation,
  input: unknown,
  proof: Omit<RequestProof, 'signature'>
): Promise<RequestProof> {
  return {
    ...proof,
    signature: hex(
      await globalThis.crypto.subtle.sign(
        'HMAC',
        await key(secret),
        await payload(operation, input, proof)
      )
    ),
  };
}
export async function verifyRequest(
  secret: string | undefined,
  operation: DeliveryOperation,
  input: unknown,
  proof: RequestProof | undefined,
  now: number
) {
  if (
    !secret ||
    !/^[a-f0-9]{64}$/.test(secret) ||
    !proof ||
    !Number.isSafeInteger(proof.issuedAt) ||
    proof.issuedAt > now + 5000 ||
    proof.issuedAt < now - 60000 ||
    !/^[a-f0-9]{48}$/.test(proof.nonce) ||
    !/^[a-f0-9]{64}$/.test(proof.rateKey) ||
    !/^[a-f0-9]{64}$/.test(proof.signature)
  )
    return false;
  const { signature, ...unsigned } = proof;
  const signatureBytes = new Uint8Array(signature.match(/../g)!.map((x) => parseInt(x, 16)));
  return globalThis.crypto.subtle.verify(
    'HMAC',
    await key(secret),
    signatureBytes,
    await payload(operation, input, unsigned)
  );
}
