// v2 program terms (spec S37, v2 §26), written from the approved configuration so the terms say
// exactly what the code does. There are no placeholders: until the operator details (D-14) and
// the policies the terms describe are approved, `programTerms` returns the list of what is
// missing and the site keeps showing the current terms.
import type { AttributionPolicy, CommissionSchedule, CreditPolicy, OperatorDetails, PayoutSchedule, TierPolicy } from './config';

export type TermsInputs = {
  operator: OperatorDetails | null;
  schedule: CommissionSchedule | null;
  tier: TierPolicy | null;
  attribution: AttributionPolicy | null;
  payout: PayoutSchedule | null;
  credit: CreditPolicy | null;
  clearingDays: number | null;
};

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;
const usd = (minor: number) => `$${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: minor % 100 ? 2 : 0 })}`;

export type TermsSection = { title: string; items: string[] };

export function programTerms(i: TermsInputs): { ready: true; sections: TermsSection[] } | { ready: false; missing: string[] } {
  const missing = Object.entries(i)
    .filter(([, v]) => v === null)
    .map(([k]) => k);
  if (missing.length) return { ready: false, missing };
  const op = i.operator!;
  const s = i.schedule!;
  const t = i.tier!;
  const a = i.attribution!;
  const p = i.payout!;
  const c = i.credit!;
  const days = Math.round(a.windowMs / 86_400_000);
  const tiers = s.tiers.map((x, n) => {
    const next = s.tiers[n + 1];
    return `${x.key[0].toUpperCase()}${x.key.slice(1)} (${usd(x.minMinor)}${next ? ` to ${usd(next.minMinor - 1)}` : ' and up'} in eligible sales): furniture ${pct(x.rates.furniture)}, home décor and lighting ${pct(x.rates.decor)}, clothing ${pct(x.rates.clothing)}`;
  });
  return {
    ready: true,
    sections: [
      { title: 'Who we are', items: [`These terms are offered by ${op.legalName}. Support: ${op.supportEmail}, ${op.supportAddress}. Governing law: ${op.jurisdiction}. Effective ${op.effectiveDate}. Privacy notice: ${op.privacyUrl}.`] },
      {
        title: 'Two programs, one account',
        items: [
          'The Creator Program is open to anyone; no business or follower minimum is needed. The House of Louie Mae Trade Program is for verified businesses and gives trade pricing on approved trade purchases.',
          'Both programs share these retail-referral terms, one login, one payout identity and one tier. A trade account turns on referrals separately; it never needs a second account.',
          'A business account is owned by its owner seat. Purchasing members and read-only collaborators are added by the owner. Ownership changes go through our team.',
          'You accept a specific version of these terms; we ask again when they change.',
        ],
      },
      { title: 'Rates', items: [...tiers, `Some pieces have their own visible, dated commission schedule, shown in the link builder before you share. No other cap applies.`] },
      {
        title: 'Tiers',
        items: [
          `Your tier is based on eligible attributed sales over the preceding ${t.windowMonths} calendar months, recomputed after each paid order, refund or dispute and every day at ${t.dailyLocal} ${t.tz.replace('_', ' ')} time.`,
          'The order that takes you over a threshold earns your earlier tier; orders after it earn the new tier.',
          t.downgrade === 'quarterly_one_step' ? 'Moving down is reviewed once a quarter and is at most one tier at a time.' : 'A tier follows your sales up and down.',
          'A later refund or the window moving on changes future rates only; commission already earned keeps its rate.',
        ],
      },
      {
        title: 'What counts',
        items: [
          `An order counts when it is paid on louiemae.com within ${days} days (${days} × 24 hours) of an eligible click on your link. If someone clicked more than one partner's link, the most recent eligible click counts. Visiting the site directly does not replace your click.`,
          'Every eligible piece in that order counts, not only the piece you linked. Each piece qualifies on its own.',
          'The rate shown when the eligible click happened is protected for that window: if rates go down, you keep the higher one; if they go up, you get the higher one.',
          'Trade-priced purchases, orders you place for yourself or your own business, cancelled or fraudulent orders and ineligible pieces earn nothing. A trade member’s independent retail client can count.',
          'Commission is calculated on merchandise actually paid after discounts and store credit, excluding tax, delivery and other charges.',
          'Zuo pieces are not part of general trade or project discounts and have their own trade pricing.',
        ],
      },
      {
        title: 'Clearing, refunds and disputes',
        items: [
          `Commission is pending for ${i.clearingDays} days after payment, then clears.`,
          'A refund reduces commission on the refunded merchandise. A dispute holds it; if the dispute is decided in our favour it comes back once.',
          'If a refund or dispute happens after you were paid, the amount comes off future earnings. We never take money back from your bank account.',
        ],
      },
      {
        title: 'Payouts',
        items: [
          `Cleared commission of ${usd(p.minimumMinor)} or more is sent on the ${p.day}th of each month at ${p.localTime} ${p.tz.replace('_', ' ')} time, for commission cleared by ${p.cutoffLocalTime} on the ${p.cutoffDay}th. Smaller balances carry over.`,
          '“Sent” means transferred to your connected Stripe account. Stripe then pays your bank on its own schedule; weekends and bank holidays can add time, so we cannot promise same-day arrival.',
          'Stripe collects your tax details and bank account. We do not see or store bank details.',
        ],
      },
      {
        title: 'Business referral store credit',
        items: [
          `You earn ${usd(c.awardMinor)} in store credit when a new business you referred is verified and pays at least ${usd(c.qualifyingMinMinor)} of merchandise after discounts and credit (tax and delivery excluded). It becomes available ${c.awardAfterDays} days after payment, unless a refund takes that order below the minimum.`,
          'When a business you referred buys through your link, the store-credit reward applies instead of retail commission for that order; you will not receive both.',
          `Store credit has no cash value, cannot be transferred${c.expires ? '' : ' and does not expire'}. It comes off merchandise only, never delivery or tax. A refund returns the credit-funded share as credit.`,
        ],
      },
      {
        title: 'Disclosure',
        items: [
          'Label every post, Story or video that includes your link, for example “#ad — I earn a commission if you buy through my link”. Put it where people see it before they click.',
          'There are no promised free products and no guaranteed earnings. We do not own the content you create. Gifting and paid usage rights need a separate written agreement.',
        ],
      },
      {
        title: 'Privacy, tracking and your account',
        items: [
          'When someone opens your link we record the click on our servers (a random visitor id, the time and your link), and, where cookie consent allows, store a first-party identifier in their browser. We do not track people across other sites.',
          'Our payment and payout provider is Stripe. Partners never receive customers’ names, emails or addresses.',
          'You can close your account at any time. Earned, cleared commission is still paid under these terms. We keep financial records as long as tax and accounting law requires, and delete or anonymize other personal data.',
        ],
      },
    ],
  };
}
