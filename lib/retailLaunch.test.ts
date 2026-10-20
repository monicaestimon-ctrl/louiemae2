import { describe, expect, it } from 'vitest';
import { launchPrice, retailDelivery, supplierAvailable } from './retailLaunch';

describe('retail freight pricing', () => {
  it.each([
    ['Sofas', 34900, 7900],
    ['Sectionals', 45900, 9900],
    ['Benches', 11900, 2900],
    ['Accent Chairs', 19900, 4900],
    ['Dining Tables', 29900, 7900],
    ['Dining Chairs', 9900, 2900],
    ['Barstools', 9900, 2900],
    ['Counterstools', 9900, 2900],
    ['Stools', 9900, 2900],
    ['Ottomans', 16900, 3900],
    ['Lighting', 4000, 1900],
  ])('covers checked category %s', (category, freight, delivery) => {
    expect(retailDelivery(category as string, '')).toEqual({ freight, delivery });
  });
  it('preserves the approved examples and does not underfund freight', () => {
    expect(launchPrice(224750, 34900, 7900)).toBe(254900);
    expect(launchPrice(46385, 11900, 2900)).toBe(56900);
    expect((launchPrice(100000, 29900, 7900) - 100000 + 7900) * 0.941).toBeGreaterThanOrEqual(
      29900
    );
    expect(retailDelivery('Clothing', 'Dress')).toBeNull();
  });
  it('blocks missing and sold-out supplier listings', () => {
    for (const sku of [undefined, 'DTB04601603', 'STL01200201', 'FLL03701001'])
      expect(supplierAvailable(sku)).toBe(false);
    expect(supplierAvailable('SOF00401401')).toBe(true);
    expect(supplierAvailable('SOF00401401', 'Currently out of stock at the supplier.')).toBe(false);
  });
});
