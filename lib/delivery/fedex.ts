import { classify, type CarrierRule, type CartonIn } from '../shipping/classify';
import { quoteOnlyReasons, type AddressIn } from './destination';

/** Carrier freight only. Supplier fees, reserve and embedded allowance belong to the shared engine. */
export type FedexShipment = {
  originZip: string;
  zip: string;
  address?: AddressIn;
  cartons: CartonIn[];
  rule: CarrierRule;
  rateType: 'ACCOUNT' | 'LIST';
};
export type FedexResult =
  | { ok: true; freightMinor: number; service: string; rateType: 'ACCOUNT' | 'LIST'; transactionId?: string }
  | { ok: false; reason: 'unsupported' | 'configuration' | 'authentication' | 'unavailable' | 'invalid_response' };
export type FedexCredentials = { key: string; secret: string; account: string };

export function fedexRequest(shipment: FedexShipment, account: string) {
  if (!/^\d{5}$/.test(shipment.originZip) || !account.trim() ||
      quoteOnlyReasons(shipment.zip, shipment.address).length ||
      shipment.cartons.length > 50 ||
      classify(shipment.cartons, shipment.rule).mode !== 'ground') return null;
  const residential = shipment.address?.access?.destinationType !== 'commercial';
  return {
    accountNumber: { value: account },
    requestedShipment: {
      shipper: { address: { postalCode: shipment.originZip, countryCode: 'US' } },
      recipient: { address: {
        postalCode: shipment.zip.trim(), countryCode: 'US', residential,
        ...(shipment.address ? {
          streetLines: [shipment.address.line1, ...(shipment.address.line2 ? [shipment.address.line2] : [])],
          city: shipment.address.city, stateOrProvinceCode: shipment.address.state,
        } : {}),
      } },
      serviceType: residential ? 'GROUND_HOME_DELIVERY' : 'FEDEX_GROUND',
      pickupType: 'USE_SCHEDULED_PICKUP', packagingType: 'YOUR_PACKAGING',
      rateRequestType: [shipment.rateType], totalPackageCount: shipment.cartons.length,
      requestedPackageLineItems: shipment.cartons.map((c, i) => ({
        sequenceNumber: i + 1, groupPackageCount: 1,
        weight: { units: 'KG', value: c.grossWeightG / 1000 },
        dimensions: { units: 'CM', length: Math.ceil(c.lengthMm / 10), width: Math.ceil(c.widthMm / 10), height: Math.ceil(c.heightMm / 10) },
      })),
    },
  };
}

type RateResponse = {
  transactionId?: string;
  errors?: unknown[];
  output?: { alerts?: { code?: string }[]; rateReplyDetails?: {
    serviceType?: string;
    ratedShipmentDetails?: { rateType?: string; currency?: string; totalNetCharge?: number }[];
  }[] };
};
export function fedexResponse(data: RateResponse, service: string, rateType: 'ACCOUNT' | 'LIST'): FedexResult {
  if (data.errors?.length || data.output?.alerts?.some(a => a.code === 'VIRTUAL.RESPONSE'))
    return { ok: false, reason: 'invalid_response' };
  const rates = (data.output?.rateReplyDetails ?? []).filter(r => r.serviceType === service)
    .flatMap(r => r.ratedShipmentDetails ?? []).filter(r => r.rateType === rateType && r.currency === 'USD');
  if (rates.length !== 1 || typeof rates[0].totalNetCharge !== 'number' || !Number.isFinite(rates[0].totalNetCharge))
    return { ok: false, reason: 'invalid_response' };
  const freightMinor = Math.round(rates[0].totalNetCharge * 100);
  if (!Number.isSafeInteger(freightMinor) || freightMinor <= 0 || freightMinor > 100_000_000)
    return { ok: false, reason: 'invalid_response' };
  return { ok: true, freightMinor, service, rateType,
    ...(typeof data.transactionId === 'string' ? { transactionId: data.transactionId } : {}) };
}

/** Production endpoint only; bounded requests and fixed failure reasons, never raw provider errors. */
export async function fedexRate(
  shipment: FedexShipment,
  credentials: FedexCredentials,
  transport: typeof fetch = fetch,
): Promise<FedexResult> {
  if (![credentials.key, credentials.secret, credentials.account].every(v => v.trim()))
    return { ok: false, reason: 'configuration' };
  const request = fedexRequest(shipment, credentials.account);
  if (!request) return { ok: false, reason: 'unsupported' };
  const signal = globalThis.AbortSignal.timeout(8000);
  try {
    const auth = await transport('https://apis.fedex.com/oauth/token', {
      method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: credentials.key, client_secret: credentials.secret }),
    });
    if (!auth.ok) return { ok: false, reason: auth.status >= 500 ? 'unavailable' : 'authentication' };
    const token = await auth.json() as { access_token?: string };
    if (!token.access_token) return { ok: false, reason: 'authentication' };
    const response = await transport('https://apis.fedex.com/rate/v1/rates/quotes', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'X-locale': 'en_US', Authorization: `Bearer ${token.access_token}` },
      body: JSON.stringify(request),
    });
    if (!response.ok) return { ok: false, reason: 'unavailable' };
    return fedexResponse(await response.json(), request.requestedShipment.serviceType, shipment.rateType);
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
