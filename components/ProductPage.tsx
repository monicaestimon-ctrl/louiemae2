import { useEffect, useRef, useState } from 'react';
import { useStorefrontProductDetail } from './useStorefrontProductDetail';
import { SafeImage } from './SafeImage';
import { VariantSelector, NO_IMAGE_KEY } from './VariantSelector';
import { AddToCartButton } from './cart/AddToCartButton';
import ProductDeliveryEstimate from './delivery/ProductDeliveryEstimate';
import { navigatePlainLink } from '../lib/navigation';
import { navigateStorefront, productUrl } from '../lib/storefrontNavigation';

/** Public detail reads current approved data; URL-selected options never substitute another variant. */
export function ProductPage({ id, variantId }: { id: string; variantId?: string }) {
  const { product, loading, failed, retry } = useStorefrontProductDetail(id);
  const [imageSelection, setImageSelection] = useState<{
    key: string;
    value: string | null;
  } | null>(null);
  const selectionKey = `${id}:${variantId ?? ''}`;
  const imageGroup = imageSelection?.key === selectionKey ? imageSelection.value : null;
  const heading = useRef<globalThis.HTMLHeadingElement>(null);
  const requested = product?.variants?.find((option) => option.id === variantId);
  const selected = variantId
    ? requested
    : product?.variants?.length === 1
      ? product.variants[0]
      : undefined;
  const invalidVariant = Boolean(variantId && product && !requested);
  const price = (product?.price ?? 0) + (selected?.priceAdjustment ?? 0);
  const purchasable = Boolean(
    product?.fulfillmentProvider &&
    product.inStock &&
    !invalidVariant &&
    selected?.inStock !== false
  );
  useEffect(() => {
    if (!loading) heading.current?.focus({ preventScroll: true });
  }, [id, loading]);
  useEffect(() => {
    const title = product
      ? `${product.name} | Louie Mae`
      : loading
        ? 'Loading product | Louie Mae'
        : failed
          ? 'Product temporarily unavailable | Louie Mae'
          : 'Product unavailable | Louie Mae';
    const canonical = new URL(productUrl(id), window.location.origin).href;
    document.title = title;
    for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]'])
      document.querySelector(selector)?.setAttribute('content', title);
    for (const selector of [
      'meta[name="description"]',
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
    ])
      document
        .querySelector(selector)
        ?.setAttribute(
          'content',
          product?.description.slice(0, 160) ?? 'Explore the Louie Mae collection.'
        );
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', canonical);
    document.querySelector('meta[property="og:url"]')?.setAttribute('content', canonical);
    for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]'])
      document.querySelector(selector)?.setAttribute('content', product?.images[0] ?? '');
  }, [id, product, loading, failed]);
  const browse = '#shop';
  return (
    <main className="min-h-screen bg-cream text-earth px-6 pt-36 pb-16" aria-busy={loading}>
      <div className="max-w-6xl mx-auto">
        <a
          href={`/${browse}`}
          onClick={(event) => navigatePlainLink(event, browse, navigateStorefront)}
          className="inline-block min-h-11 underline"
        >
          Browse collections
        </a>
        {!product ? (
          <section className="py-12">
            <h1 ref={heading} tabIndex={-1} className="font-serif text-3xl">
              {loading
                ? 'Loading product…'
                : failed
                  ? 'Product temporarily unavailable'
                  : 'Product unavailable'}
            </h1>
            <p role="status" className="mt-4">
              {loading
                ? 'Checking the latest product details.'
                : failed
                  ? 'We could not load this product. Please try again.'
                  : 'This product is not currently available to view or purchase.'}
            </p>
            {failed && (
              <button className="mt-4 min-h-11 underline" onClick={retry}>
                Try again
              </button>
            )}
          </section>
        ) : (
          <div className="grid md:grid-cols-2 gap-8 py-8">
            <SafeImage
              src={
                selected?.image ||
                (imageGroup && imageGroup !== NO_IMAGE_KEY ? imageGroup : product.images[0])
              }
              alt={product.name}
              media={product.imageMedia}
              sizes="(min-width: 768px) 50vw, 100vw"
              loading="eager"
              className="w-full aspect-square object-contain bg-white"
            />
            <section className="min-w-0">
              <p className="text-sm mb-3">{product.category}</p>
              <h1 ref={heading} tabIndex={-1} className="font-serif text-3xl md:text-4xl">
                {product.name}
              </h1>
              <p className="text-2xl my-5">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
                  price
                )}
              </p>
              {invalidVariant && (
                <p role="status" className="mb-4">
                  The linked option is no longer available. Please select an available option.
                </p>
              )}
              {!!product.variants?.length && (
                <VariantSelector
                  variants={product.variants}
                  selectedVariant={selected}
                  activeImageGroupKey={imageGroup}
                  onSetGroupKey={(value) => setImageSelection({ key: selectionKey, value })}
                  onSelectVariant={(option) => {
                    setImageSelection((previous) => ({
                      key: `${id}:${option?.id ?? ''}`,
                      value: option ? null : (previous?.value ?? null),
                    }));
                    navigateStorefront(productUrl(id, option?.id), {
                      replace: true,
                      scroll: false,
                    });
                  }}
                />
              )}
              <p className="my-6 whitespace-pre-line">{product.description}</p>
              <p className="mb-4">
                {purchasable ? 'Available to order' : 'Currently unavailable to order'}
              </p>
              {product.fulfillmentProvider === 'ashcroft' && purchasable && (
                <p className="mb-4">${product.deliveryFee} Economy delivery per item</p>
              )}
              {product.fulfillmentProvider === 'zuo' && (
                <ProductDeliveryEstimate
                  productId={id}
                  variantId={selected?.id}
                  disabledMessage={
                    !purchasable ? 'Select an available option to estimate delivery.' : undefined
                  }
                />
              )}
              <AddToCartButton
                product={product}
                selectedVariant={invalidVariant ? undefined : selected}
                variantRequired={invalidVariant || !!product.variants?.length}
              />
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
