import React from 'react';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Id } from '../convex/_generated/dataModel';

const { split } = vi.hoisted(() => ({ split: vi.fn() }));
vi.mock('convex/react', () => ({ useMutation: () => split }));
vi.mock('./SafeImage', () => ({ SafeImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} /> }));
import { CJProductSplit } from './CJProductSplit';

const product = {
    _id: 'product-1' as Id<'products'>, name: 'Mixed dresses', cjVariants: [
        { vid: 'g90', sku: 'G90', name: 'Green Lace 90cm' },
        { vid: 'g100', sku: 'G100', name: 'Green Lace 100cm' },
        { vid: 'p90', sku: 'P90', name: 'Pink Flowers 90cm' },
    ],
};

describe('CJ product split selection', () => {
    beforeEach(() => { split.mockReset(); });
    afterEach(cleanup);

    it('selects all sizes of a filtered dress and submits only those IDs', async () => {
        split.mockResolvedValue({ productId: 'new-product' });
        render(<CJProductSplit product={product} />);
        fireEvent.click(screen.getByRole('button', { name: 'Separate into its own product' }));
        fireEvent.change(screen.getByLabelText('New product name'), { target: { value: 'Green Lace Dress' } });
        fireEvent.change(screen.getByLabelText('Find a dress or style'), { target: { value: 'Green Lace' } });
        fireEvent.click(screen.getByRole('button', { name: 'Select all shown (2)' }));
        fireEvent.click(screen.getByRole('button', { name: 'Move selected variants to new product' }));
        await waitFor(() => expect(split).toHaveBeenCalledWith({ productId: 'product-1', name: 'Green Lace Dress', selectedVariantIds: ['g90', 'g100'], expectedRevision: 0 }));
        expect(await screen.findByRole('status')).toHaveTextContent('Created “Green Lace Dress” with 2 variants');
    });

    it('prevents moving the entire listing and retains selection after failure', async () => {
        split.mockRejectedValue(new Error('The variants have changed.'));
        render(<CJProductSplit product={product} />);
        fireEvent.click(screen.getByRole('button', { name: 'Separate into its own product' }));
        fireEvent.change(screen.getByLabelText('New product name'), { target: { value: 'Green' } });
        fireEvent.click(screen.getByRole('button', { name: 'Select all shown (3)' }));
        expect(screen.getByRole('button', { name: 'Move selected variants to new product' })).toBeDisabled();
        fireEvent.click(screen.getByRole('checkbox', { name: 'Pink Flowers 90cm P90' }));
        fireEvent.click(screen.getByRole('button', { name: 'Move selected variants to new product' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('The variants have changed.');
        expect(screen.getByRole('checkbox', { name: 'Green Lace 90cm G90' })).toBeChecked();
    });
});
