// Seed configuration records (spec 02 §6). `approved` only where the v2 specification or an
// earlier owner decision approves the value; everything else is `proposed` and names the
// decision (05 §1) that approves it. Approving happens in the admin decision register.
import type { ConfigSeed } from './index';

export const CONFIG_SEED: ConfigSeed[] = [
  {kind:'deliveryControls',key:'delivery-controls',version:1,status:'proposed',value:{automaticEnabled:false,suppliers:['zuo'],origins:['95206'],services:['curbside'],zip3Allowlist:[],blockedZip5:[]},note:'Approve only verified pilot lanes. An empty allowlist disables automatic freight; quotes and paid-order fulfillment remain available.',decision:'D-03/D-08'},
  { kind: 'marginPolicy', key: 'zuo-standard-20', version: 1, status: 'approved', value: { targetBps: 2000 }, note: 'Default Zuo model: 20% contribution after modeled variable expenses, commission and allocated overhead (v2 §7).' },
  { kind: 'marginPolicy', key: 'zuo-approved-5', version: 1, status: 'approved', value: { targetBps: 500, cohort: 'approved_306', expandable: false }, note: 'The approved 306-product 5% exception. Never extended automatically (v2 §1, §7).' },
  { kind: 'marginPolicy', key: 'zuo-legacy-18', version: 1, status: 'approved', value: { targetBps: 1800, requiresDocumentRef: true }, note: 'Only for a SKU with a documented 18% exception (v2 §7).' },
  { kind: 'marginPolicy', key: 'zuo-map-floor-pending', version: 1, status: 'approved', value: { blocksAutomaticSale: true }, note: 'The 135 MAP-based candidates: automatic sale held until a per-SKU floor is approved (v2 §7, §26).', decision: 'D-01' },
  {
    kind: 'pricingAssumptions', key: 'zuo-pricing-assumptions', version: 1, status: 'approved',
    value: { supplierPaymentReserveBps: 300, handlingPerPieceMinor: 1000, processingBps: 300, returnsBps: 200, overheadBps: 500, allowanceBySize: { SMALL: 1500, MEDIUM: 2500, LARGE: 4000, OVERSIZE: 6000, LTL: 10000 } },
    note: 'Provisional assumptions from v2 §7. Finance replaces them with observed values; UNKNOWN size has no inferred allowance.', decision: 'D-03',
  },
  { kind: 'roundingPolicy', key: 'rounding-pack-up-cents', version: 1, status: 'approved', value: { unit: 'pack', mode: 'ceil', toMinor: 1 }, note: 'Sellable-pack prices rounded up to the cent (v2 §7).' },
  { kind: 'freshnessPolicy', key: 'freshness-default', version: 1, status: 'proposed', value: { stockSyncMaxHours: 24, checkoutSourceMaxHours: 24, costMapMaxDays: 7, recheckOnSupplierNotice: true }, note: 'v2 §6 proposed freshness defaults.', decision: 'D-16' },
  {
    kind: 'deliveryLadder', key: 'delivery-ladder', version: 1, status: 'proposed',
    value: { tiersMinor: [4999, 5999, 6999, 7999, 8999, 9999, 10999, 11999, 12999, 13999, 14999, 15999, 16999, 17999, 18999, 19999], quoteAboveMinor: 19999, minimumMinor: 4999, deliveryProcessingBps: 300 },
    note: 'Customer ladder from v2 §9 (approved); the 3% delivery processing rate is proposed (v2 §11 illustration).', decision: 'D-03',
  },
  { kind: 'deliveryRule', key: 'ashcroft-launch', version: 1, status: 'approved', value: { engine: 'ashcroft_per_item', source: 'lib/retailLaunch.ts retailDelivery()' }, note: 'Existing Ashcroft per-item delivery, unchanged (v2 §1).' },
  { kind: 'deliveryRule', key: 'house-flat', version: 1, status: 'approved', value: { engine: 'house_flat', source: 'lib/holmDelivery.ts DELIVERY_TIERS' }, note: 'Existing House flat delivery, unchanged (v2 §1).' },
  {
    kind: 'deliveryRule', key: 'zuo-95206-curbside', version: 1, status: 'proposed',
    value: { engine: 'zuo_ladder', originZip: '95206', supplierOrderFeeMinor: 1000, supplierFeeScope: 'order', service: 'curbside', quoteOnly: ['AK', 'HI', 'PO_BOX', 'APO_FPO', 'territories', 'islands', 'remote', 'restricted'], truckload: 'quote_only' },
    note: 'v2 §9–§10 proposed initial standard service.', decision: 'D-08',
  },
  { kind: 'deliveryRule', key: 'mixed-zuo-ashcroft', version: 1, status: 'proposed', value: { engine: 'sum_groups', display: 'single_line_with_groups' }, note: 'Mixed Zuo + Ashcroft carts: Ashcroft per-item charge plus the Zuo ladder charge.', decision: 'D-12' },
  {
    kind: 'carrierRule', key: 'zuo-freight', version: 1, status: 'proposed',
    value: {
      rule: { carrier: 'to be contracted', service: 'ground', effectiveFrom: 0, dimDivisorMm3PerG: 5_021, ground: { maxLongestMm: 2_743, maxLengthPlusGirthMm: 4_191, maxWeightG: 68_039 }, ltl: { maxLongestMm: 3_658, maxWeightG: 907_185, maxCartons: 20 } },
      originZip: '95206', supplierOrderFeeMinor: 1000, supplierFeeScope: 'order',
      zip3Zones: {},
      groundPerKgMinorByZone: {},
      groundMinimumMinor: 0,
      ltlPerKgMinorByZone: {},
      ltlMinimumMinor: 0,
      residentialMinor: 0,
      liftgateMinor: 0,
      uncertaintyBps: 1_000,
      taxBpsByState: {},
    },
    note: 'Calibrated, dated ZIP-zone and carton freight matrix from the carrier contract (v2 §10). Zones and rates are empty until carrier evidence is entered, so every Zuo delivery is quote-required until then.',
    decision: 'D-03/D-08',
  },
  { kind: 'estimatePolicy', key: 'estimate-policy', version: 1, status: 'proposed', value: { validityMinutes: 30, zipNonbinding: true }, note: 'v2 §12 proposed estimate validity.', decision: 'D-16' },
  {
    kind: 'commissionSchedule', key: 'commission-schedule', version: 2, status: 'approved',
    value: {
      ceilingBps: 2300,
      tiers: [
        { key: 'base', minMinor: 0, rates: { furniture: 1000, decor: 800, clothing: 500 } },
        { key: 'active', minMinor: 1_500_000, rates: { furniture: 1200, decor: 900, clothing: 600 } },
        { key: 'top', minMinor: 5_000_000, rates: { furniture: 1500, decor: 1000, clothing: 700 } },
        { key: 'elite', minMinor: 10_000_000, rates: { furniture: 1800, decor: 1200, clothing: 800 } },
      ],
    },
    note: 'Commission schedule (Nov 3 owner decision and v2 §15). Décor includes all lighting.',
  },
  {
    kind: 'tierPolicy', key: 'tier-policy', version: 2, status: 'proposed',
    value: { recompute: ['paid', 'refund', 'dispute', 'daily'], dailyLocal: '00:15', tz: 'America/Chicago', windowMonths: 12, windowShape: 'calendar_months', crossingEarns: 'pre_purchase', downgrade: 'quarterly_one_step' },
    note: 'v2 §15 timing. Downgrade keeps the Nov 3 owner rule (quarterly, one tier) until D-07 decides.', decision: 'D-06/D-07',
  },
  { kind: 'attributionPolicy', key: 'attribution', version: 2, status: 'proposed', value: { windowMs: 2_592_000_000, lastClickWins: true, basketScope: true, rateProtection: 'max(protected,current)', consentUnknownAllowsStorage: false }, note: 'v2 §16 proposed window, basket scope and rate protection.', decision: 'D-06/D-13' },
  { kind: 'clearingPolicy', key: 'clearing', version: 1, status: 'approved', value: { clearAfterDays: 30 }, note: 'Commission clears 30 days after verified payment (v2 §17).' },
  { kind: 'payoutSchedule', key: 'payout-schedule', version: 2, status: 'proposed', value: { day: 15, localTime: '09:00', tz: 'America/Chicago', cutoffDay: 14, cutoffLocalTime: '23:59:59', minimumMinor: 5000 }, note: 'v2 §17 proposed monthly run.', decision: 'D-09' },
  { kind: 'payoutReadinessPolicy', key: 'payout-readiness', version: 1, status: 'proposed', value: { requireStripeTransfersActive: true, requireW9ForManual: true, requireTaxApprovedForAutomatic: true }, note: 'One tax and readiness policy for manual and automatic payouts (v2 §28).', decision: 'D-10' },
  { kind: 'creditPolicy', key: 'business-credit', version: 2, status: 'proposed', value: { awardMinor: 10_000, qualifyingMinMinor: 50_000, awardAfterDays: 30, expires: false, dualReward: 'forbidden' }, note: 'v2 §19 proposed timing and anti-double-reward ($100 / $500 already approved).', decision: 'D-05' },
  {
    kind: 'tradeDiscountSchedule', key: 'trade-discount', version: 2, status: 'approved',
    value: { general: { maxBps: 2500, requiresSchedule: true }, suppliers: { zuo: { defaultBps: 1000, approvedExceptionBps: 500, projectStacking: false } } },
    note: 'Explicit per-supplier trade schedule; Zuo 10% (or approved 5%), never the general 25%, no project stacking (v2 §18).',
  },
  { kind: 'projectDiscountPolicy', key: 'project-discount', version: 2, status: 'proposed', value: { tiers: [{ minMinor: 1_000_000, bps: 300 }, { minMinor: 2_500_000, bps: 500 }], stack: 'highest_only', basis:'eligible_trade_merchandise' }, note: 'v2 §18 proposed project thresholds.', decision: 'D-04' },
  { kind: 'ledgerPolicy', key: 'ledger-adjustment-threshold', version: 1, status: 'proposed', value: { secondConfirmationAtMinor: 25_000 }, note: 'Manual ledger adjustments of $250 or more need a second confirmation.', decision: 'D-17' },
];
