import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { ProductVariant } from '../types';
import { useStorefrontProductDetail } from './useStorefrontProductDetail';
import { VariantSelector, NO_IMAGE_KEY } from './VariantSelector';
import { AddToCartButton } from './cart/AddToCartButton';
import { SafeImage } from './SafeImage';
import ProductDeliveryEstimate from './delivery/ProductDeliveryEstimate';
/** Preserve collection preview styling and selected-variant behavior behind its own loading boundary. */
export default function CollectionProductPreview({
  productId,
  initialVariantId,
  collectionTitle,
  onClose,
}: {
  productId: string;
  initialVariantId?: string;
  collectionTitle: string;
  onClose: () => void;
}) {
  const {
    product: selectedProduct,
    loading: detailLoading,
    unavailable: detailUnavailable,
    failed: detailFailed,
    retry: retryDetail,
  } = useStorefrontProductDetail(productId);
  const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>(initialVariantId);
  // Price/stock changes and deleted options must not leave a stale cart selection.
  const selectedVariant =
    selectedProduct?.variants?.length === 1
      ? selectedProduct.variants[0]
      : selectedProduct?.variants?.find(
          (variant) => variant.id === selectedVariantId && variant.inStock !== false
        );
  const selectedPrice = (selectedProduct?.price ?? 0) + (selectedVariant?.priceAdjustment ?? 0);
  const setSelectedVariant = (variant: ProductVariant | undefined) =>
    setSelectedVariantId(variant?.id);
  /** Tracks the active image group (color/style) independently from selectedVariant */
  const [activeImageGroupKey, setActiveImageGroupKey] = useState<string | null>(null);

  return (
    <>
      {(detailLoading || detailUnavailable || detailFailed) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-6">
          <div className="rounded-lg bg-cream p-8 text-earth">
            <p role="status">
              {detailLoading
                ? 'Loading product details…'
                : detailFailed
                  ? 'Product details could not be loaded. Please try again.'
                  : 'This product is no longer available.'}
            </p>
            {detailFailed && (
              <button onClick={retryDetail} className="min-h-11 underline">
                Try again
              </button>
            )}
            <button type="button" onClick={onClose} className="mt-5 underline">
              Close
            </button>
          </div>
        </div>
      )}
      {selectedProduct && (
        <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center md:p-8">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>

          <div className="bg-cream w-full max-w-5xl h-[92vh] supports-[height:100svh]:h-[92svh] md:h-auto md:max-h-[85vh] rounded-t-3xl md:rounded-sm shadow-2xl relative flex flex-col md:flex-row overflow-hidden">
            <button
              onClick={onClose}
              aria-label="Close product details"
              className="absolute top-3 right-3 md:top-4 md:right-4 z-20 p-2.5 md:p-2 bg-white/80 md:bg-white/50 hover:bg-white rounded-full shadow-sm md:shadow-none transition-colors"
            >
              <X className="w-5 h-5 text-earth" />
            </button>
            <div className="w-full md:w-1/2 bg-white h-[42%] shrink-0 md:h-auto overflow-hidden relative group">
              <SafeImage
                src={
                  selectedVariant?.image ||
                  (activeImageGroupKey && activeImageGroupKey !== NO_IMAGE_KEY
                    ? activeImageGroupKey
                    : selectedProduct.images[0])
                }
                alt={selectedProduct.name}
                media={selectedProduct.imageMedia}
                sizes="(min-width: 768px) 512px, 100vw"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="w-full md:w-1/2 flex-1 min-h-0 p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:p-10 overflow-y-auto overscroll-contain bg-cream flex flex-col">
              <div className="mb-auto">
                <div className="flex items-center gap-3 mb-4 text-[10px] uppercase tracking-widest text-muted-earth">
                  <span>{collectionTitle}</span>
                  <span className="w-1 h-1 bg-bronze rounded-full"></span>
                  <span>{selectedProduct.category}</span>
                </div>
                <h2 className="font-serif text-2xl md:text-4xl text-earth mb-4 leading-tight">
                  {selectedProduct.name}
                </h2>
                <p className="font-serif text-xl md:text-2xl italic text-bronze mb-6">
                  $
                  {selectedPrice.toLocaleString('en-US', {
                    minimumFractionDigits: Number.isInteger(selectedPrice) ? 0 : 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
                <div className="h-px w-full bg-earth/10 mb-6"></div>

                {/* Variant Selector — Two-tier: Color/Style swatches → Size pills */}
                {selectedProduct.variants && selectedProduct.variants.length > 1 && (
                  <div className="mb-6">
                    <VariantSelector
                      variants={selectedProduct.variants}
                      selectedVariant={selectedVariant}
                      activeImageGroupKey={activeImageGroupKey}
                      onSelectVariant={setSelectedVariant}
                      onSetGroupKey={setActiveImageGroupKey}
                    />
                  </div>
                )}

                <p className="font-sans text-muted-earth leading-relaxed mb-6 text-sm">
                  {selectedProduct.description}
                </p>
                <div className="space-y-3 mb-6">
                  <div className="flex items-center gap-2 text-xs text-green-700">
                    <span className="w-2 h-2 rounded-full bg-green-600"></span>
                    {selectedProduct.fulfillmentProvider && selectedProduct.inStock
                      ? 'Available to order'
                      : 'Coming Soon'}
                  </div>
                </div>
              </div>
              {selectedProduct.fulfillmentProvider === 'ashcroft' && selectedProduct.inStock && (
                <p className="text-sm text-muted-earth">
                  ${selectedProduct.deliveryFee} Economy delivery per item
                </p>
              )}
              {selectedProduct.fulfillmentProvider === 'zuo' && (
                <ProductDeliveryEstimate
                  productId={selectedProduct.id}
                  variantId={selectedVariant?.id ?? selectedProduct.variants?.[0]?.id}
                />
              )}
              <AddToCartButton
                product={selectedProduct}
                selectedVariant={selectedVariant}
                variantRequired={
                  !!(selectedProduct.variants && selectedProduct.variants.length > 0)
                }
                className="mt-6"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
