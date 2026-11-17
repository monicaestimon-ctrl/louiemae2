import React, { lazy, Suspense } from 'react';
import { Modal } from './Modal';
import { ErrorBoundary } from './ErrorBoundary';
import { loadModule } from '../lib/moduleRecovery';
const HomePreview = lazy(() => loadModule(() => import('./HomeProductPreview')));
const CollectionPreview = lazy(() => loadModule(() => import('./CollectionProductPreview')));
function LoadState({ failed = false, onClose }: { failed?: boolean; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6">
      <section className="bg-white rounded-2xl p-8 text-center text-earth">
        <h2 className="font-serif text-2xl mb-4">Product details</h2>
        <p role={failed ? 'alert' : 'status'}>
          {failed
            ? 'Product details could not be opened. Please reload the page to try again.'
            : 'Opening product details…'}
        </p>
        {failed && (
          <button className="min-h-11 px-4 underline" onClick={() => window.location.reload()}>
            Reload page
          </button>
        )}
        <button className="min-h-11 px-4 underline" onClick={onClose}>
          Close product details
        </button>
      </section>
    </div>
  );
}
export function LazyProductPreview({
  productId,
  onClose,
  presentation = 'home',
  collectionTitle = '',
  initialVariantId,
}: {
  productId: string | null;
  onClose: () => void;
  presentation?: 'home' | 'collection';
  collectionTitle?: string;
  initialVariantId?: string;
}) {
  if (!productId) return null;
  const content =
    presentation === 'collection' ? (
      <CollectionPreview
        key={`${productId}:${initialVariantId ?? ''}`}
        productId={productId}
        collectionTitle={collectionTitle}
        initialVariantId={initialVariantId}
        onClose={onClose}
      />
    ) : (
      <HomePreview key={productId} productId={productId} onClose={onClose} />
    );
  return (
    <Modal open label="Product details" onClose={onClose}>
      <ErrorBoundary key={productId} fallback={<LoadState failed onClose={onClose} />}>
        <Suspense fallback={<LoadState onClose={onClose} />}>{content}</Suspense>
      </ErrorBoundary>
    </Modal>
  );
}
