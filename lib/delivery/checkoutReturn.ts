import type { CartItem } from '../../contexts/CartContext';

type Line = { productId: string; variantId: string; packs: number };
type ReturnAccess = { guestCapability?: string; cart?: string; expiresAt: number };
const prefix = 'lm-checkout-return:';
export function cartLines(items: CartItem[]): Line[] {
  return items.map((i) => ({
    productId: i.product.id,
    variantId: i.selectedVariant?.id ?? i.product.variants?.[0]?.id ?? '',
    packs: i.quantity,
  }));
}
export function cartFingerprint(lines: Line[]) {
  return JSON.stringify(
    lines
      .map((l) => [l.productId, l.variantId, l.packs])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  );
}
/** Tab-scoped only; no capability in URLs, analytics or localStorage. Storage denial is safe. */
export function rememberCheckout(sessionId: string, guestCapability?: string, lines?: Line[]) {
  try {
    const value: ReturnAccess = {
      guestCapability,
      ...(lines ? { cart: cartFingerprint(lines) } : {}),
      expiresAt: Date.now() + 90 * 86400000,
    };
    sessionStorage.setItem(prefix + sessionId, JSON.stringify(value));
  } catch {
    /* Confirmation can recover through the authenticated account. Never block payment. */
  }
}
export function checkoutAccess(sessionId: string): ReturnAccess | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(prefix + sessionId) ?? 'null');
    if (!value || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) {
      sessionStorage.removeItem(prefix + sessionId);
      return null;
    }
    return {
      expiresAt: value.expiresAt,
      ...(typeof value.cart === 'string' ? { cart: value.cart } : {}),
      ...(/^[a-f0-9]{64}$/.test(value.guestCapability ?? '')
        ? { guestCapability: value.guestCapability }
        : {}),
    };
  } catch {
    return null;
  }
}
export function consumeCheckoutCart(sessionId: string) {
  try {
    const value = checkoutAccess(sessionId);
    if (value) {
      delete value.cart;
      sessionStorage.setItem(prefix + sessionId, JSON.stringify(value));
    }
  } catch {
    /* No cart access is granted by client storage. */
  }
}
