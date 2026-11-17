export const STOREFRONT_ORIGIN = 'https://louiemae.com';
export const canonicalProductUrl = (id: string) => `${STOREFRONT_ORIGIN}/products/${encodeURIComponent(id)}`;

export function publicProductImage(value: string) {
  try {
    if (/^https:\/\//.test(value)) return new URL(value).protocol === 'https:' ? value : '';
    if (!/^\/(?!\/)/.test(value)) return '';
    return new URL(value, STOREFRONT_ORIGIN).origin === STOREFRONT_ORIGIN ? value : '';
  } catch { return ''; }
}

type MetadataProduct = {
  name: string; description: string; price: number; images: string[]; inStock?: boolean;
  variants?: { id: string; image?: string; priceAdjustment?: number; inStock?: boolean }[];
};

/** Same public metadata contract for the initial document and current client result. */
export function productStructuredData(id: string, product: MetadataProduct, variantId?: string) {
  const selected = variantId ? product.variants?.find(variant => variant.id === variantId)
    : product.variants?.length === 1 ? product.variants[0] : undefined;
  if (variantId && !selected) return null;
  const price = product.price + (selected?.priceAdjustment ?? 0);
  if (!Number.isFinite(price) || price < 0) return null;
  const image = publicProductImage(selected?.image || product.images[0] || '');
  const url = canonicalProductUrl(id);
  return {
    '@context': 'https://schema.org', '@type': 'Product', name: product.name,
    description: product.description, image: image ? [image] : [], url,
    ...(!product.variants?.length || selected ? { offers: {
      '@type': 'Offer', priceCurrency: 'USD', price,
      availability: product.inStock === true && selected?.inStock !== false ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', url,
    } } : {}),
  };
}
