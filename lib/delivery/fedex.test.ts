// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fedexRate, fedexRequest, fedexResponse, type FedexShipment } from './fedex';

const shipment: FedexShipment = {
  originZip: '95206', zip: '10001', rateType: 'ACCOUNT',
  cartons: [{ lengthMm: 610, widthMm: 559, heightMm: 508, grossWeightG: 14969, supplierMethod: 'ground' }],
  rule: { carrier: 'fedex', service: 'ground', effectiveFrom: 0, dimDivisorMm3PerG: 5000,
    ground: { maxLongestMm: 2743, maxLengthPlusGirthMm: 4191, maxWeightG: 68038 },
    ltl: { maxLongestMm: 5000, maxWeightG: 500000, maxCartons: 100 } },
};
const credentials = { key: 'test-key', secret: 'test-secret', account: '123456789' };
const response = (rateType = 'ACCOUNT', totalNetCharge = 123.45, currency = 'USD') => ({ output: {
  rateReplyDetails: [{ serviceType: 'GROUND_HOME_DELIVERY', ratedShipmentDetails: [{ rateType, currency, totalNetCharge }] }],
} });

describe('production FedEx freight adapter', () => {
  it('preserves each carton and packed weight, rounds dimensions upward, and defaults to residential', () => {
    const request = fedexRequest({ ...shipment, cartons: [...shipment.cartons, ...shipment.cartons] }, credentials.account)!;
    expect(request.requestedShipment.totalPackageCount).toBe(2);
    expect(request.requestedShipment.requestedPackageLineItems).toHaveLength(2);
    expect(request.requestedShipment.requestedPackageLineItems[0]).toMatchObject({
      weight: { units: 'KG', value: 14.969 }, dimensions: { units: 'CM', length: 61, width: 56, height: 51 },
    });
    expect(request.requestedShipment.serviceType).toBe('GROUND_HOME_DELIVERY');
  });
  it('retains a full commercial destination and selects ground', () => {
    const request = fedexRequest({ ...shipment, address: {
      recipientName: 'Test', line1: '123 Example Street', city: 'New York', state: 'NY', postalCode: '10001', country: 'US',
      access: { destinationType: 'commercial', requestedService: 'standard', stairs: false, limitedAccess: false, loadingDock: true },
    } }, credentials.account)!;
    expect(request.requestedShipment.serviceType).toBe('FEDEX_GROUND');
    expect(request.requestedShipment.recipient.address).toMatchObject({ residential: false, streetLines: ['123 Example Street'] });
  });
  it.each(['ltl', 'unknown'] as const)('never downgrades supplier method %s', supplierMethod => {
    expect(fedexRequest({ ...shipment, cartons: [{ ...shipment.cartons[0], supplierMethod }] }, credentials.account)).toBeNull();
  });
  it.each(['99501', '96815', '00901', 'bad'])('rejects unsupported destination %s', zip => {
    expect(fedexRequest({ ...shipment, zip }, credentials.account)).toBeNull();
  });
  it('bounds package count and rejects missing or oversize packages', () => {
    for (const cartons of [[], Array(51).fill(shipment.cartons[0]), [{ ...shipment.cartons[0], grossWeightG: 0 }],
      [{ ...shipment.cartons[0], lengthMm: 3000 }]]) {
      expect(fedexRequest({ ...shipment, cartons }, credentials.account)).toBeNull();
    }
  });
  it('uses shipment total once without adding fees, fuel or allowances', () => {
    expect(fedexResponse(response(), 'GROUND_HOME_DELIVERY', 'ACCOUNT')).toMatchObject({ ok: true, freightMinor: 12345 });
  });
  it('rejects virtual, missing, wrong-currency and wrong-rate-basis responses', () => {
    for (const data of [{}, response('LIST'), response('ACCOUNT', 10, 'CAD'), response('ACCOUNT', -1),
      response('ACCOUNT', NaN), { output: { ...response().output, alerts: [{ code: 'VIRTUAL.RESPONSE' }] } }]) {
      expect(fedexResponse(data, 'GROUND_HOME_DELIVERY', 'ACCOUNT').ok).toBe(false);
    }
  });
  it('does not silently choose a duplicate or expedited service', () => {
    const data = response(); data.output.rateReplyDetails.push(...data.output.rateReplyDetails);
    expect(fedexResponse(data, 'GROUND_HOME_DELIVERY', 'ACCOUNT').ok).toBe(false);
    expect(fedexResponse(response(), 'FEDEX_GROUND', 'ACCOUNT').ok).toBe(false);
  });
  it('calls production OAuth and rates with a shared deadline', async () => {
    const transport = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token' })))
      .mockResolvedValueOnce(new Response(JSON.stringify(response())));
    expect(await fedexRate(shipment, credentials, transport)).toMatchObject({ ok: true, freightMinor: 12345 });
    expect(transport.mock.calls[0][0]).toBe('https://apis.fedex.com/oauth/token');
    expect(transport.mock.calls[1][0]).toBe('https://apis.fedex.com/rate/v1/rates/quotes');
    expect(transport.mock.calls[0][1].signal).toBe(transport.mock.calls[1][1].signal);
  });
  it('returns fixed failure reasons without provider payloads or credentials', async () => {
    const transport = vi.fn().mockResolvedValue(new Response('private error', { status: 401 }));
    expect(await fedexRate(shipment, credentials, transport)).toEqual({ ok: false, reason: 'authentication' });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await fedexRate(shipment, credentials, vi.fn().mockRejectedValue(new Error('secret'))))
      .toEqual({ ok: false, reason: 'unavailable' });
  });
  it('does no network work for missing credentials or freight-only cartons', async () => {
    const transport = vi.fn();
    await fedexRate(shipment, { ...credentials, secret: '' }, transport);
    await fedexRate({ ...shipment, cartons: [{ ...shipment.cartons[0], supplierMethod: 'ltl' }] }, credentials, transport);
    expect(transport).not.toHaveBeenCalled();
  });
});
