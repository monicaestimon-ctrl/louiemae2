import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TrendsiRequestButton } from './TrendsiRequestButton';
import type { Product } from '../types';
const mock = vi.hoisted(() => ({ enabled: true, submit: vi.fn() }));
vi.mock('convex/react', () => ({ useQuery: () => mock.enabled, useMutation: () => mock.submit }));
const product = {
  id: 'product',
  name: 'Annalise Set',
  price: 90,
  variants: [{ id: 'trendsi-7', name: 'Pink / Small', priceAdjustment: 3, inStock: true }],
} as Product;
beforeEach(() => {
  mock.enabled = true;
  mock.submit.mockReset().mockResolvedValue({ number: 'LM-T-EXAMPLE' });
});
it('requires a specific option and respects the launch switch', () => {
  const view = render(<TrendsiRequestButton product={product} />);
  expect(screen.getByRole('button', { name: 'Select a size and color' })).toBeDisabled();
  mock.enabled = false;
  view.rerender(<TrendsiRequestButton product={product} option={product.variants![0]} />);
  expect(screen.getByRole('button', { name: 'Coming Soon' })).toBeDisabled();
});
it('submits exact option and delivery details without taking payment or trusting client prices', async () => {
  render(<TrendsiRequestButton product={product} option={product.variants![0]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Request availability' }));
  for (const [label, value] of [
    ['Full name', 'Test Buyer'],
    ['Email', 'buyer@example.com'],
    ['Delivery street address', '123 Main'],
    ['City', 'Chicago'],
    ['State (two-letter code)', 'il'],
    ['ZIP code', '60601'],
  ]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.submit(
    screen.getByRole('button', { name: 'Send request · no payment yet' }).closest('form')!
  );
  await waitFor(() => expect(screen.getByText('LM-T-EXAMPLE')).toBeInTheDocument());
  expect(mock.submit).toHaveBeenCalledWith(
    expect.objectContaining({
      address: expect.objectContaining({ state: 'IL', country: 'US', postalCode: '60601' }),
      items: [{ productId: 'product', variantId: 'trendsi-7', quantity: 1 }],
    })
  );
  expect(mock.submit.mock.calls[0][0]).not.toHaveProperty('price');
  expect(screen.getByText(/No payment has been taken/)).toBeInTheDocument();
});
