// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HOLM_PARTNERS, partnerCopy } from '../lib/holmPartners';

const app = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'app.ts'), 'utf8');

describe('Partner program copy', () => {
  it('quotes the real tier range to visitors', () => {
    const c = partnerCopy();
    expect(c.commissionHeadline).toBe(`${HOLM_PARTNERS.tiers.base / 100}%–${HOLM_PARTNERS.tiers.elite / 100}%`);
    expect(c.rateBps).toBe(HOLM_PARTNERS.tiers.base);
    expect(c.rateLabel).toBe('the 10% starting rate');
  });

  it("shows a partner their own rate", () => {
    expect(partnerCopy('active').commissionHeadline).toBe('12%');
    expect(partnerCopy('elite').rateBps).toBe(HOLM_PARTNERS.tiers.elite);
  });

  it('states the referral credit conditions', () => {
    expect(partnerCopy().referralLine).toBe('credit when a business you refer is verified and pays an order of $500 or more');
    expect(partnerCopy().referralHeadline).toBe('$100');
  });

  it('keeps fixed commission numbers out of the trade site', () => {
    expect(app).not.toMatch(/COMMISSION\s*=/);
    expect(app).not.toMatch(/\d+%<\/b>commission/);
    expect(app).not.toMatch(/credit for every referral/i);
    expect(app).not.toMatch(/10% to start, up to 18%/);
  });
});
