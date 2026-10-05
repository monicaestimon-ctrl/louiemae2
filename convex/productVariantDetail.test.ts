// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from './schema';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { getCjVariantMappingSummary, hasCjVariantQueueFootprint } from '../lib/cjVariantQueue';
vi.mock('./cjAdminAccess', () => ({ requireCjAdminIdentity: vi.fn(async () => ({ email: 'admin@example.com' })) }));
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const detail = makeFunctionReference<'query'>('products:getAdminVariantDetail');
const queue = makeFunctionReference<'query'>('products:getProductsWithCjVariants');
const fixture = { name: 'Chair', price: 90, description: 'Complete listing description', images: ['chair.jpg'], category: 'chairs', collection: 'furniture' };
const option = { id: 'oak', name: 'Oak', priceAdjustment: 0, inStock: true };
describe('authoritative CJ variant details and shared rules', () => {
  it('preserves invalid/duplicate mappings and excludes unavailable unmapped options from the unmapped count', () => {
    expect(getCjVariantMappingSummary({ cjSourcingStatus: 'approved', cjSourcingState: 'reconciliation_required', cjVariants: [{ vid: 'cj-oak', sku: 'correct', name: 'Oak' }],
      variants: [{ ...option, cjVariantId: 'cj-oak', cjSku: 'wrong' }, { ...option, id: 'duplicate', cjVariantId: 'cj-oak', cjSku: 'correct' }, { ...option, id: 'unmapped' }, { ...option, id: 'unavailable', inStock: false }] })).toEqual({
      issueCodes: ['MISSING_CJ_PRODUCT_ID', 'UNMAPPED_CUSTOMER_VARIANTS', 'INVALID_CJ_MAPPINGS', 'DUPLICATE_CJ_MAPPINGS', 'RECONCILIATION_REQUIRED'],
      customerVariantCount: 4, mappedVariantCount: 2, unmappedVariantCount: 1, cjVariantCount: 1, unmatchedCjVariantCount: 0, invalidMappingCount: 2,
    });
    expect(hasCjVariantQueueFootprint({})).toBe(false);
    expect(hasCjVariantQueueFootprint({ cjSourcingStatus: 'none', cjSourcingState: 'needs_input' })).toBe(false);
    expect(hasCjVariantQueueFootprint({ cjSku: 'sku' })).toBe(true);
    expect(getCjVariantMappingSummary({ cjSourcingStatus: 'pending', cjSourcingState: 'needs_input' }).issueCodes).toEqual(['CJ_APPROVAL_PENDING', 'NEEDS_INPUT']);
  });
  it('returns complete evidence and all 150 options for a selected product outside the legacy 500-row window', async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async ctx => {
      for (let i = 0; i < 500; i++) await ctx.db.insert('products', fixture);
      return ctx.db.insert('products', { ...fixture, productRevision: 17, cjSourcingStatus: 'approved', cjProductId: 'cj-product', cjSourcingState: 'fulfillment_ready', cjFulfillmentReadiness: 'ready',
        rawSourceDescription: 'Full supplier evidence', rawHtmlDescription: '<p>Dimensions and materials</p>',
        variants: Array.from({ length: 150 }, (_, i) => ({ ...option, id: `option-${i}`, cjVariantId: `vid-${i}`, cjSku: `sku-${i}` })),
        cjVariants: Array.from({ length: 150 }, (_, i) => ({ vid: `vid-${i}`, sku: `sku-${i}`, name: `Provider option ${i}` })),
      });
    });
    expect(await t.query(queue, {})).toEqual([]);
    const selected = await t.query(detail, { id });
    expect(selected).toMatchObject({ productRevision: 17, rawSourceDescription: 'Full supplier evidence', rawHtmlDescription: '<p>Dimensions and materials</p>',
      mappingSummary: { issueCodes: ['READY'], mappedVariantCount: 150, customerVariantCount: 150, cjVariantCount: 150 } });
    expect(selected.variants).toHaveLength(150);
    expect(selected.cjVariants[149].sku).toBe('sku-149');
    await t.run(ctx => ctx.db.patch(id, { productRevision: 18, name: 'Updated chair' }));
    expect(await t.query(detail, { id })).toMatchObject({ productRevision: 18, name: 'Updated chair' });
    vi.mocked(requireCjAdminIdentity).mockRejectedValueOnce(new Error('Unauthorized'));
    await expect(t.query(detail, { id })).rejects.toThrow('Unauthorized');
    await t.run(ctx => ctx.db.delete(id));
    expect(await t.query(detail, { id })).toBeNull();
  });
  it('preserves legacy queue inclusion, issue ordering and sort priority', async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async ctx => {
      const ready = await ctx.db.insert('products', { ...fixture, cjSourcingStatus: 'approved', cjProductId: 'cj', cjSourcingState: 'fulfillment_ready', cjFulfillmentReadiness: 'ready', cjVariants: [{ vid: 'vid', sku: 'sku', name: 'Oak' }], cjVariantId: 'vid', cjSku: 'sku' });
      const pending = await ctx.db.insert('products', { ...fixture, cjSourcingStatus: 'pending', variants: [{ ...option }] });
      const rejected = await ctx.db.insert('products', { ...fixture, cjSourcingStatus: 'rejected' });
      await ctx.db.insert('products', fixture);
      return { ready, pending, rejected };
    });
    const rows = await t.query(queue, {});
    expect(rows.map((row: { _id: string }) => row._id)).toEqual([ids.pending, ids.rejected, ids.ready]);
    for (const row of rows) expect((await t.query(detail, { id: row._id })).mappingSummary).toEqual(row.mappingSummary);
  });
});
