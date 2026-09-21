export type Provider = 'cj' | 'ashcroft' | 'owner_managed';
export type Channel = 'retail' | 'house';
export type CommerceVariant = {
  id: string;
  name: string;
  sku: string;
  image?: string;
  cost: number;
  minimum: number;
  increment: number;
  retail: number;
  commercial: number;
  cjVariantId?: string;
  cjSku?: string;
};
export type CommerceDraft = {
  name: string;
  description: string;
  category: string;
  images: string[];
  referenceImages: string[];
  sourceUrl: string;
  supplierName: string;
  supplierContact: string;
  facts: string;
  packaging: string;
  currency: string;
  usdRate: number;
  variants: CommerceVariant[];
  conflicts: string[];
  factsApproved: boolean;
  imagesApproved: boolean;
  referencePermission: boolean;
};
export const providerLabels: Record<Provider, string> = {
  cj: 'CJ fulfillment',
  ashcroft: 'Ashcroft · manual dealer order',
  owner_managed: 'Owner-managed logistics',
};
export function allowsChannel(provider: Provider, channel: Channel) {
  return provider !== 'owner_managed' || channel === 'house';
}
export function sourceIdentity(raw: string, provider: Provider) {
  const url = new URL(raw.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    throw new Error('Use a secure supplier product URL.');
  url.hash = '';
  // Preserve item identity carried in query parameters; remove tracking only.
  for (const key of [...url.searchParams.keys()])
    if (!['id', 'itemId', 'item_id', 'offerId'].includes(key)) url.searchParams.delete(key);
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  if (
    provider === 'owner_managed' &&
    (url.hostname === 'ashcroftfurniture.com' ||
      url.hostname.endsWith('.cjdropshipping.com') ||
      url.hostname === 'cjdropshipping.com')
  )
    throw new Error('Use the Ashcroft or CJ import workflow for this fulfillment provider.');
  if (provider === 'ashcroft') {
    url.search = '';
    if (url.hostname !== 'ashcroftfurniture.com')
      throw new Error('Use an Ashcroft Furniture product URL.');
    const match = url.pathname.match(/(?:^|\/)products\/([^/]+)\/?$/);
    if (!match) throw new Error('Use an individual Ashcroft product, not a collection.');
    url.pathname = `/products/${match[1]}`;
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return `${provider}:${url.toString()}`;
}
export function cents(value: number, label = 'Price') {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100_000_000)
    throw new Error(`${label} must be valid cents.`);
  return value;
}
export function priceFromCost(
  cost: number,
  rate: number,
  method: 'markup' | 'margin',
  percent: number
) {
  if (
    !Number.isFinite(cost) ||
    cost < 0 ||
    !Number.isFinite(rate) ||
    rate <= 0 ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    (method === 'margin' && percent >= 100)
  )
    throw new Error('Check cost, exchange rate and pricing percentage.');
  return cents(
    Math.round(
      cost * rate * 100 * (method === 'markup' ? 1 + percent / 100 : 1 / (1 - percent / 100))
    )
  );
}
/** House starting merchandise estimate in USD cents. Final quote discounts are owner-reviewed. */
export function houseEstimateFromCost(cost: number, usdRate: number): number {
  if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(usdRate) || usdRate <= 0)
    throw new Error(
      'Enter a positive supplier cost and confirmed USD conversion for every variant.'
    );
  const usdCents = cents(Math.round(cost * usdRate * 100), 'Converted supplier cost');
  if (!usdCents) throw new Error('Converted supplier cost must be at least one cent.');
  // Each floor preserves the preceding band's upper-bound estimate, avoiding downward jumps.
  const [multiplier, floor] =
    usdCents <= 5000
      ? [6, 0]
      : usdCents <= 7500
        ? [4.5, 30000]
        : usdCents < 17500
          ? [4, 33750]
          : usdCents < 25000
            ? [3, 70000]
            : [2, 75000];
  return cents(Math.max(floor, Math.round(usdCents * multiplier)));
}
export function applyHouseEstimates(draft: CommerceDraft): CommerceDraft {
  return {
    ...draft,
    variants: draft.variants.map((v) => ({
      ...v,
      commercial: houseEstimateFromCost(v.cost, draft.usdRate),
    })),
  };
}
export function checkQuantity(
  quantity: number,
  variant: Pick<CommerceVariant, 'minimum' | 'increment'>
) {
  if (
    !Number.isSafeInteger(quantity) ||
    quantity < variant.minimum ||
    quantity > 9999 ||
    (quantity - variant.minimum) % variant.increment !== 0
  )
    throw new Error('Check the quantity, minimum and order increment.');
}
export function validateDraft(d: CommerceDraft, publish = false) {
  if (
    !d.name.trim() ||
    d.name.length > 200 ||
    d.description.length > 8000 ||
    d.facts.length > 12000 ||
    d.packaging.length > 8000 ||
    d.supplierContact.length > 2000
  )
    throw new Error('Check the product name and details.');
  if (
    !d.variants.length ||
    d.variants.length > 100 ||
    new Set(d.variants.map((v) => v.id)).size !== d.variants.length
  )
    throw new Error('Use 1–100 unique variants.');
  if (
    !/^[A-Z]{3}$/.test(d.currency) ||
    !Number.isFinite(d.usdRate) ||
    d.usdRate < 0 ||
    (d.currency === 'USD' && d.usdRate !== 1)
  )
    throw new Error('Check the source currency and USD conversion.');
  for (const image of [...d.images, ...d.referenceImages]) {
    const u = new URL(image);
    if (u.protocol !== 'https:' || u.username || u.password || image.length > 2048)
      throw new Error('Use HTTPS image URLs.');
  }
  if (d.images.length > 24 || d.referenceImages.length > 24)
    throw new Error('Use up to 24 images per gallery.');
  for (const v of d.variants) {
    if (v.image) {
      const image = new URL(v.image);
      if (image.protocol !== 'https:' || image.username || image.password || v.image.length > 2048)
        throw new Error('Use an HTTPS variant image.');
    }
    if (
      !v.id ||
      v.id.length > 200 ||
      !v.name.trim() ||
      v.name.length > 300 ||
      !Number.isFinite(v.cost) ||
      v.cost < 0 ||
      !Number.isSafeInteger(v.minimum) ||
      v.minimum < 1 ||
      v.minimum > 9999 ||
      !Number.isSafeInteger(v.increment) ||
      v.increment < 1 ||
      v.increment > 9999
    )
      throw new Error('Check variant identity, cost, minimum and increment.');
    cents(v.retail);
    cents(v.commercial);
  }
  if (
    publish &&
    (!d.description.trim() ||
      !d.category.trim() ||
      !d.images.length ||
      !d.factsApproved ||
      !d.imagesApproved ||
      d.conflicts.length)
  )
    throw new Error(
      'Approve details and listing images, choose a category and resolve source conflicts before publishing.'
    );
}
export type ListingSnapshot = {
  name: string;
  description: string;
  category: string;
  images: string[];
  facts: string;
  variants: {
    id: string;
    name: string;
    image?: string;
    minimum: number;
    increment: number;
    price: number;
  }[];
};
export function listingSnapshot(
  draft: CommerceDraft,
  provider: Provider,
  channel: Channel
): ListingSnapshot {
  if (!allowsChannel(provider, channel))
    throw new Error('Owner-managed products can only publish to House.');
  validateDraft(draft, true);
  if (
    provider === 'ashcroft' &&
    [...draft.images, ...draft.variants.map((v) => v.image).filter(Boolean)].some((url) =>
      draft.referenceImages.includes(url!)
    )
  )
    throw new Error(
      'Ashcroft source photos are references only. Use reviewed original listing images.'
    );
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    category: draft.category,
    images: [...draft.images],
    facts: draft.facts,
    variants: draft.variants.map((v) => {
      const price = channel === 'retail' ? v.retail : v.commercial;
      if (price <= 0) throw new Error(`Set a ${channel} estimate for ${v.name}.`);
      return {
        id: v.id,
        name: v.name,
        ...(v.image ? { image: v.image } : {}),
        minimum: v.minimum,
        increment: v.increment,
        price,
      };
    }),
  };
}
export function blankCommerceDraft(): CommerceDraft {
  return {
    name: '',
    description: '',
    category: '',
    images: [],
    referenceImages: [],
    sourceUrl: '',
    supplierName: '',
    supplierContact: '',
    facts: '',
    packaging: '',
    currency: 'USD',
    usdRate: 1,
    variants: [
      {
        id: 'standard',
        name: 'Standard',
        sku: '',
        cost: 0,
        minimum: 1,
        increment: 1,
        retail: 0,
        commercial: 0,
      },
    ],
    conflicts: [],
    factsApproved: false,
    imagesApproved: false,
    referencePermission: false,
  };
}
export function totalLines(
  lines: { quantity: number; unitPrice: number }[],
  delivery: number,
  tax: number
) {
  cents(delivery);
  cents(tax);
  let sum = delivery + tax;
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 9999)
      throw new Error('Invalid quantity.');
    sum += cents(line.unitPrice) * line.quantity;
  }
  return cents(sum, 'Total');
}
