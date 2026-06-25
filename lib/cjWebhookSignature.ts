const encoder = new globalThis.TextEncoder();
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const bytesToBase64 = (bytes: Uint8Array): string => {
  let encoded = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const byte1 = bytes[index];
    const byte2 = bytes[index + 1];
    const byte3 = bytes[index + 2];
    const hasByte2 = index + 1 < bytes.length;
    const hasByte3 = index + 2 < bytes.length;
    const combined = (byte1 << 16) | ((byte2 ?? 0) << 8) | (byte3 ?? 0);

    encoded += BASE64_ALPHABET[(combined >> 18) & 63];
    encoded += BASE64_ALPHABET[(combined >> 12) & 63];
    encoded += hasByte2 ? BASE64_ALPHABET[(combined >> 6) & 63] : "=";
    encoded += hasByte3 ? BASE64_ALPHABET[combined & 63] : "=";
  }

  return encoded;
};

const constantTimeEqual = (left: string, right: string): boolean => {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
};

export const computeCjWebhookSignature = async (openId: string, rawBody: string): Promise<string> => {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(openId),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  return bytesToBase64(new Uint8Array(signature));
};

export const verifyCjWebhookSignature = async (
  openId: string,
  rawBody: string,
  signature: string
): Promise<boolean> => {
  const expectedSignature = await computeCjWebhookSignature(openId, rawBody);
  return constantTimeEqual(expectedSignature, signature);
};
