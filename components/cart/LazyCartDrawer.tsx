import { usePrivateIndexing } from '../usePrivateIndexing';
import React, { lazy, Suspense, useState } from 'react';
import { useCart } from '../../contexts/CartContext';
import { loadModule } from '../../lib/moduleRecovery';
import { Modal } from '../Modal';
import { ErrorBoundary } from '../ErrorBoundary';

const Drawer = lazy(() => loadModule(() => import('./CartDrawer')));

function CartLoadState({ failed = false }: { failed?: boolean }) {
  const { isOpen, closeCart } = useCart();
  return (
    <Modal open={isOpen} label="Your cart" onClose={closeCart}>
      <section className="bg-cream text-earth p-6 max-w-md mx-auto" aria-busy={!failed}>
        <h2 className="font-serif text-2xl mb-4">Your cart</h2>
        <p role={failed ? 'alert' : 'status'}>
          {failed
            ? 'Your cart could not be opened. Your saved items are still available after reloading.'
            : 'Opening your cart…'}
        </p>
        <button className="min-h-11 px-4 underline" onClick={closeCart}>
          Close cart
        </button>
        {failed && (
          <button className="min-h-11 px-4 underline" onClick={() => window.location.reload()}>
            Reload page
          </button>
        )}
      </section>
    </Modal>
  );
}

/** Fetch checkout code on first intent, then retain the drawer owner across later closes. */
export function LazyCartDrawer() {
  const { isOpen } = useCart();
  const [opened, setOpened] = useState(false);
  usePrivateIndexing(isOpen);
  // Adjust this component only on the first open, before committing its children.
  if (isOpen && !opened) setOpened(true);
  if (!isOpen && !opened) return null;
  return (
    <ErrorBoundary fallback={<CartLoadState failed />}>
      <Suspense fallback={<CartLoadState />}>
        <Drawer />
      </Suspense>
    </ErrorBoundary>
  );
}
