export type FurnitureVariant = { id: string; name: string; cost: number; minimum: number; image?: string };
export type FurnitureDraft = {
  name: string;
  category: string;
  description: string;
  images: string[];
  sourceUrl: string;
  supplierKey: string;
  supplierName: string;
  supplierContact: string;
  currency: string;
  usdRate: number;
  variants: FurnitureVariant[];
  dimensions: string;
  materials: string;
  packaging: string;
  supplierNotes: string;
  imagePermission: boolean;
  published: boolean;
};
export const categories = ['Chairs', 'Stools', 'Tables', 'Sofas', 'Storage', 'Other furniture'];
export const blankFurniture = (): FurnitureDraft => ({
  name: '',
  category: 'Chairs',
  description: '',
  images: [],
  sourceUrl: '',
  supplierKey: '',
  supplierName: '',
  supplierContact: '',
  currency: 'USD',
  usdRate: 1,
  variants: [{ id: 'standard', name: 'Standard', cost: 0, minimum: 1 }],
  dimensions: '',
  materials: '',
  packaging: '',
  supplierNotes: '',
  imagePermission: false,
  published: false,
});
export function estimate(cost: number, rate: number) {
  const upper = Math.round(cost * rate * 6 * 100) / 100;
  return { lower: Math.max(0, Math.round((upper - 100) * 100) / 100), upper };
}
export function validateFurniture(p: FurnitureDraft) {
  if (!p.name.trim() || p.name.length > 200 || !categories.includes(p.category))
    throw new Error('Enter a product name and furniture category.');
  if (p.description.length > 8000 || p.supplierNotes.length > 8000 || p.packaging.length > 8000)
    throw new Error('Please shorten the product notes.');
  if (!Number.isFinite(p.usdRate) || p.usdRate <= 0 || p.usdRate > 10000)
    throw new Error('Enter the USD value of one source currency unit.');
  if (!/^[A-Z]{3}$/.test(p.currency) || (p.currency === 'USD' && p.usdRate !== 1))
    throw new Error('Use a three-letter currency code; USD conversion must be 1.');
  if (
    !p.variants.length ||
    p.variants.length > 100 ||
    new Set(p.variants.map((v) => v.id)).size !== p.variants.length
  )
    throw new Error('Use 1–100 distinct variants.');
  for (const v of p.variants) {
    if (
      !v.id ||
      !v.name.trim() ||
      v.name.length > 300 ||
      !Number.isFinite(v.cost) ||
      v.cost < 0 ||
      v.cost > 1000000 ||
      !Number.isInteger(v.minimum) ||
      v.minimum < 1 ||
      v.minimum > 9999
    )
      throw new Error('Check variant names, costs and minimum quantities.');
    if (p.published && estimate(v.cost, p.usdRate).lower <= 0)
      throw new Error('Every published variant needs a source cost producing a positive estimate.');
  }
  if (
    p.images.length > 24 ||
    p.images.some((url) => !/^https:\/\//i.test(url) || url.length > 2048)
  )
    throw new Error('Use up to 24 HTTPS image URLs.');
  if (p.published && (!p.images.length || !p.imagePermission || !p.description.trim()))
    throw new Error(
      'Publishing requires an image, image-use permission and a reviewed description.'
    );
}
export const money = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(n);
export const range = (low: number, high: number) => `${money(low)}–${money(high)}`;
export function publicFurniture(p: FurnitureDraft & { _id: string }) {
  return {
    id: p._id,
    name: p.name,
    category: p.category,
    description: p.description,
    images: p.images,
    dimensions: p.dimensions,
    materials: p.materials,
    variants: p.variants.map((v) => ({
      id: v.id,
      name: v.name,
      minimum: v.minimum,
      ...estimate(v.cost, p.usdRate),
    })),
  };
}
export type PublicFurniture = ReturnType<typeof publicFurniture>;
export function supplierInquiry(p: FurnitureDraft) {
  return `Hello ${p.supplierName || 'there'},\n\nI represent House of Louie Mae, a U.S. furniture business. We are reviewing ${p.name} (${p.sourceUrl || 'details attached'}) for customer projects. This is an inquiry, not a purchase commitment.\n\nPlease confirm:\n• Current unit prices, currency, quantity tiers, MOQ by finish and mixed-variant allowance.\n• Stock, production/customization time and payment terms.\n${p.dimensions ? '' : '• Product dimensions, materials and assembly instructions.\n'}${p.packaging ? '• Whether the recorded packaging measurements remain accurate.\n' : '• Exact outer dimensions, gross weights, contents and photos for EVERY export carton/crate; stackability and packaging charges.\n'}• Commercial-use suitability, supporting reports, warranty and replacement terms.\n• Factory pickup address, export capability, Incoterm/named place and quote validity.\n${p.imagePermission ? '' : '• Written permission to use your product images on our website.\n'}• Whether our forwarder can collect and our inspector can check before shipment.\n\nThank you,\nHouse of Louie Mae`;
}
