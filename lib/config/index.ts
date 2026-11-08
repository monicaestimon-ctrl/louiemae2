// Versioned configuration (spec 02 §6). Every business number lives in a sysConfig record with a
// status; customer paths only read `approved` records. These parsers validate a record's value
// for its kind, so a typo can't become a live price, rate or schedule.
import { CommerceError } from '../errors';

export const CONFIG_KINDS = [
  'marginPolicy',
  'pricingAssumptions',
  'roundingPolicy',
  'freshnessPolicy',
  'deliveryLadder',
  'deliveryRule',
  'carrierRule',
  'commissionSchedule',
  'tierPolicy',
  'payoutSchedule',
  'payoutReadinessPolicy',
  'clearingPolicy',
  'creditPolicy',
  'tradeDiscountSchedule',
  'projectDiscountPolicy',
  'promotionPolicy',
  'estimatePolicy',
  'attributionPolicy',
  'returnPolicy',
  'serviceLevel',
  'categoryMap',
  'ledgerPolicy',
  'flagSwitch',
  'operatorDetails',
] as const;
export type ConfigKind = (typeof CONFIG_KINDS)[number];

type Obj = Record<string, unknown>;
const bad = (kind: string, why: string): never => {
  throw new CommerceError('INVALID_INPUT', `${kind}: ${why}`);
};
const obj = (kind: string, v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : bad(kind, 'value must be an object'));
const int = (kind: string, v: unknown, field: string, lo = 0, hi = Number.MAX_SAFE_INTEGER) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= lo && v <= hi ? v : bad(kind, `${field} must be an integer ${lo}–${hi}`);
const bps = (kind: string, v: unknown, field: string) => int(kind, v, field, 0, 10_000);
const str = (kind: string, v: unknown, field: string) => (typeof v === 'string' && v.length > 0 ? v : bad(kind, `${field} must be text`));

export type MarginPolicy = { targetBps?: number; cohort?: string; expandable?: boolean; requiresDocumentRef?: boolean; blocksAutomaticSale?: boolean };
export type PricingAssumptions = {
  supplierPaymentReserveBps: number;
  handlingPerPieceMinor: number;
  processingBps: number;
  returnsBps: number;
  overheadBps: number;
  allowanceBySize: Record<'SMALL' | 'MEDIUM' | 'LARGE' | 'OVERSIZE' | 'LTL', number>;
};
export type DeliveryLadder = { tiersMinor: number[]; quoteAboveMinor: number; minimumMinor: number; deliveryProcessingBps: number };
export type TierKey = 'base' | 'active' | 'top' | 'elite';
export type CommissionCategory = 'furniture' | 'decor' | 'clothing';
export type CommissionSchedule = {
  tiers: { key: TierKey; minMinor: number; rates: Record<CommissionCategory, number> }[];
  ceilingBps: number;
};
export type PayoutSchedule = { day: number; localTime: string; tz: string; cutoffDay: number; cutoffLocalTime: string; minimumMinor: number };
export type ClearingPolicy = { clearAfterDays: number };
export type CreditPolicy = { awardMinor: number; qualifyingMinMinor: number; awardAfterDays: number; expires: boolean; dualReward: 'forbidden' | 'allowed' };
export type EstimatePolicy = { validityMinutes: number; zipNonbinding: boolean };
export type FreshnessPolicy = { stockSyncMaxHours: number; checkoutSourceMaxHours: number; costMapMaxDays: number; recheckOnSupplierNotice: boolean };
export type AttributionPolicy = { windowMs: number; lastClickWins: boolean; basketScope: boolean; rateProtection: 'max(protected,current)'; consentUnknownAllowsStorage: boolean };
export type TierPolicy = { recompute: string[]; dailyLocal: string; tz: string; windowMonths: number; windowShape: 'calendar_months' | 'rolling_365'; crossingEarns: 'pre_purchase'; downgrade: 'quarterly_one_step' | 'immediate' };
export type TradeDiscountSchedule = { general: { maxBps: number; requiresSchedule: boolean }; suppliers: Record<string, { defaultBps: number; approvedExceptionBps?: number; projectStacking: boolean }> };
export type ProjectDiscountPolicy = { tiers: { minMinor: number; bps: number }[]; stack: 'highest_only' };

const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** Validates a config value for its kind. Returns it typed; throws INVALID_INPUT otherwise. */
export function parseConfig(kind: ConfigKind, value: unknown): unknown {
  const o = obj(kind, value);
  switch (kind) {
    case 'marginPolicy': {
      if (o.targetBps !== undefined) bps(kind, o.targetBps, 'targetBps');
      if (o.targetBps === undefined && o.blocksAutomaticSale !== true) bad(kind, 'targetBps or blocksAutomaticSale is required');
      return o as MarginPolicy;
    }
    case 'pricingAssumptions': {
      for (const f of ['supplierPaymentReserveBps', 'processingBps', 'returnsBps', 'overheadBps']) bps(kind, o[f], f);
      int(kind, o.handlingPerPieceMinor, 'handlingPerPieceMinor');
      const a = obj(kind, o.allowanceBySize);
      for (const s of ['SMALL', 'MEDIUM', 'LARGE', 'OVERSIZE', 'LTL']) int(kind, a[s], `allowanceBySize.${s}`);
      return o as PricingAssumptions;
    }
    case 'roundingPolicy':
      if (!['pack', 'piece'].includes(String(o.unit)) || !['ceil', 'floor', 'half_up', 'half_even'].includes(String(o.mode))) bad(kind, 'unit and mode are required');
      return o;
    case 'deliveryLadder': {
      const tiers = Array.isArray(o.tiersMinor) ? o.tiersMinor : bad(kind, 'tiersMinor must be a list');
      tiers.forEach((t, i) => {
        int(kind, t, `tiersMinor[${i}]`, 1);
        if (i && t <= tiers[i - 1]) bad(kind, 'tiersMinor must increase');
      });
      int(kind, o.quoteAboveMinor, 'quoteAboveMinor', 1);
      int(kind, o.minimumMinor, 'minimumMinor', 1);
      bps(kind, o.deliveryProcessingBps, 'deliveryProcessingBps');
      if (o.minimumMinor !== tiers[0] || o.quoteAboveMinor !== tiers[tiers.length - 1]) bad(kind, 'minimum and quote threshold must match the ladder ends');
      return o as DeliveryLadder;
    }
    case 'commissionSchedule': {
      const tiers = Array.isArray(o.tiers) ? o.tiers : bad(kind, 'tiers must be a list');
      let last = -1;
      for (const t of tiers) {
        const r = obj(kind, t);
        str(kind, r.key, 'tiers[].key');
        const m = int(kind, r.minMinor, 'tiers[].minMinor');
        if (m <= last) bad(kind, 'tier thresholds must increase');
        last = m;
        const rates = obj(kind, r.rates);
        for (const c of ['furniture', 'decor', 'clothing']) bps(kind, rates[c], `rates.${c}`);
      }
      bps(kind, o.ceilingBps, 'ceilingBps');
      return o as CommissionSchedule;
    }
    case 'payoutSchedule':
      int(kind, o.day, 'day', 1, 28);
      int(kind, o.cutoffDay, 'cutoffDay', 1, 28);
      if (!TIME.test(String(o.localTime)) || !TIME.test(String(o.cutoffLocalTime))) bad(kind, 'times must be HH:MM[:SS]');
      str(kind, o.tz, 'tz');
      int(kind, o.minimumMinor, 'minimumMinor');
      return o as PayoutSchedule;
    case 'clearingPolicy':
      int(kind, o.clearAfterDays, 'clearAfterDays', 0, 365);
      return o as ClearingPolicy;
    case 'creditPolicy':
      int(kind, o.awardMinor, 'awardMinor');
      int(kind, o.qualifyingMinMinor, 'qualifyingMinMinor');
      int(kind, o.awardAfterDays, 'awardAfterDays', 0, 365);
      return o as CreditPolicy;
    case 'estimatePolicy':
      int(kind, o.validityMinutes, 'validityMinutes', 1, 24 * 60);
      return o as EstimatePolicy;
    case 'freshnessPolicy':
      int(kind, o.stockSyncMaxHours, 'stockSyncMaxHours', 1, 24 * 30);
      int(kind, o.checkoutSourceMaxHours, 'checkoutSourceMaxHours', 1, 24 * 30);
      int(kind, o.costMapMaxDays, 'costMapMaxDays', 1, 365);
      return o as FreshnessPolicy;
    case 'attributionPolicy':
      int(kind, o.windowMs, 'windowMs', 1);
      return o as AttributionPolicy;
    case 'tierPolicy':
      if (!TIME.test(String(o.dailyLocal))) bad(kind, 'dailyLocal must be HH:MM');
      str(kind, o.tz, 'tz');
      if (!['quarterly_one_step', 'immediate'].includes(String(o.downgrade))) bad(kind, 'downgrade must be quarterly_one_step or immediate');
      if (!['calendar_months', 'rolling_365'].includes(String(o.windowShape))) bad(kind, 'windowShape is required');
      return o as TierPolicy;
    case 'tradeDiscountSchedule': {
      bps(kind, obj(kind, o.general).maxBps, 'general.maxBps');
      for (const [code, s] of Object.entries(obj(kind, o.suppliers))) bps(kind, obj(kind, s).defaultBps, `suppliers.${code}.defaultBps`);
      return o as TradeDiscountSchedule;
    }
    case 'projectDiscountPolicy': {
      const tiers = Array.isArray(o.tiers) ? o.tiers : bad(kind, 'tiers must be a list');
      for (const t of tiers) {
        int(kind, obj(kind, t).minMinor, 'tiers[].minMinor');
        bps(kind, obj(kind, t).bps, 'tiers[].bps');
      }
      return o as ProjectDiscountPolicy;
    }
    case 'operatorDetails':
      for (const f of ['legalName', 'supportEmail', 'supportAddress', 'jurisdiction', 'privacyUrl', 'effectiveDate']) str(kind, o[f], f);
      return o as OperatorDetails;
    default:
      // Kinds whose shape is supplier- or carrier-specific are checked by their consumers.
      return o;
  }
}

export type OperatorDetails = { legalName: string; supportEmail: string; supportAddress: string; jurisdiction: string; privacyUrl: string; effectiveDate: string };

export type ConfigSeed = { kind: ConfigKind; key: string; version: number; status: 'proposed' | 'approved'; value: unknown; note: string; decision?: string };
