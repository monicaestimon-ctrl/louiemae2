import React, { Suspense } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useInitialProductDocument } from '../useInitialProductDocument';
const pending = new Promise(() => {});
function Pending(): never { throw pending; }
function Shell({ route }: { route: string }) {
  const hidden = useInitialProductDocument(route);
  return <Suspense fallback={hidden ? null : <p role="status">Loading next page</p>}><Pending /></Suspense>;
}
afterEach(() => { cleanup(); document.getElementById('lm-product-document')?.remove(); document.getElementById('lm-product-structured-data')?.remove(); });
function initial() {
  const main = document.createElement('main'); main.id = 'lm-product-document'; main.dataset.productId = 'fixture'; main.dataset.variantId = ''; document.body.append(main);
  const schema = document.createElement('script'); schema.id = 'lm-product-structured-data'; document.head.append(schema);
}
it('shows pending destination feedback after removing mismatched initial HTML', () => {
  initial();
  const view = render(<Shell route="/products/fixture" />);
  expect(screen.queryByRole('status')).toBeNull();
  view.rerender(<Shell route="shop" />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading next page');
  expect(document.getElementById('lm-product-document')).toBeNull();
  expect(document.getElementById('lm-product-structured-data')).toBeNull();
});
it('also shows pending feedback when ProductPage already completed the handoff', () => {
  initial();
  const view = render(<Shell route="/products/fixture" />);
  document.getElementById('lm-product-document')!.remove();
  document.getElementById('lm-product-structured-data')!.remove();
  view.rerender(<Shell route="shop" />);
  expect(screen.getByRole('status')).toBeInTheDocument();
});
