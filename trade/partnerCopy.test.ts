// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HOLM_PARTNERS, HOLM_RATES, partnerCopy, partnerTerms, rateRows } from '../lib/holmPartners';

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

describe('rates by product type', () => {
  it('quotes every product type to visitors, from the rate table', () => {
    expect(partnerCopy().ratesLine).toBe('Earn 10%–18% on furniture, 8%–12% on home décor and 5%–8% on clothing');
  });
  it("shows a partner their own rates", () => {
    expect(partnerCopy('active').ratesLine).toBe('Your rates (Active): 12% furniture, 9% décor, 6% clothing');
  });
  it('lists the tiers with their sales thresholds', () => {
    const rows = rateRows();
    expect(rows.map((r) => r.sales)).toEqual(['$0–$14,999', '$15,000–$49,999', '$50,000–$99,999', '$100,000+']);
    expect(rows[3].rates.find((r) => r.type === 'decor')!.rate).toBe(`${HOLM_RATES.elite.decor / 100}%`);
  });
});

describe('partner terms', () => {
  const text = partnerTerms().flatMap((s) => s.items).join(' ');
  it('state the rules the program enforces', () => {
    expect(text).toContain(`within ${HOLM_PARTNERS.attributionDays} days`);
    expect(text).toContain(`pending for ${HOLM_PARTNERS.clearingDays} days`);
    expect(text).toContain('40% of our profit');
    expect(text).toContain('furniture 10%–18%, décor 8%–12%, clothing 5%–8%');
    expect(text).toMatch(/do not earn commission/);
    expect(text).toMatch(/#ad/);
    expect(text).toMatch(/1099-NEC/);
  });
  it('are published on /trade and linked from the join checkbox', () => {
    expect(app).toContain("'partner-terms':PartnerTerms");
    expect(app).toContain('href="#partner-terms"');
  });
});
