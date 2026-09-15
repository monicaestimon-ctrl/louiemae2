import { describe, expect, it } from 'vitest';
import { getCjProductStatus } from './cjProductStatus';

describe('getCjProductStatus', () => {
  it('keeps a product with no CJ footprint distinct from approved inventory', () => {
    expect(getCjProductStatus({ variants: [] }).state).toBe('not_linked');
  });

  it('does not treat partial CJ identifiers as approval', () => {
    const result = getCjProductStatus({ cjProductId: 'pid-partial', variants: [] });
    expect(result.state).toBe('attention');
    expect(result.isApproved).toBe(false);
  });

  it.each([
    [{ cjSourcingStatus: 'pending' as const, variants: [] }, 'pending'],
    [{ cjSourcingStatus: 'rejected' as const, variants: [] }, 'rejected'],
  ])('classifies sourcing lifecycle states before mapping state', (product, expected) => {
    expect(getCjProductStatus(product).state).toBe(expected);
  });

  it('keeps an approved product in setup until every sellable variant is mapped', () => {
    const result = getCjProductStatus({
      cjSourcingStatus: 'approved',
      cjSourcingState: 'mapping_required',
      cjFulfillmentReadiness: 'mapping_required',
      cjProductId: 'pid-1',
      cjVariants: [{ vid: 'vid-1', sku: 'sku-1', name: 'Small' }],
      variants: [
        { id: 'small', name: 'Small', priceAdjustment: 0, inStock: true, cjVariantId: 'vid-1', cjSku: 'sku-1' },
        { id: 'large', name: 'Large', priceAdjustment: 0, inStock: true },
      ],
    });
    expect(result.state).toBe('approved_needs_setup');
    expect(result.mappedVariantCount).toBe(1);
    expect(result.sellableVariantCount).toBe(2);
  });

  it('requires approval, catalog linkage, complete mapping, and workflow readiness', () => {
    const result = getCjProductStatus({
      cjSourcingStatus: 'approved',
      cjSourcingState: 'fulfillment_ready',
      cjFulfillmentReadiness: 'ready',
      cjProductId: 'pid-1',
      cjVariants: [{ vid: 'vid-1', sku: 'sku-1', name: 'Small' }],
      variants: [{ id: 'small', name: 'Small', priceAdjustment: 0, inStock: true, cjVariantId: 'vid-1', cjSku: 'sku-1' }],
    });
    expect(result.state).toBe('ready');
  });
});
