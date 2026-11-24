// Destination scope (spec S17, v2 §9). The initial automatic scope is the 50 states excluding
// Alaska and Hawaii; those, PO boxes, APO/FPO, territories and unsupported addresses go to quote.

export const US_STATES = new Set(
  'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(
    ' '
  )
);

const ZIP = /^\d{5}(-\d{4})?$/;

/** State or territory for a ZIP by its 3-digit prefix, for the ranges the scope rules need. */
export function zipRegion(
  zip: string
): 'AK' | 'HI' | 'PR' | 'VI' | 'GU' | 'MILITARY' | 'CONUS' | null {
  if (!ZIP.test(zip.trim())) return null;
  const p = Number(zip.trim().slice(0, 3));
  if (p >= 995 && p <= 999) return 'AK';
  if (p >= 967 && p <= 968) return 'HI';
  if (p === 6 || p === 7 || p === 9) return 'PR';
  if (p === 8) return 'VI';
  if (p === 969) return 'GU';
  if ((p >= 90 && p <= 98) || p === 340 || (p >= 962 && p <= 966)) return 'MILITARY';
  if (p < 5) return null; // unassigned ranges
  return 'CONUS';
}

export type AddressIn = {
  recipientName?: string;
  access?: DeliveryAccess;
  phone?: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type DeliveryAccess = {
  destinationType: 'residential' | 'commercial';
  requestedService: 'standard' | 'inside' | 'white_glove' | 'expedited';
  stairs: boolean;
  limitedAccess: boolean;
  loadingDock: boolean;
};
export const STANDARD_ACCESS: DeliveryAccess = {
  destinationType: 'residential',
  requestedService: 'standard',
  stairs: false,
  limitedAccess: false,
  loadingDock: false,
};

/** Reasons an address must use the quote flow instead of an automatic estimate. */
export function quoteOnlyReasons(zip: string, address?: AddressIn): string[] {
  const r: string[] = [];
  const region = zipRegion(zip);
  if (!region) r.push('ZIP code not recognised');
  else if (region !== 'CONUS')
    r.push(
      region === 'AK' || region === 'HI'
        ? 'Alaska and Hawaii need a delivery quote'
        : 'Territories and military addresses need a delivery quote'
    );
  if (address) {
    if (!address.recipientName?.trim() || address.recipientName.length > 150)
      r.push('Delivery recipient name required');
    if (!address.access) r.push('Confirm delivery location and access requirements');
    else if (
      address.access.requestedService !== 'standard' ||
      address.access.stairs ||
      address.access.limitedAccess
    )
      r.push('Special delivery service or access requires a confirmed quote');
    if (
      !address.line1.trim() ||
      !address.city.trim() ||
      !US_STATES.has(address.state) ||
      [address.line1, address.line2 ?? '', address.city].some((s) => s.length > 200)
    )
      r.push('Complete delivery address required');
    if (address.state === 'AK' || address.state === 'HI')
      r.push('Alaska and Hawaii need a delivery quote');
    if (address.country !== 'US') r.push('Delivery is within the United States');
    if (/\b(p\.?\s*o\.?\s*box|post office box)\b/i.test(`${address.line1} ${address.line2 ?? ''}`))
      r.push('PO boxes need a delivery quote');
    if (/^(AA|AE|AP)$/i.test(address.state)) r.push('APO/FPO addresses need a delivery quote');
    if (address.postalCode.trim().slice(0, 5) !== zip.trim().slice(0, 5))
      r.push('Address ZIP does not match the estimate');
  }
  return r;
}

/** Stable hash input for an address (lowercased, trimmed), so any change invalidates an estimate. */
export const addressKey = (a: AddressIn) =>
  JSON.stringify({
    fields: [
      a.recipientName ?? '',
      a.line1,
      a.line2 ?? '',
      a.city,
      a.state,
      a.postalCode,
      a.country,
      a.phone ?? '',
    ].map((x) => x.trim().toLowerCase()),
    access: a.access
      ? [
          a.access.destinationType,
          a.access.requestedService,
          a.access.stairs,
          a.access.limitedAccess,
          a.access.loadingDock,
        ]
      : null,
  });
