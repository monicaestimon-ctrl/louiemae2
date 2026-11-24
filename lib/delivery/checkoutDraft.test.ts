import { expect, it } from 'vitest';
import { checkoutDraftOwner } from './checkoutDraft';
const token = (sub: string, time: number) =>
  'header.' + globalThis.btoa(JSON.stringify({ sub, iat: time })) + '.signature';
it('retains the memory owner across token renewal but changes it for account transitions', () => {
  expect(checkoutDraftOwner(token('user-a', 1))).toBe(checkoutDraftOwner(token('user-a', 2)));
  expect(checkoutDraftOwner(token('user-a', 1))).not.toBe(checkoutDraftOwner(token('user-b', 1)));
  expect(checkoutDraftOwner(null)).not.toBe(checkoutDraftOwner(token('user-a', 1)));
  expect(checkoutDraftOwner('malformed-a')).not.toBe(checkoutDraftOwner('malformed-b'));
});
