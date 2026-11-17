import { expect, it } from 'vitest';
import { quoteAccessFromUrl } from './quoteAccess';
it('requires a quote identity and takes a guest capability only from the fragment', () => {
  expect(
    quoteAccessFromUrl(new URL('https://example.test/?delivery-access=query-only'))
  ).toBeNull();
  expect(
    quoteAccessFromUrl(new URL('https://example.test/?deliveryQuote=&delivery-access=query-only'))
  ).toBeNull();
  expect(
    quoteAccessFromUrl(
      new URL('https://example.test/?deliveryQuote=fixture&delivery-access=query-only')
    )
  ).toEqual({ id: 'fixture' });
  expect(
    quoteAccessFromUrl(
      new URL('https://example.test/?deliveryQuote=fixture#delivery-access=fragment-token')
    )
  ).toEqual({ id: 'fixture', guestCapability: 'fragment-token' });
});
