export const PRODUCT_NAME_NORMALIZATION_VERSION = 1;
export const PRODUCT_NAME_MIN_LENGTH = 3;
export const PRODUCT_NAME_MAX_LENGTH = 80;

export function normalizeProductName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateProductDisplayName(value: string): string[] {
  const name = value.trim();
  const errors: string[] = [];
  if (name.length < PRODUCT_NAME_MIN_LENGTH) {
    errors.push(`Product names must contain at least ${PRODUCT_NAME_MIN_LENGTH} characters.`);
  }
  if (name.length > PRODUCT_NAME_MAX_LENGTH) {
    errors.push(`Product names must contain no more than ${PRODUCT_NAME_MAX_LENGTH} characters.`);
  }
  if (!/[a-z0-9]/i.test(normalizeProductName(name))) {
    errors.push('Product names must contain at least one letter or number.');
  }
  return errors;
}

export function createDraftNameOwnerKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `draft:${globalThis.crypto.randomUUID()}`;
  }
  return `draft:${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function areProductNamesEquivalent(left: string, right: string): boolean {
  return normalizeProductName(left) === normalizeProductName(right);
}
