// One vocabulary for both sites (spec S37, v2 §20): currency, dates and status words read the same
// on louiemae.com and House of Louie Mae.
export { ORDER_STATUS_LABEL } from './customerCopy';

export const LEDGER_STATE_LABEL: Record<string, string> = {
  pending: 'Pending (clears 30 days after payment)',
  held: 'On hold (payment disputed)',
  cleared: 'Cleared, ready for the next payout',
  reserved: 'Being paid',
  transfer_submitted: 'Being paid',
  transferred: 'Sent to your Stripe account',
  void: 'Void (refunded or cancelled)',
};

export const BANK_PAYOUT_LABEL: Record<string, string> = {
  pending: 'Bank payout scheduled',
  in_transit: 'On its way to your bank',
  paid: 'Arrived in your bank',
  failed: 'Bank payout failed',
  canceled: 'Bank payout cancelled',
};

export const TIER_LABEL: Record<string, string> = { base: 'Base', active: 'Active', top: 'Top', elite: 'Elite' };

export const CREDIT_EVENT_LABEL: Record<string, string> = {
  award_pending: 'Award pending (30 days)',
  award_available: 'Award available',
  award_cancelled: 'Award cancelled',
  reserved: 'Held for an order',
  reservation_released: 'Hold released',
  redeemed: 'Used on an order',
  reversed: 'Reversed',
  reinstated: 'Returned after a refund',
  offset_created: 'Offset',
  opening_balance: 'Opening balance',
  manual_adjustment: 'Adjustment',
};

export const formatDate = (at: number) => new Date(at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
