// Known stale settings text in the 2026-11-06 Zuo package (v2 §22). Row-level data and the
// reconciliation summary control the snapshot; these notes are recorded on each import batch.
export const KNOWN_METADATA_CORRECTIONS = [
  'settings.pricingPrecedence mentions 128 unpriced records; the reconciled snapshot has 62.',
  'settings.targetContributionScope omits the 66 reconciled 20% candidates.',
];
