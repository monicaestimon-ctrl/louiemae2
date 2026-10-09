import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CJVariantManager } from '../CJVariantManager';
import { getFunctionName } from 'convex/server';
import { useQuery } from 'convex/react';

const mocks = vi.hoisted(() => ({
    products: [] as any[],
    save: vi.fn(),
}));

vi.mock('convex/react', () => ({
    useQuery: vi.fn((reference, args) => args === 'skip' ? undefined
        : getFunctionName(reference) === 'products:getAdminVariantDetail'
            ? mocks.products.find(product => product._id === args.id) ?? null : mocks.products),
    useAction: () => vi.fn(),
    useMutation: () => mocks.save,
}));

vi.mock('../FadeIn', () => ({
    FadeIn: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const summary = (issueCodes: string[], overrides: Record<string, number> = {}) => ({
    issueCodes,
    customerVariantCount: 0,
    mappedVariantCount: 0,
    unmappedVariantCount: 0,
    cjVariantCount: 0,
    unmatchedCjVariantCount: 0,
    invalidMappingCount: 0,
    ...overrides,
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.save.mockResolvedValue({ revision: 2, mappedCount: 0, totalVariants: 1, mappingComplete: false });
});

afterEach(cleanup);

describe('CJ product resolution queue', () => {
    it('loads only selected detail and preserves dirty options and their revision across selections', async () => {
        mocks.products = ['first', 'second'].map(id => ({
            _id: id, name: id, images: [], productRevision: 4, cjSourcingStatus: 'pending',
            variants: [{ id: 'size', name: 'Original', priceAdjustment: 0, inStock: true }],
            cjVariants: [], mappingSummary: summary(['CJ_APPROVAL_PENDING']),
        }));
        const view = render(<CJVariantManager detailOnly targetProductId="first" />);
        fireEvent.change(await screen.findByDisplayValue('Original'), { target: { value: 'My draft' } });
        view.rerender(<CJVariantManager detailOnly targetProductId="second" />);
        expect(await screen.findByDisplayValue('Original')).toBeInTheDocument();
        mocks.products[0] = { ...mocks.products[0], productRevision: 5,
            variants: [{ id: 'size', name: 'Concurrent edit', priceAdjustment: 0, inStock: true }] };
        view.rerender(<CJVariantManager detailOnly targetProductId="first" />);
        expect(await screen.findByDisplayValue('My draft')).toBeInTheDocument();
        mocks.save.mockRejectedValueOnce(new Error('Revision conflict'));
        fireEvent.click(screen.getByRole('button', { name: /save customer variants/i }));
        await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
            productId: 'first', expectedRevision: 4,
            variants: [expect.objectContaining({ name: 'My draft' })],
        })));
        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(screen.getByDisplayValue('My draft')).toBeInTheDocument();
        expect(vi.mocked(useQuery).mock.calls.filter(([ref]) => getFunctionName(ref) === 'products:getProductsWithCjVariants')
            .every(([, args]) => args === 'skip')).toBe(true);
    });
    it('does not query detail without a selection and reports deleted products', () => {
        mocks.products = [];
        const view = render(<CJVariantManager detailOnly />);
        expect(vi.mocked(useQuery).mock.calls.every(([, args]) => args === 'skip')).toBe(true);
        view.rerender(<CJVariantManager detailOnly targetProductId="deleted" />);
        expect(screen.getByRole('status')).toHaveTextContent('no longer available');
    });
    it('labels pending products and locks CJ mapping until approval', async () => {
        mocks.products = [{
            _id: 'product_pending',
            name: 'Pending Romper',
            images: [],
            productRevision: 1,
            cjSourcingStatus: 'pending',
            variants: [{ id: 'size_2t', name: '2T', priceAdjustment: 0, inStock: true }],
            cjVariants: [{ vid: 'unconfirmed-vid', sku: 'unconfirmed-sku', name: '2T' }],
            mappingSummary: summary(['CJ_APPROVAL_PENDING', 'UNMAPPED_CUSTOMER_VARIANTS']),
        }];

        render(<CJVariantManager targetProductId="product_pending" />);

        expect(await screen.findByText('Awaiting CJ approval; CJ mapping is locked.')).toBeInTheDocument();
        expect(screen.getByLabelText('CJ fulfillment variant')).toBeDisabled();
        expect(screen.getByRole('button', { name: /apply exact matches/i })).toBeDisabled();
    });

    it('keeps a targeted product editable when CJ returned no variants', async () => {
        mocks.products = [{
            _id: 'product_missing_cj',
            name: 'Willow Onesie',
            images: [],
            productRevision: 4,
            cjSourcingStatus: 'approved',
            variants: [{ id: 'size_2t', name: '2T', priceAdjustment: 0, inStock: true }],
            cjVariants: [],
            mappingSummary: summary(
                ['MISSING_CJ_VARIANTS', 'UNMAPPED_CUSTOMER_VARIANTS'],
                { customerVariantCount: 1, unmappedVariantCount: 1 }
            ),
        }];

        render(<CJVariantManager targetProductId="product_missing_cj" />);

        expect(await screen.findByText('CJ has not returned variants for this product.')).toBeInTheDocument();
        fireEvent.change(screen.getByDisplayValue('2T'), { target: { value: 'Toddler 2T' } });
        fireEvent.click(screen.getByRole('button', { name: /save variants & mappings/i }));

        await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({
            productId: 'product_missing_cj',
            expectedRevision: 4,
            variants: [{ id: 'size_2t', name: 'Toddler 2T', priceAdjustment: 0, inStock: true }],
        }));
    });

    it('creates a customer variant already attached to an unmatched CJ variant', async () => {
        mocks.products = [{
            _id: 'product_missing_customer',
            name: 'Rowan Set',
            images: ['https://example.com/product.jpg'],
            productRevision: 1,
            cjSourcingStatus: 'approved',
            variants: [],
            cjVariants: [{
                vid: 'cj_vid_blue_3t',
                sku: 'CJ-BLUE-3T',
                name: 'Blue / 3T',
                image: 'https://example.com/blue.jpg',
            }],
            mappingSummary: summary(
                ['MISSING_CUSTOMER_VARIANTS'],
                { cjVariantCount: 1, unmatchedCjVariantCount: 1 }
            ),
        }];

        render(<CJVariantManager />);
        fireEvent.click(screen.getByRole('button', { name: /rowan set/i }));
        fireEvent.click(screen.getByRole('button', { name: /create customer variant from blue \/ 3t/i }));

        expect(screen.getByDisplayValue('Blue / 3T')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /save variants & mappings/i }));

        await waitFor(() => {
            expect(mocks.save).toHaveBeenCalledTimes(1);
            expect(mocks.save.mock.calls[0][0]).toMatchObject({
                productId: 'product_missing_customer',
                expectedRevision: 1,
                variants: [{
                    name: 'Blue / 3T',
                    image: 'https://example.com/blue.jpg',
                    priceAdjustment: 0,
                    inStock: true,
                    cjVariantId: 'cj_vid_blue_3t',
                    cjSku: 'CJ-BLUE-3T',
                }],
            });
        });
    });
});
