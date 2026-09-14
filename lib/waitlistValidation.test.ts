import { describe, expect, it } from 'vitest';
import { normalizeWaitlistEmail } from './waitlistValidation';
describe('waitlist email validation', () => {
  it('normalizes whitespace and case while retaining plus addressing', () => {
    expect(normalizeWaitlistEmail('  Mae+Launch@Example.COM  ')).toBe('mae+launch@example.com');
  });
  it.each([null, {}, '', 'a', 'a@', 'a@localhost', 'a b@example.com', '.mae@example.com', 'mae..a@example.com', 'x@-example.com', 'x@ex_ample.com', 'a'.repeat(65)+'@example.com'])('rejects malformed input %s', value => {
    expect(normalizeWaitlistEmail(value)).toBeNull();
  });
});
