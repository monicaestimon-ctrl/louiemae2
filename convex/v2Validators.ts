// Shared validators for the v2 tables (spec 02 §2). Money is integer cents; rates are bps.
import { v } from 'convex/values';

export const commissionCategory = v.union(v.literal('furniture'), v.literal('decor'), v.literal('clothing'), v.literal('review_required'));
export const availability = v.union(v.literal('in_stock'), v.literal('out_of_stock'), v.literal('discontinued'), v.literal('preorder_approved'), v.literal('unknown'));
export const publicationStage = v.union(
  v.literal('imported_draft'),
  v.literal('evidence_review'),
  v.literal('economics_review'),
  v.literal('content_review'),
  v.literal('ready'),
  v.literal('published'),
  v.literal('archived')
);
export const HOLD_REASONS = [
  'COST_MISSING', 'COST_STALE', 'COST_CONFLICT', 'COST_IMPLAUSIBLE',
  'MAP_MISSING', 'MAP_ZERO', 'MAP_POLICY_DERIVED', 'MAP_FLOOR_UNAPPROVED',
  'CARTON_MISSING', 'STOCK_UNVERIFIED', 'SOURCE_ABSENT', 'METHOD_CHANGED',
  'MEDIA_MISSING', 'MEDIA_RIGHTS', 'NAME_COLLISION', 'CATEGORY_REVIEW',
  'MARGIN_BELOW_POLICY', 'COMMISSION_UNQUALIFIED', 'MAPPING_MISSING',
  'DELIVERY_UNSUPPORTED', 'MANUAL',
] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];
export const holdReason = v.union(...HOLD_REASONS.map((r) => v.literal(r))) as ReturnType<typeof v.union<[ReturnType<typeof v.literal<HoldReason>>]>>;
export const configStatus = v.union(v.literal('proposed'), v.literal('approved'), v.literal('retired'), v.literal('rejected'));
export const fulfillmentRoute = v.union(
  v.literal('manual_dealer_zuo'),
  v.literal('manual_dealer_ashcroft'),
  v.literal('edi_zuo'),
  v.literal('cj_auto'),
  v.literal('owner_managed')
);
export const tierKey = v.union(v.literal('base'), v.literal('active'), v.literal('top'), v.literal('elite'));
export const membershipSource = v.union(v.literal('creator'), v.literal('trade'));
export const retailOrTrade = v.union(v.literal('retail'), v.literal('trade'));
export const revisionMeta = {
  createdAt: v.number(),
  createdBy: v.string(),
  effectiveFrom: v.number(),
  effectiveTo: v.optional(v.number()),
  source: v.string(),
};
export const shipAddress = v.object({
  recipientName: v.optional(v.string()),
  access: v.optional(
    v.object({
      destinationType: v.union(v.literal('residential'), v.literal('commercial')),
      requestedService: v.union(
        v.literal('standard'),
        v.literal('inside'),
        v.literal('white_glove'),
        v.literal('expedited')
      ),
      stairs: v.boolean(),
      limitedAccess: v.boolean(),
      loadingDock: v.boolean(),
    })
  ),
  phone: v.optional(v.string()),
  line1: v.string(),
  line2: v.optional(v.string()),
  city: v.string(),
  state: v.string(),
  postalCode: v.string(),
  country: v.string(),
});
export const deliveryTerms = v.object({
  version: v.number(),
  label: v.string(),
  details: v.array(v.string()),
});
export const obligationState = v.union(
  v.literal('pending'),
  v.literal('cleared'),
  v.literal('held'),
  v.literal('reserved'),
  v.literal('transfer_submitted'),
  v.literal('transferred'),
  v.literal('void')
);
export const COMMISSION_EVENT_TYPES = [
  'earned', 'opening_balance', 'refund_reversal', 'dispute_hold', 'dispute_release', 'dispute_lost',
  'cleared', 'reserved', 'reservation_released', 'transfer_submitted', 'transferred', 'transfer_failed',
  'transfer_reversed', 'offset', 'manual_adjustment', 'void',
] as const;
export type CommissionEventType = (typeof COMMISSION_EVENT_TYPES)[number];
export const commissionEventType = v.union(...COMMISSION_EVENT_TYPES.map((t) => v.literal(t))) as ReturnType<typeof v.union<[ReturnType<typeof v.literal<CommissionEventType>>]>>;
export const CREDIT_EVENT_TYPES = [
  'opening_balance', 'award_pending', 'award_available', 'award_cancelled', 'reserved', 'reservation_released',
  'redeemed', 'reversed', 'reinstated', 'offset_created', 'manual_adjustment',
] as const;
export type CreditEventType = (typeof CREDIT_EVENT_TYPES)[number];
export const creditEventType = v.union(...CREDIT_EVENT_TYPES.map((t) => v.literal(t))) as ReturnType<typeof v.union<[ReturnType<typeof v.literal<CreditEventType>>]>>;

export const notificationEnvelope = v.object({ from:v.string(), to:v.string(), subject:v.string(), text:v.string(), replyTo:v.optional(v.string()) });
