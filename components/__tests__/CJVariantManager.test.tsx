import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CJVariantManager } from '../CJVariantManager';

const mocks = vi.hoisted(() => ({
    products: [] as any[],
    save: vi.fn(),
}));

vi.mock('convex/react', () => ({
    useQuery: () => mocks.products,
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
