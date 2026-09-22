import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  page: {
    results: [
      {
        id: 'product',
        name: 'Sunday Chair',
        description: 'A quiet form in walnut.',
        facts: 'Height: 80 cm',
        images: ['https://example.com/chair.jpg'],
        variants: [{ id: 'walnut', name: 'Walnut', minimum: 2, increment: 2, price: 25000 }],
      },
    ],
    status: 'Exhausted',
    loadMore: vi.fn(),
  },
}));
vi.mock('convex/react', () => ({
  usePaginatedQuery: () => mocks.page,
  useMutation: () => mocks.submit,
}));
import { CommerceCatalog } from './CommerceCatalog';
beforeEach(() => {
  mocks.submit.mockReset().mockResolvedValue('request');
});
describe('shared customer quote flow', () => {
  it('submits selected variant and quantity without trusting browser prices or supplier mappings', async () => {
    render(<CommerceCatalog channel="house" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add to quote' }));
    expect(screen.getByRole('spinbutton', { name: 'Quantity' })).toHaveValue(2);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Quantity' }), {
      target: { value: '4' },
    });
    for (const [name, value] of [
      ['Your name', 'Customer'],
      ['Email', 'customer@example.com'],
      ['Phone', '5551234567'],
      ['Delivery address', '123 Main St'],
      ['City', 'Austin'],
      ['Postal code', '78701'],
    ])
      fireEvent.change(screen.getByLabelText(name), { target: { value } });
    fireEvent.submit(screen.getByRole('button', { name: 'Request my quote' }).closest('form')!);
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect(mocks.submit.mock.calls[0][0].items).toEqual([
      { productId: 'product', variantId: 'walnut', quantity: 4 },
    ]);
    expect(mocks.submit.mock.calls[0][0].channel).toBe('house');
    await waitFor(() => expect(screen.getByText(/Your request is saved/)).toBeInTheDocument());
  });
  it('retains the selection when saving fails and reuses its request token on retry', async () => {
    mocks.submit.mockRejectedValueOnce(new Error('Please retry'));
    render(<CommerceCatalog channel="retail" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add to quote' }));
    const form = screen.getByRole('button', { name: 'Request my quote' }).closest('form')!;
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText('Please retry')).toBeInTheDocument());
    expect(screen.getByRole('spinbutton', { name: 'Quantity' })).toHaveValue(2);
    fireEvent.submit(form);
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(mocks.submit.mock.calls[0][0].token).toBe(mocks.submit.mock.calls[1][0].token);
  });
});

it('automatically crosses empty filtered pages and stops when exhausted', () => {
  const saved = mocks.page.results;
  mocks.page.results = [];
  mocks.page.status = 'CanLoadMore';
  mocks.page.loadMore.mockClear();
  const view = render(<CommerceCatalog channel="retail" />);
  expect(mocks.page.loadMore).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status')).toHaveTextContent('Gathering');
  expect(screen.queryByRole('button', { name: 'Explore more' })).not.toBeInTheDocument();
  mocks.page.status = 'LoadingMore';
  view.rerender(<CommerceCatalog channel="retail" />);
  expect(mocks.page.loadMore).toHaveBeenCalledTimes(1);
  mocks.page.status = 'CanLoadMore';
  view.rerender(<CommerceCatalog channel="retail" />);
  expect(mocks.page.loadMore).toHaveBeenCalledTimes(2);
  mocks.page.status = 'Exhausted';
  view.rerender(<CommerceCatalog channel="retail" />);
  expect(mocks.page.loadMore).toHaveBeenCalledTimes(2);
  expect(view.container).toBeEmptyDOMElement();
  mocks.page.results = saved;
});
