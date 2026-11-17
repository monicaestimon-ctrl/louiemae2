import type { Id } from '../../convex/_generated/dataModel';
export type QuoteAccess = { id: Id<'dlvQuoteRequests'>; guestCapability?: string };
/** Capture the original private link in memory. Capability tokens are fragment-only. */
export function quoteAccessFromUrl(url: URL): QuoteAccess | null {
  const id = url.searchParams.get('deliveryQuote');
  if (!id) return null;
  const guestCapability = new URLSearchParams(url.hash.slice(1)).get('delivery-access');
  return { id: id as Id<'dlvQuoteRequests'>, ...(guestCapability ? { guestCapability } : {}) };
}
