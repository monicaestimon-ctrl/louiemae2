import { describe, expect, it } from 'vitest';
import { proposeCategory } from './catCategory';
import { cartonsFor, checkPackQuantity, packLabel, physicalUnits, piecePriceInfo } from './catUnits';
import { availabilityAllows, evaluateVariant, type CostView, type Observation } from './catFreshness';
import { assertMapRespected, marketFlag, mechanismAllowed } from './promotionPolicy';
import { hostAllowed, safeFetch, sniffImage } from './safeFetch';
import { nameProblems, slugify, uniqueSlug } from './slug';
import { cohortCounts, countMismatches, normalizePackage, parseCsv, parseJsonPackage, EXPECTED_ZUO_COUNTS } from './zuoImport';
import { isCommerceError } from './errors';

const H = 3_600_000;
const D = 24 * H;
const policy = { stockSyncMaxHours: 24, checkoutSourceMaxHours: 24, costMapMaxDays: 7, recheckOnSupplierNotice: true };

describe('commission categories (S08)', () => {
  it('maps lighting to décor and refuses ambiguous text', () => {
    expect(proposeCategory('Table lamp').category).toBe('decor');
    expect(proposeCategory('Pendant lighting').category).toBe('decor');
    expect(proposeCategory('Dining chair').category).toBe('furniture');
    expect(proposeCategory('Kids dress').category).toBe('clothing');
    expect(proposeCategory('Ceramic vase').category).toBe('decor');
    expect(proposeCategory('Mystery item').category).toBe('review_required');
  });
});

describe('packs and cartons (CAT03)', () => {
  const pair = { piecesPerPack: 2, orderMinimumPacks: 1, orderIncrementPacks: 1 };
  it('keeps pieces, packs and cartons consistent', () => {
    expect(physicalUnits(pair, 3)).toBe(6);
    const cartons = cartonsFor([{ cartonsPerPack: 2, lengthMm: 900, widthMm: 600, heightMm: 500, grossWeightG: 15_000 }], 3);
    expect(cartons).toHaveLength(6); // 2 cartons per pack × 3 packs, each listed separately
    expect(piecePriceInfo(45_806, 2)).toBe(22_903);
    expect(packLabel(2)).toBe('Set of 2');
    expect(packLabel(1)).toBe('');
    expect(() => cartonsFor([], 1)).toThrow();
  });
  it('checks minimums and increments', () => {
    const v = { piecesPerPack: 1, orderMinimumPacks: 2, orderIncrementPacks: 2 };
    expect(() => checkPackQuantity(v, 2)).not.toThrow();
    expect(() => checkPackQuantity(v, 4)).not.toThrow();
    expect(() => checkPackQuantity(v, 3)).toThrow();
    expect(() => checkPackQuantity(v, 1)).toThrow();
  });
});

describe('freshness and availability (CAT02, CAT05)', () => {
  const now = 100 * D;
  const cost: CostView = { wholesaleMinor: 11_500, mapMinor: null, mapSource: 'none', mapApplicability: 'not_applicable', mapUnitBasis: 'pack', verifiedAt: now - D };
  const stock = (value: string, at: number): Observation => ({ field: 'stock', extractedValue: value, observedAt: at, confidence: 'confirmed' });
  const base = { cost, piecesPerPack: 2, cartons: 1, policy, now };

  it('passes current complete evidence', () => {
    const r = evaluateVariant({ ...base, observations: [stock('in_stock', now - H)] });
    expect(r).toMatchObject({ holds: [], availability: 'in_stock' });
  });

  it('holds stale cost at exactly the policy boundary, unless a price list is in effect', () => {
    expect(evaluateVariant({ ...base, cost: { ...cost, verifiedAt: now - 7 * D }, observations: [stock('in_stock', now)] }).holds).toEqual([]);
    expect(evaluateVariant({ ...base, cost: { ...cost, verifiedAt: now - 7 * D - 1 }, observations: [stock('in_stock', now)] }).holds).toContain('COST_STALE');
    expect(evaluateVariant({ ...base, cost: { ...cost, verifiedAt: now - 30 * D }, priceListValidUntil: now + D, observations: [stock('in_stock', now)] }).holds).toEqual([]);
    // a known expiry wins over a recent timestamp
    expect(evaluateVariant({ ...base, cost: { ...cost, effectiveTo: now }, observations: [stock('in_stock', now)] }).holds).toContain('COST_STALE');
  });

  it('holds stock older than 24 hours, missing stock and conflicts', () => {
    expect(evaluateVariant({ ...base, observations: [stock('in_stock', now - 24 * H)] }).holds).toEqual([]);
    expect(evaluateVariant({ ...base, observations: [stock('in_stock', now - 24 * H - 1)] }).holds).toContain('STOCK_UNVERIFIED');
    expect(evaluateVariant({ ...base, observations: [] })).toMatchObject({ availability: 'unknown', holds: ['STOCK_UNVERIFIED'] });
    const conflict = evaluateVariant({ ...base, observations: [stock('in_stock', now), { field: 'wholesale', extractedValue: '115', observedAt: now, confidence: 'confirmed' }, { field: 'wholesale', extractedValue: '120', observedAt: now, confidence: 'confirmed' }] });
    expect(conflict.holds).toContain('COST_CONFLICT');
  });

  it('keeps discontinued, out of stock and unknown distinct and never sellable', () => {
    expect(evaluateVariant({ ...base, observations: [stock('discontinued', now - 90 * D)] }).availability).toBe('discontinued');
    expect(evaluateVariant({ ...base, observations: [stock('out_of_stock', now)] }).availability).toBe('out_of_stock');
    for (const a of ['out_of_stock', 'discontinued', 'unknown', 'preorder_approved'] as const) expect(availabilityAllows(a, 'purchase')).toBe(false);
    expect(availabilityAllows('in_stock', 'purchase')).toBe(true);
  });

  it('holds MAP problems and missing cartons and cost', () => {
    const r = evaluateVariant({ ...base, cartons: 0, cost: { ...cost, mapApplicability: 'applies', mapMinor: 0 }, observations: [stock('in_stock', now)] });
    expect(r.holds).toEqual(expect.arrayContaining(['MAP_ZERO', 'CARTON_MISSING']));
    expect(evaluateVariant({ ...base, cost: null, observations: [stock('in_stock', now)] }).holds).toContain('COST_MISSING');
    expect(evaluateVariant({ ...base, cost: { ...cost, mapApplicability: 'unknown' }, observations: [stock('in_stock', now)] }).holds).toContain('MAP_MISSING');
    expect(evaluateVariant({ ...base, cost: { ...cost, mapApplicability: 'applies', mapMinor: 30_000, mapSource: 'policy_derived' }, observations: [stock('in_stock', now)] }).holds).toContain('MAP_POLICY_DERIVED');
  });
});

describe('promotions and MAP (PRI03)', () => {
  it('refuses Zuo coupons, project stacking and credit unless documented', () => {
    expect(mechanismAllowed('zuo', '111182', 'coupon', [])).toBe(false);
    expect(mechanismAllowed('zuo', '111182', 'project', [])).toBe(false);
    expect(mechanismAllowed('zuo', '111182', 'coupon', [{ kind: 'coupon', status: 'documented', scope: { skus: ['111182'] } }])).toBe(true);
    expect(mechanismAllowed('zuo', '999', 'coupon', [{ kind: 'coupon', status: 'documented', scope: { skus: ['111182'] } }])).toBe(false);
    expect(mechanismAllowed('ashcroft', 'X', 'coupon', [])).toBe(true);
    expect(mechanismAllowed('ashcroft', 'X', 'coupon', [{ kind: 'coupon', status: 'denied', scope: { all: true } }])).toBe(false);
  });
  it('enforces MAP on net merchandise', () => {
    expect(() => assertMapRespected(49_999, 50_000, 'applies')).toThrow();
    expect(() => assertMapRespected(50_000, 50_000, 'applies')).not.toThrow();
    expect(() => assertMapRespected(1, null, 'not_applicable')).not.toThrow();
    try {
      assertMapRespected(1, 0, 'applies');
    } catch (e) {
      expect(isCommerceError(e, 'MAP_POLICY_REVIEW')).toBe(true);
    }
  });
  it('flags market reviews at the 10% median boundary and with limited evidence', () => {
    const obs = [100, 100, 100].map((t) => ({ exactMatch: true, inStock: true, totalBeforeTaxMinor: t * 100 }));
    expect(marketFlag(11_000, obs).flag).toBe('ok');
    expect(marketFlag(11_001, obs).flag).toBe('above_median_10pct');
    expect(marketFlag(20_000, obs.slice(0, 2)).flag).toBe('evidence_limited');
  });
});

describe('safe fetch (S14 SSRF)', () => {
  it('allows only https supplier hosts', () => {
    expect(hostAllowed('https://www.zuomod.com/a.jpg')).toBe(true);
    expect(hostAllowed('https://images.zuomod.com/a.jpg')).toBe(true);
    expect(hostAllowed('http://www.zuomod.com/a.jpg')).toBe(false);
    expect(hostAllowed('https://evil.com/a.jpg')).toBe(false);
    expect(hostAllowed('https://zuomod.com.evil.com/a.jpg')).toBe(false);
    expect(hostAllowed('https://127.0.0.1/a.jpg', ['127.0.0.1'])).toBe(false);
    expect(hostAllowed('https://user:pw@zuomod.com/a')).toBe(false);
  });
  it('re-checks every redirect target', async () => {
    const fake = (async (u: string) =>
      u.includes('zuomod') ? new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }) : new Response('x')) as unknown as typeof fetch;
    const r = await safeFetch('https://www.zuomod.com/a.jpg', { fetchImpl: fake });
    expect(r.ok).toBe(false);
  });
  it('sniffs image bytes rather than trusting headers', () => {
    const png = new Uint8Array(32);
    png.set([0x89, 0x50, 0x4e, 0x47]);
    new DataView(png.buffer).setUint32(16, 1200);
    new DataView(png.buffer).setUint32(20, 900);
    expect(sniffImage(png)).toEqual({ mime: 'image/png', width: 1200, height: 900 });
    expect(sniffImage(new globalThis.TextEncoder().encode('<html>not an image</html>'))).toBeNull();
  });
});

describe('names and slugs', () => {
  it('makes stable unique slugs and checks names', () => {
    expect(slugify('Ansel Accent Chair & Ottoman')).toBe('ansel-accent-chair-and-ottoman');
    expect(uniqueSlug('Ansel', (s) => s === 'ansel')).toBe('ansel-2');
    expect(nameProblems('Exclusive Louie Mae Original Sofa')).toHaveLength(1);
    expect(nameProblems('Ok')).toHaveLength(1);
  });
});

describe('Zuo import adapter (S09)', () => {
  const row = (sku: string, over: Record<string, unknown> = {}) => ({
    sku,
    name: `Zuo item ${sku}`,
    category: 'Dining chair',
    sizeClass: 'MEDIUM',
    piecesPerPack: 2,
    wholesale: '115.00',
    costConfidence: 'corroborated',
    mapApplicability: 'not_applicable',
    cohort: 'approved_306',
    approvedRetail: '458.06',
    approvedTrade: '412.26',
    stock: 'in_stock',
    cartons: [{ count: 1, lengthIn: '24', widthIn: '20', heightIn: '36', weightLb: '30' }],
    images: ['https://www.zuomod.com/111182.jpg'],
    ...over,
  });

  it('normalizes JSON rows with unit conversions and holds', () => {
    const { records, rejected } = normalizePackage(parseJsonPackage(JSON.stringify({ records: [row('111182')] })), 'Zuo-Draft-Import.json', 1);
    expect(rejected).toEqual([]);
    const r = records[0].record;
    expect(r.cartons[0]).toMatchObject({ lengthMm: 610, widthMm: 508, heightMm: 914, grossWeightG: 13_608 });
    expect(r.wholesalePiece).toBe('115.00');
    expect(records[0].holdReasons).toContain('MEDIA_MISSING');
    expect(records[0].holdReasons).not.toContain('COST_MISSING');
  });

  it('converts pack bases and rejects bad rows and duplicate keys', () => {
    const rows = parseJsonPackage(
      JSON.stringify([row('1', { wholesale: '230.00', wholesaleBasis: 'pack' }), row('1'), row('2', { currency: 'EUR' }), row('3', { wholesale: '-5' }), row('4', { piecesPerPack: 1.5 }), row('5', { wholesaleBasis: 'box' }), row('', {})])
    );
    const { records, rejected } = normalizePackage(rows, 'f', 1);
    expect(records).toHaveLength(1);
    expect(records[0].record.wholesalePiece).toBe('115.000000');
    expect(rejected.map((r) => r.reasons[0])).toEqual([
      'duplicate supplier key 1:1 (first at row 1)',
      'unsupported currency EUR',
      'wholesale is negative',
      'piecesPerPack must be a whole number of at least 1',
      'inconsistent wholesale unit basis "box"',
      'missing supplier SKU',
    ]);
  });

  it('holds unknowns rather than inventing values, and applies the named SKU treatments', () => {
    const { records } = normalizePackage(
      parseJsonPackage(JSON.stringify([row('110799'), row('101771'), row('111300'), row('9', { wholesale: '', cartons: [], cohort: 'unpriced_62', sizeClass: '' }), row('10', { cohort: 'map_135', map: '600', mapSource: 'policy derived' })])),
      'f',
      1
    );
    const by = Object.fromEntries(records.map((r) => [r.record.sku, r]));
    expect(by['110799'].holdReasons).toContain('METHOD_CHANGED');
    expect(by['101771'].holdReasons).toContain('SOURCE_ABSENT');
    expect(by['111300'].record.stock).toBe('out_of_stock');
    expect(by['9'].record.wholesalePiece).toBeNull();
    expect(by['9'].holdReasons).toEqual(expect.arrayContaining(['COST_MISSING', 'CARTON_MISSING', 'DELIVERY_UNSUPPORTED']));
    expect(by['10'].holdReasons).toEqual(expect.arrayContaining(['MAP_FLOOR_UNAPPROVED', 'MAP_POLICY_DERIVED']));
  });

  it('parses CSV with quoted fields and flattened cartons', () => {
    const csv = 'sku,name,category,sizeClass,piecesPerPack,wholesale,cohort,stock,carton1_length_in,carton1_width_in,carton1_height_in,carton1_weight_lb\n"111182","Chair, ""Oak""",Dining chair,MEDIUM,2,115.00,approved_306,in_stock,24,20,36,30\n';
    const { records } = normalizePackage(parseCsv(csv), 'Zuo-Draft-Import.csv', 1);
    expect(records[0].record.supplierName).toBe('Chair, "Oak"');
    expect(records[0].record.cartons).toHaveLength(1);
  });

  it('counts cohorts against the package expectations', () => {
    const { records } = normalizePackage(parseJsonPackage(JSON.stringify([row('1'), row('2', { cohort: 'unpriced_62', excluded: 'true', exclusionReason: 'discontinued' })])), 'f', 1);
    const c = cohortCounts(records.map((r) => r.record));
    expect(c).toMatchObject({ total: 2, approved_306: 1, unpriced_62: 1, excluded: 1, nonexcludedDrafts: 1, modeledPrices: 1 });
    expect(records[1].record.stock).toBe('discontinued');
    expect(countMismatches(c).length).toBeGreaterThan(0);
    expect(countMismatches({ ...EXPECTED_ZUO_COUNTS })).toEqual([]);
  });
});
