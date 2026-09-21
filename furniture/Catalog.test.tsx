import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
const submit = vi.hoisted(() => vi.fn(async (_request: { items: unknown[] }) => 'saved-reference123'));
vi.mock('convex/react', () => ({ usePaginatedQuery: () => ({ results: [], status: 'Exhausted', loadMore: vi.fn() }), useMutation: () => submit, useQuery: () => [{ id: 'product', name: 'Walnut Chair', category: 'Chairs', description: 'A walnut chair.', images: ['https://example.com/chair.jpg'], materials: 'Walnut', dimensions: '80 cm', variants: [{ id: 'oak', name: 'Natural', minimum: 2, lower: 500, upper: 600 }] }] }));
import { FurnitureCatalog } from './Catalog';
beforeEach(() => {
  localStorage.clear(); submit.mockClear();
  Object.defineProperty(window.HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } });
  Object.defineProperty(window.HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; } });
});
describe('furniture browsing and quote form', () => {
  it('adds the selected variant at its MOQ and saves a request without client prices', async () => {
    render(<FurnitureCatalog />);
    fireEvent.click(screen.getByRole('button', { name: /Walnut Chair.*Discover/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to my quote' }));
    expect(screen.getByRole('spinbutton', { name: 'Quantity for Walnut Chair' })).toHaveValue(2);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('$1,000.00–$1,200.00')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Test Customer' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText('Full delivery address, including ZIP and country'), { target: { value: '123 Main Street, Austin TX 78701 USA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request my final quote' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][0].items).toEqual([{ productId: 'product', variantId: 'oak', quantity: 2 }]);
    await waitFor(() => expect(screen.getByText('Request received')).toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem('house-of-louie-mae-quote-v1') || '[]')).toEqual([]);
  });
});
