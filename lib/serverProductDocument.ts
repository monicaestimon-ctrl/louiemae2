import { responsiveImage } from './responsiveImage.js';
import { canonicalProductUrl, publicProductImage, productStructuredData } from './productMetadata.js';

export type PublicProductDocument = {
  _id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  images: string[];
  inStock?: boolean;
  variants?: {
    id: string;
    name: string;
    image?: string;
    priceAdjustment?: number;
    inStock?: boolean;
  }[];
};
export const PRODUCT_IMAGE_SIZES =
  '(min-width: 1200px) 560px, (min-width: 768px) calc((100vw - 80px) / 2), calc(100vw - 48px)';
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );

/** Only public query fields enter the document; no private cost or account state. */
export function productDocument(
  template: string,
  product: PublicProductDocument,
  variantId?: string
) {
  const selected = variantId
    ? product.variants?.find((v) => v.id === variantId)
    : product.variants?.length === 1
      ? product.variants[0]
      : undefined;
  if (variantId && !selected) return null;
  const title = `${product.name} | Louie Mae`;
  const canonical = canonicalProductUrl(product._id);
  const description = product.description.slice(0, 160);
  const source = publicProductImage(selected?.image || product.images[0] || '');
  const image = responsiveImage(source, PRODUCT_IMAGE_SIZES);
  const price = product.price + (selected?.priceAdjustment ?? 0);
  if (!Number.isFinite(price) || price < 0) throw new Error('Invalid public product price');
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    price
  );
  const stock = product.inStock === true && selected?.inStock !== false;
  const img = source
    ? `<img src="${escapeHtml(image.src)}" ${image.srcSet ? `srcset="${escapeHtml(image.srcSet)}" sizes="${PRODUCT_IMAGE_SIZES}"` : ''} alt="${escapeHtml(product.name)}" fetchpriority="high" loading="eager" decoding="async" class="w-full aspect-square object-contain bg-white"/>`
    : '';
  const content = `<main id="lm-product-document" data-product-id="${escapeHtml(product._id)}" data-variant-id="${escapeHtml(variantId ?? '')}" tabindex="-1" class="font-sans min-h-screen bg-cream text-earth px-6 pt-36 pb-16"><div class="max-w-6xl mx-auto"><a href="/#shop" class="inline-block min-h-11 underline">Browse collections</a><div class="grid md:grid-cols-2 gap-8 py-8">${img}<section class="min-w-0"><p class="text-sm mb-3">${escapeHtml(product.category)}</p><h1 class="font-serif text-3xl md:text-4xl">${escapeHtml(product.name)}</h1><p class="text-2xl my-5">${money}</p>${selected ? `<p>${escapeHtml(selected.name)}</p>` : ''}<p class="whitespace-pre-line my-5">${escapeHtml(product.description)}</p><p>${stock ? 'Available to order' : 'Currently unavailable'}</p><p role="status" class="mt-4">Loading current options and delivery details…</p><noscript><p>Enable JavaScript to select options and purchase. You can also <a href="/#support/contact">contact us for assistance</a>.</p></noscript></section></div></div></main>`;
  if (!template.includes('<!--product-document-->'))
    throw new Error('Product document template marker missing');
  let html = template.replace(
    /<title>[\s\S]*?<\/title>/,
    () => `<title>${escapeHtml(title)}</title>`
  );
  html = html.replace(/<!--home-document-start-->[\s\S]*?<!--home-document-end-->/, '');
  if (source) {
    // Evaluate responsive candidates after the viewport metadata, including on mobile.
    html = html.replace('</head>', () => `<link rel="preload" as="image" href="${escapeHtml(image.src)}" ${image.srcSet ? `imagesrcset="${escapeHtml(image.srcSet)}" imagesizes="${PRODUCT_IMAGE_SIZES}"` : ''} fetchpriority="high"/></head>`);
  }
  const tags: Record<string, string> = {
    description,
    'og:title': title,
    'twitter:title': title,
    'og:description': description,
    'twitter:description': description,
    'og:url': canonical,
    'og:image': source,
    'twitter:image': source,
    'og:type': 'product',
  };
  for (const [name, value] of Object.entries(tags)) {
    const re = new RegExp(`<meta (?:name|property)="${name}"[^>]*>`, 'g');
    html = html.replace(
      re,
      () =>
        `<meta ${name.startsWith('og:') ? 'property' : 'name'}="${name}" content="${escapeHtml(value)}"/>`
    );
  }
  html = html.replace(/<meta property="og:image:(?:width|height)"[^>]*>/g, '');
  html = html.replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${canonical}"/>`);
  const structured = JSON.stringify(productStructuredData(product._id, product, variantId)).replace(/</g, '\\u003c');
  html = html.replace(
    '</head>',
    () =>
      `<style>#lm-product-document{position:absolute;inset:0 0 auto;z-index:1}#lm-product-document~#root{visibility:hidden}</style><script id="lm-product-structured-data" type="application/ld+json">${structured}</script></head>`
  );
  return html.replace('<!--product-document-->', () => content);
}
