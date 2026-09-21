import { blankCommerceDraft, type CommerceDraft } from './commerce';
export function plainSupplierText(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .trim();
}
type ShopifyProduct = {
  id: number;
  title: string;
  body_html?: string;
  description?: string;
  vendor?: string;
  images: (string | { src: string })[];
  variants: {
    id: number;
    title: string;
    sku?: string;
    price?: string;
    featured_image?: { src: string };
  }[];
};
/** Accept only the product-specific JSON response, never page-wide recommendation images/prices. */
export function ashcroftDraft(value: unknown, url: string, html?: string): CommerceDraft {
  const input = value as { product?: ShopifyProduct };
  const product = input?.product;
  if (
    !product?.id ||
    !product.title ||
    !Array.isArray(product.images) ||
    !Array.isArray(product.variants) ||
    !product.variants.length
  )
    throw new Error(
      'Ashcroft did not return a product record. Enter product details manually or try again.'
    );
  const description = plainSupplierText(product.body_html || product.description || '').slice(
    0,
    8000
  );
  const panels = new Map<string, string>();
  if (html)
    for (const match of html.matchAll(
      /<label\b[^>]*class=["'][^"']*\btab-label\b[^"']*["'][^>]*>\s*(Features|Shipping Dimensions)\s*<\/label>\s*<div\b[^>]*class=["'][^"']*\btab-panel\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi
    ))
      panels.set(match[1].toLowerCase(), plainSupplierText(match[2]));
  const right = /right[ -]facing/i.test(product.title);
  const left = /left[ -]facing/i.test(product.title);
  const conflicts =
    (right && /left[ -]facing/i.test(description)) || (left && /right[ -]facing/i.test(description))
      ? [
          'The supplier title and description disagree about chaise orientation. Confirm with Ashcroft.',
        ]
      : [];
  return {
    ...blankCommerceDraft(),
    name: product.title,
    description,
    facts: (panels.get('features') || description).slice(0, 12000),
    packaging: (panels.get('shipping dimensions') || '').slice(0, 8000),
    sourceUrl: url,
    supplierName: product.vendor || 'Ashcroft',
    referenceImages: [
      ...new Set(
        product.images
          .map((i) => (typeof i === 'string' ? i : i.src))
          .filter((s) => s?.startsWith('https://'))
      ),
    ].slice(0, 24),
    conflicts,
    variants: product.variants.slice(0, 100).map((v) => ({
      id: String(v.id),
      name: v.title || 'Standard',
      sku: v.sku || '',
      cost: 0,
      minimum: 1,
      increment: 1,
      retail: 0,
      commercial: 0,
    })),
  };
}
