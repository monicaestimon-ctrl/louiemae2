// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { CommerceError, customerMessage } from '../errors';
import { customerFacing, publicDeliveryError } from './publicErrors';
import { assertDeliveryBounds, DELIVERY_BODY_BYTES, readDeliveryJson } from './requestBounds';

describe('delivery public boundary', () => {
  it('retains the safe code but strips internal details and custom/provider text', async () => {
    const privateError = new CommerceError(
      'COST_REVIEW_REQUIRED',
      'Supplier cost fixture $200',
      'private provider message'
    );
    const safe = publicDeliveryError(privateError);
    expect(safe.data).toEqual({
      code: 'COST_REVIEW_REQUIRED',
      message: "This item isn't available to order yet.",
    });
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const unexpected = publicDeliveryError(
        new Error('customer@example.com: provider secret fixture')
      );
      expect(unexpected.data.requestId).toMatch(/^[a-f0-9]{24}$/);
      expect(customerMessage(unexpected)).toContain(`Reference: ${unexpected.data.requestId}`);
      expect(publicDeliveryError(unexpected).data).toEqual(unexpected.data);
      expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/customer@|provider secret/);
      await expect(
        customerFacing(async () => {
          throw privateError;
        })
      ).rejects.toMatchObject({ data: safe.data });
    } finally {
      log.mockRestore();
    }
  });
  it('bounds fields, full UTF-8 body, line counts and quantities before processing', () => {
    const line = { productId: 'p', variantId: 'v', packs: 1 };
    expect(() =>
      assertDeliveryBounds({ lines: Array.from({ length: 30 }, () => line) })
    ).not.toThrow();
    for (const input of [
      { lines: Array.from({ length: 31 }, () => line) },
      { lines: [{ ...line, packs: 10001 }] },
      { lines: [{ ...line, variantId: 'v'.repeat(201) }] },
      { visitorKey: 'x'.repeat(201) },
      {
        address: {
          line1: 'x',
          city: 'x',
          state: 'CA',
          country: 'US',
          postalCode: '95206',
          phone: '1'.repeat(51),
        },
      },
    ])
      expect(() => assertDeliveryBounds(input)).toThrow();
    // The quote path retains all 100 lines; automatic calculation does not silently truncate them.
    expect(() =>
      assertDeliveryBounds({ lines: Array.from({ length: 100 }, () => line) }, 100)
    ).not.toThrow();
    const tooLarge = { lines: [line], clientPrices: 'é'.repeat(DELIVERY_BODY_BYTES) };
    expect(() => assertDeliveryBounds(tooLarge)).toThrow();
    for (const clientPrices of [1n, new globalThis.ArrayBuffer(DELIVERY_BODY_BYTES + 1)]) {
      const nonJson = { lines: [line], clientPrices };
      expect(() => assertDeliveryBounds(nonJson)).toThrow();
    }
  });
  it('enforces actual streamed bytes even when Content-Length is absent or understates them', async () => {
    const request = (body: string, length?: string) =>
      new Request('https://example.test', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(length ? { 'content-length': length } : {}),
        },
        body,
      });
    expect(await readDeliveryJson(request('{"lines":[]}'))).toEqual({ lines: [] });
    for (const length of [undefined, '1'])
      await expect(
        readDeliveryJson(request(JSON.stringify({ data: 'x'.repeat(DELIVERY_BODY_BYTES) }), length))
      ).rejects.toMatchObject({ data: { code: 'INVALID_INPUT' } });
    await expect(readDeliveryJson(request('[]'))).rejects.toThrow();
    await expect(readDeliveryJson(request('{bad'))).rejects.toThrow();
    await expect(
      readDeliveryJson(new Request('https://example.test', { method: 'POST', body: '{}' }))
    ).rejects.toThrow();
  });
  it('times out a stalled request without retaining its body or provider error', async () => {
    vi.useFakeTimers();
    try {
      const request = new Request('https://example.test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: new globalThis.ReadableStream(),
        duplex: 'half',
      } as RequestInit);
      const pending = expect(readDeliveryJson(request)).rejects.toMatchObject({
        data: { code: 'INVALID_INPUT' },
      });
      await vi.advanceTimersByTimeAsync(5001);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });
});
