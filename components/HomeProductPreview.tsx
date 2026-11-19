import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { ProductVariant } from '../types';
import { useStorefrontProductDetail } from './useStorefrontProductDetail';
import { VariantSelector, NO_IMAGE_KEY } from './VariantSelector';
import { AddToCartButton } from './cart/AddToCartButton';
import { SafeImage } from './SafeImage';
import ProductDeliveryEstimate from './delivery/ProductDeliveryEstimate';

/** Product details and ordering tools load only after a visitor opens a recommendation. */
export default function HomeProductPreview({
  productId,
  onClose,
}: {
  productId: string;
  onClose: () => void;
}) {
  const {
    product: selectedProduct,
    loading: detailLoading,
    unavailable: detailUnavailable,
    failed: detailFailed,
    retry: retryDetail,
  } = useStorefrontProductDetail(productId);
  const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>();
  const [activeImageGroupKey, setActiveImageGroupKey] = useState<string | null>(null);
  const selectedVariant =
    selectedProduct?.variants?.length === 1
      ? selectedProduct.variants[0]
      : selectedProduct?.variants?.find(
          (variant) => variant.id === selectedVariantId && variant.inStock !== false
        );
  const selectedPrice = (selectedProduct?.price ?? 0) + (selectedVariant?.priceAdjustment ?? 0);
  const setSelectedVariant = (variant: ProductVariant | undefined) =>
    setSelectedVariantId(variant?.id);
  return (
    <>
      {(detailLoading || detailUnavailable || detailFailed) && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6">
          <div className="bg-white rounded-2xl p-8 text-center">
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
            <button onClick={onClose} className="mt-4 underline">
              Close
            </button>
          </div>
        </div>
      )}
      {/* Product Modal - Frosted Glass Upgrade */}
      {selectedProduct && (
        <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center md:p-8">
          <div
            className="absolute inset-0 backdrop-blur-xl motion-reduce:backdrop-blur-none bg-black/50"
            onClick={onClose}
          ></div>

          <div className="bg-white/95 backdrop-blur-xl w-full max-w-5xl h-[92vh] supports-[height:100svh]:h-[92svh] md:h-auto md:max-h-[85vh] rounded-t-3xl md:rounded-3xl shadow-[0_30px_60px_rgba(0,0,0,0.3)] relative flex flex-col md:flex-row overflow-hidden border border-white/60">
            <button
              onClick={onClose}
              aria-label="Close product details"
              className="absolute top-3 right-3 md:top-4 md:right-4 z-20 p-2.5 md:p-2 bg-white/80 md:bg-black/5 hover:bg-black/10 rounded-full shadow-sm md:shadow-none transition-colors backdrop-blur-md"
            >
              <X className="w-5 h-5 text-earth" />
            </button>

            {/* Image Gallery */}
            <div className="w-full md:w-1/2 bg-earth/5 h-[42%] shrink-0 md:h-auto overflow-hidden relative group">
              <SafeImage
                src={
                  selectedVariant?.image ||
                  (activeImageGroupKey && activeImageGroupKey !== NO_IMAGE_KEY
                    ? activeImageGroupKey
                    : selectedProduct.images[0])
                }
                media={selectedProduct.imageMedia}
                sizes="(min-width: 768px) 512px, 100vw"
                alt={selectedProduct.name}
                className="w-full h-full object-contain"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent pointer-events-none" />
            </div>

            {/* Details */}
            <div className="w-full md:w-1/2 flex-1 min-h-0 p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:p-12 overflow-y-auto overscroll-contain flex flex-col relative bg-gradient-to-br from-white/40 to-white/10">
              <div className="mb-auto relative z-10">
                <div className="flex items-center gap-3 mb-6 text-[10px] uppercase tracking-[0.2em] text-muted-earth font-medium">
                  <span className="w-1.5 h-1.5 bg-bronze rounded-full shadow-[0_0_8px_rgba(139,90,43,0.5)]"></span>
                  <span>{selectedProduct.category}</span>
                </div>

                <h2 className="font-serif text-3xl md:text-5xl text-earth mb-3 leading-tight drop-shadow-sm">
                  {selectedProduct.name}
                </h2>
                <p className="font-serif text-2xl italic text-bronze mb-8">
                  $
                  {selectedPrice.toLocaleString('en-US', {
                    minimumFractionDigits: Number.isInteger(selectedPrice) ? 0 : 2,
                    maximumFractionDigits: 2,
                  })}
                </p>

                <div className="h-px w-full bg-gradient-to-r from-earth/20 via-earth/5 to-transparent mb-8"></div>

                {(selectedProduct.variants?.length ?? 0) > 1 && (
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
                <p className="font-sans text-muted-earth leading-relaxed mb-8 text-sm">
                  {selectedProduct.description}
                </p>

                <div className="space-y-4 mb-8">
                  <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50/50 backdrop-blur-sm px-4 py-2 rounded-lg border border-green-100/50 max-w-max">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-600 animate-pulse"></span>
                    {selectedProduct.variants?.some(option => option.id.startsWith('trendsi-')) ? 'Availability confirmed by our team' : selectedProduct.fulfillmentProvider && selectedProduct.inStock
                      ? 'Available to order'
                      : 'Coming Soon'}
                  </div>
                </div>
              </div>

              <div className="relative z-10 mt-8">
                {selectedProduct.fulfillmentProvider === 'ashcroft' && selectedProduct.inStock && (
                  <p className="text-sm text-muted-earth mb-3">
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
                  key={selectedProduct.id}
                  product={selectedProduct}
                  selectedVariant={selectedVariant}
                  variantRequired={!!selectedProduct.variants?.length}
                  className="rounded-lg shadow-xl"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
