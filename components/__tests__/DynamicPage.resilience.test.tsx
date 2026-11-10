import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DynamicSectionRenderer } from '../DynamicPage';
const state = vi.hoisted(() => ({ loading: false, failed: false }));
vi.mock('../useStorefrontProductDetail', () => ({ useStorefrontProductDetail: () => ({ product: null, ...state, retry: vi.fn() }) }));
afterEach(() => { cleanup(); state.loading = false; state.failed = false; });
it('omits unconfigured and confirmed missing feature records', () => {
  const view = render(<DynamicSectionRenderer section={{ id: 'feature', type: 'product-feature' }} index={0} />);
  expect(view.container).toBeEmptyDOMElement();
  view.rerender(<DynamicSectionRenderer section={{ id: 'feature', type: 'product-feature', productId: 'missing' }} index={0} />);
  expect(view.container).toBeEmptyDOMElement();
});
it('keeps an unavailable configured feature recoverable rather than declaring it missing', () => {
  state.failed = true;
  render(<DynamicSectionRenderer section={{ id: 'feature', type: 'product-feature', productId: 'configured' }} index={0} />);
  expect(screen.getByText('Featured product is temporarily unavailable.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});
