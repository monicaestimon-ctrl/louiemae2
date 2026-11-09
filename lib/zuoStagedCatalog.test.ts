import { describe, expect, it } from 'vitest';
import { blankCommerceDraft } from './commerce';
import type { ZuoStagingRow } from './zuoStaging';
import { stagedCatalogRecord } from './zuoStagedCatalog';

const fixture = (): ZuoStagingRow => ({
  sku: 'FIXTURE',
  pack: 2,
  excluded: false,
  exclusionReasons: [],
  holdReasons: ['Original unresolved source review'],
  draft: {
    ...blankCommerceDraft(),
    name: 'Willow chair',
    supplierName: 'Zuo',
    sourceUrl: 'https://www.zuomod.com/fixture',
    packaging: JSON.stringify({
      unitsPerSellUnit: 2,
      shippingMethod: 'Ground',
      cartons: [{ carton: 1, dimensionOrder: 'W,L,H', dims: [20, 24, 36], weight: 30 }],
    }),
    images: ['https://example.com/fixture.jpg'],
    variants: [
      {
        id: 'fixture',
        sku: 'FIXTURE',
        name: 'Default',
        cost: 230,
        minimum: 1,
        increment: 1,
        retail: 45806,
        commercial: 41226,
      },
    ],
  },
  sourceEvidence: JSON.stringify({
    pricingRegime: 'APPROVED_5_PERCENT',
    originalSupplierName: 'Original supplier chair',
    freshObservation: {
      currentInstallRow: 2,
      currentPack: 2,
      currentCostEach: 115,
      currentMapEach: 180,
      currentAvailability: 'IN_STOCK',
      currentShip: 'Ground',
      currentCartons: [{ dims: [20, 24, 36], weight: 30 }],
    },
  }),
});
describe('stored catalog conversion', () => {
  it('corroborates only a matching current supplier cost without clearing other publishing gates', () => {
    const row = fixture(), source = JSON.parse(row.sourceEvidence);
    source.freshObservation.freshLocalCandidate = true;
    source.freshObservation.blockers = [];
    source.freshObservation.currentCostEach = 115.001;
    row.sourceEvidence = JSON.stringify(source);
    const result = stagedCatalogRecord(row, 'verified source packet', 1000);
    expect(result.record.costConfidence).toBe('corroborated');
    expect(result.record.wholesalePiece).toBe('115.001');
    expect(result.holdReasons).not.toContain('COST_STALE');
    expect(result.holdReasons).toEqual(expect.arrayContaining(['MANUAL', 'MEDIA_RIGHTS', 'STOCK_UNVERIFIED', 'DELIVERY_UNSUPPORTED']));
  });
  it('preserves pack prices and converts explicit carton units without certifying costs or rights', () => {
    const result = stagedCatalogRecord(fixture(), 'fixture source', 1000);
    expect(result.record).toMatchObject({
      sku: 'FIXTURE',
      piecesPerPack: 2,
      approvedRetailPack: '458.06',
      approvedTradePack: '412.26',
      costConfidence: 'unverified',
      supplierName: 'Original supplier chair',
      louieMaeName: 'Willow chair',
    });
    expect(Number(result.record.wholesalePiece)).toBe(115);
    expect(Number(result.record.mapPack)).toBe(360);
    expect(result.record.cartons).toEqual([
      {
        cartonsPerPack: 1,
        widthMm: 610,
        lengthMm: 914,
        heightMm: 508,
        grossWeightG: 13608,
        method: 'ground',
      },
    ]);
    expect(result.holdReasons).toEqual(
      expect.arrayContaining([
        'MANUAL',
        'MEDIA_RIGHTS',
        'COST_STALE',
        'STOCK_UNVERIFIED',
        'Original unresolved source review',
      ])
    );
  });
  it('retains exclusions even when a fresh feed says in stock and keeps missing current MAP/cartons held', () => {
    const row = fixture();
    row.excluded = true;
    row.exclusionReasons = ['DISCONTINUED'];
    const source = JSON.parse(row.sourceEvidence);
    source.freshObservation.currentMapEach = 0;
    delete source.freshObservation.currentCartons;
    row.sourceEvidence = JSON.stringify(source);
    const packaging = JSON.parse(row.draft.packaging);
    delete packaging.cartons[0].dimensionOrder;
    row.draft.packaging = JSON.stringify(packaging);
    const result = stagedCatalogRecord(row, 'fixture', 1000);
    expect(result.record).toMatchObject({
      excluded: true,
      stock: 'discontinued',
      mapPack: null,
      cartons: [],
    });
    expect(result.holdReasons).toEqual(expect.arrayContaining(['CARTON_MISSING', 'MAP_MISSING']));
  });
  it('retains approved wholesale while flagging a newer cost or method difference', () => {
    const row = fixture(),
      source = JSON.parse(row.sourceEvidence);
    source.freshObservation.currentCostEach = 120;
    source.freshObservation.currentShip = 'LTL';
    row.sourceEvidence = JSON.stringify(source);
    const result = stagedCatalogRecord(row, 'fixture', 1000);
    expect(Number(result.record.wholesalePiece)).toBe(115);
    expect(result.record.cartons[0].method).toBe('ltl');
    expect(result.holdReasons).toEqual(expect.arrayContaining(['COST_CONFLICT', 'METHOD_CHANGED']));
  });
  it('rejects inconsistent pack metadata and unknown pricing regimes', () => {
    const row = fixture();
    row.draft.packaging = JSON.stringify({ unitsPerSellUnit: 1 });
    expect(() => stagedCatalogRecord(row, 'fixture', 1000)).toThrow(/unit basis/);
    row.sourceEvidence = JSON.stringify({ pricingRegime: 'invented' });
    expect(() => stagedCatalogRecord(row, 'fixture', 1000)).toThrow(/pricing cohort/);
  });
});
