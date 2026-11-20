import { validateDraft, type CommerceDraft } from './commerce';

export type ZuoStagingRow = {
  sku: string; pack: number; draft: CommerceDraft; sourceEvidence: string;
  excluded: boolean; exclusionReasons: string[]; holdReasons: string[];
};

/** Prices/cost are per SELLABLE PACK; pack records physical units per sell unit. */
export function validateZuoStagingRow(row: ZuoStagingRow) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(row.sku)) throw new Error('Invalid Zuo SKU.');
  if (!Number.isSafeInteger(row.pack) || row.pack < 1 || row.pack > 9999) throw new Error('Invalid master pack.');
  validateDraft(row.draft);
  if (row.draft.supplierName !== 'Zuo' || row.draft.currency !== 'USD' || row.draft.usdRate !== 1)
    throw new Error('Zuo staging requires supplier Zuo and USD sellable-pack prices.');
  const url = new URL(row.draft.sourceUrl);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Secure source evidence URL required.');
  if (row.draft.variants.length !== 1) throw new Error('Stage one supplier SKU per product.');
  const v = row.draft.variants[0];
  if (v.sku !== row.sku || v.minimum !== 1 || v.increment !== 1 || v.cost <= 0 || v.retail <= 0 || v.commercial <= 0)
    throw new Error('SKU, pack, cost and approved retail/trade prices must match the staging row.');
  if (v.commercial > v.retail) throw new Error('Trade price exceeds retail.');
  if (!row.sourceEvidence.trim() || row.sourceEvidence.length > 20000) throw new Error('Bounded source evidence required.');
  for (const list of [row.exclusionReasons, row.holdReasons])
    if (list.length > 40 || list.some(s => !s.trim() || s.length > 1000)) throw new Error('Invalid exclusion or hold reason.');
  if (row.excluded !== (row.exclusionReasons.length > 0)) throw new Error('Exclusion flag and reasons disagree.');
  if (JSON.stringify(row).length > 100000) throw new Error('Staging row too large.');
}

export function stagingPayload(value: unknown): string {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return JSON.stringify(canonical(value));
}
