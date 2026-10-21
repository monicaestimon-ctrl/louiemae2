import { describe, expect, it } from 'vitest';
import { deliveryCents, freightFor } from './holmDelivery';

describe('House of Louie Mae delivery', () => {
  it('charges one flat fee per order, tiered by subtotal', () => {
    expect(deliveryCents(0)).toBe(0);
    expect(deliveryCents(450_00)).toBe(49_00);
    expect(deliveryCents(999_99)).toBe(49_00);
    expect(deliveryCents(1_000_00)).toBe(79_00);
    expect(deliveryCents(2_500_00)).toBe(99_00);
    expect(deliveryCents(5_000_00)).toBe(129_99);
    expect(deliveryCents(10_000_00)).toBe(149_99);
    expect(deliveryCents(25_000_00)).toBe(199_99);
    expect(deliveryCents(120_000_00)).toBe(199_99);
  });

  it('looks up supplier freight by SKU prefix', () => {
    expect(freightFor('SOF01500101')).toEqual({ cents: 349_00, known: true });
    expect(freightFor('dtb00100101')).toEqual({ cents: 299_00, known: true });
    expect(freightFor('OTT00301101')).toEqual({ cents: 169_00, known: true });
    expect(freightFor('XYZ123')).toEqual({ cents: 199_00, known: false });
    expect(freightFor('')).toEqual({ cents: 199_00, known: false });
  });
});
