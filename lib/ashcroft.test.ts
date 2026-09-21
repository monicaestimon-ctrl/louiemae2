import { describe, it, expect } from 'vitest';
import { ashcroftDraft } from './ashcroft';
describe('Ashcroft exact-product extraction', () => {
  it('extracts features and shipping panels separately from product copy and recommendations', () => {
    const d = ashcroftDraft(
      {
        product: {
          id: 1,
          title: 'Lore',
          body_html: '<p>A tan sectional.</p>',
          images: [],
          variants: [{ id: 2, title: 'Tan' }],
        },
      },
      'https://ashcroftfurniture.com/products/lore',
      '<label class="tab-label" for="tab-1">Features</label><div class="tab-panel" tabindex="0"><ul><li>General Dimensions: 32.5 H x 106.1 W x 61.4 D</li><li>Upholstery: Genuine Leather</li></ul></div><label class="tab-label">Shipping Dimensions</label><div class="tab-panel"><p>Box: 70 x 40 x 30</p></div><h2>You may also like</h2><p>Unrelated sofa</p>'
    );
    expect(d.facts).toContain('106.1');
    expect(d.facts).toContain('Genuine Leather');
    expect(d.facts).not.toContain('Unrelated');
    expect(d.packaging).toContain('70 x 40 x 30');
    expect(d.description).toBe('A tan sectional.');
  });
  it('keeps references private, does not trust public price as dealer cost, and flags orientation disagreement', () => {
    const d = ashcroftDraft(
      {
        product: {
          id: 1,
          title: 'Lore right-facing sectional',
          body_html: '<p>A left-facing sofa.</p><script>evil()</script>',
          images: [{ src: 'https://cdn.example.com/lore.jpg' }],
          variants: [{ id: 2, title: 'Tan', sku: 'SEC00401302', price: '1049.00' }],
        },
      },
      'https://ashcroftfurniture.com/products/lore'
    );
    expect(d.images).toEqual([]);
    expect(d.referenceImages).toHaveLength(1);
    expect(d.variants[0].sku).toBe('SEC00401302');
    expect(d.variants[0].cost).toBe(0);
    expect(d.conflicts).toHaveLength(1);
    expect(d.description).not.toContain('evil');
    expect(d.factsApproved).toBe(false);
  });
});
