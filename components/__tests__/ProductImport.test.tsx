import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProductImport } from '../ProductImport';
import { getFunctionName } from 'convex/server';

const mocks = vi.hoisted(() => ({ action: vi.fn(), query: vi.fn(), warning: vi.fn(), success: vi.fn() }));
vi.mock('convex/react', () => ({ useMutation: () => mocks.action, useAction: () => mocks.action, useQuery: (...args: unknown[]) => mocks.query(...args) }));
vi.mock('../FadeIn', () => ({ FadeIn: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('sonner', () => ({ Toaster: () => null, toast: { success: mocks.success, warning: mocks.warning, error: vi.fn() } }));
vi.mock('../../services/translateService', () => ({ detectChinese: (text: string) => /[\u4e00-\u9fff]/.test(text) }));

const product = (id: string, count: number) => ({
    id, name: `Product ${id}`, description: 'Draft description', price: 10, salePrice: 10,
    originalPrice: 10, images: [], collection: 'kids', targetCollection: 'kids', category: 'Tops',
    selected: true, inStock: true, productUrl: 'https://example.com/product',
    variants: Array.from({ length: count }, (_, index) => ({ id: `${id}-${index}`, name: `${id} variant ${index + 1}`, priceAdjustment: 0, inStock: true })),
});

beforeEach(() => {
    sessionStorage.clear(); localStorage.clear(); vi.clearAllMocks(); mocks.query.mockReset();
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    sessionStorage.setItem('import-step', 'review');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('variant review pagination', () => {
    it('pages all variants and preserves edits and selections across pages', () => {
        sessionStorage.setItem('import-search-results', JSON.stringify([product('A', 25)]));
        render(<ProductImport collections={[]} onImportProducts={vi.fn()} />);
        expect(screen.getByText('Variants 1-12 of 25')).toBeInTheDocument();
        expect(screen.queryByDisplayValue('A variant 13')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Previous variant page' })).toBeDisabled();
        fireEvent.change(screen.getByDisplayValue('A variant 1'), { target: { value: 'Edited label' } });
        fireEvent.click(screen.getByRole('button', { name: 'Deselect All' }));
        fireEvent.click(screen.getByRole('button', { name: 'Next variant page' }));
        expect(screen.getByDisplayValue('A variant 13')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Next variant page' }));
        expect(screen.getByText('Variants 25-25 of 25')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Next variant page' })).toBeDisabled();
        expect(screen.getByText('Active Variants (0/25)')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Previous variant page' }));
        fireEvent.click(screen.getByRole('button', { name: 'Previous variant page' }));
        expect(screen.getByDisplayValue('Edited label')).toBeInTheDocument();
    }, 30_000);

    it('resets to the first variant page when switching products', () => {
        sessionStorage.setItem('import-search-results', JSON.stringify([product('A', 25), product('B', 13)]));
        render(<ProductImport collections={[]} onImportProducts={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Next variant page' }));
        fireEvent.click(screen.getByRole('button', { name: 'Next Item' }));
        expect(screen.getByText('Variants 1-12 of 13')).toBeInTheDocument();
        expect(screen.getByDisplayValue('B variant 1')).toBeInTheDocument();
    }, 15_000);

    it('does not paginate products with twelve or fewer variants', () => {
        sessionStorage.setItem('import-search-results', JSON.stringify([product('A', 12)]));
        render(<ProductImport collections={[]} onImportProducts={vi.fn()} />);
        expect(screen.queryByRole('navigation', { name: 'Variant review pages' })).not.toBeInTheDocument();
        expect(screen.getByDisplayValue('A variant 12')).toBeInTheDocument();
    });

    it('warns when a translated batch still contains Chinese labels', async () => {
        const draft = product('A', 1);
        draft.variants[0].name = '蓝色';
        mocks.action.mockResolvedValue({ ok: false, partial: true, name: draft.name, description: draft.description, variantNames: ['蓝色'], remainingChinese: 1 });
        sessionStorage.setItem('import-search-results', JSON.stringify([draft]));
        render(<ProductImport collections={[]} onImportProducts={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /translate/i }));
        await waitFor(() => expect(mocks.warning).toHaveBeenCalledWith('Some variant labels still need translation', expect.any(Object)));
        expect(mocks.success).not.toHaveBeenCalledWith('Translation complete');
        expect(screen.getByDisplayValue('蓝色')).toBeInTheDocument();
    });
});

describe('unified add and edit studio modes', () => {
    it('ignores a saved multi-product import position when editing one product', () => {
        sessionStorage.setItem('import-review-index', '7');
        localStorage.setItem('import-draft-review-index', '5');
        sessionStorage.setItem('import-step', 'review');

        render(
            <ProductImport
                mode="edit"
                initialProduct={{
                    id: 'saved-product',
                    name: 'Rowan Onesie',
                    description: 'Soft cotton one-piece.',
                    price: 28,
                    images: [],
                    category: 'One-Pieces',
                    collection: 'kids',
                    variants: [{ id: 'size_2t', name: '2T', priceAdjustment: 0, inStock: true }],
                    subcategoryIds: ['boys-onesies'],
                    primarySubcategoryId: 'boys-onesies',
                }}
                collections={[]}
                onImportProducts={vi.fn()}
                onSaveProduct={vi.fn()}
                onClose={vi.fn()}
            />
        );

        expect(screen.getByText('Product Operations Studio · Edit Product')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Rowan Onesie')).toBeInTheDocument();
        expect(screen.queryByText('Error: Product not found')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /review product/i }));
        expect(screen.getByText('Review Product Changes')).toBeInTheDocument();
        expect(sessionStorage.getItem('import-review-index')).toBe('7');
        expect(sessionStorage.getItem('import-step')).toBe('review');
    });

    it('offers later CJ photos without selecting them over the saved import gallery', () => {
        render(<ProductImport mode="edit" initialProduct={{ id: 'saved', name: 'Green Dress', images: ['import.jpg'],
            cjVariants: [{ vid: 'g90', sku: 'G90', name: 'Green 90cm', image: 'cj.jpg' }] }}
            collections={[]} onImportProducts={vi.fn()} onSaveProduct={vi.fn()} />);
        expect(screen.getByAltText('Product image 1')).toHaveAttribute('src', 'import.jpg');
        expect(screen.getByAltText('Product image 1').closest('[role="button"]')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByAltText('Product image 2')).toHaveAttribute('src', 'cj.jpg');
        expect(screen.getByAltText('Product image 2').closest('[role="button"]')).toHaveAttribute('aria-pressed', 'false');
    });
    it('loads an existing product directly into the same curation workflow used by imports', () => {
        render(
            <ProductImport
                mode="edit"
                initialProduct={{
                    id: 'saved-product',
                    name: 'Rowan Onesie',
                    description: 'Soft cotton one-piece.',
                    price: 28,
                    images: [],
                    category: 'One-Pieces',
                    collection: 'kids',
                    variants: [{ id: 'size_2t', name: '2T', priceAdjustment: 0, inStock: true }],
                    subcategoryIds: ['boys-onesies'],
                    primarySubcategoryId: 'boys-onesies',
                    productRevision: 3,
                }}
                collections={[]}
                onImportProducts={vi.fn()}
                onSaveProduct={vi.fn()}
                onClose={vi.fn()}
            />
        );

        expect(screen.getByText('Product Operations Studio · Edit Product')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Rowan Onesie')).toBeInTheDocument();
        expect(screen.getByDisplayValue('2T')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /add variant/i }));
        expect(screen.getByDisplayValue('Variant 2')).toBeInTheDocument();
    });
});


describe('standalone editor batch isolation', () => {
    const job = { _id: 'other-job', status: 'completed' };
    const rows = [{ _id: 'other-item', status: 'ready', normalizedUrl: 'https://example.com/other',
        result: { source: 'generic', data: { title: 'Unrelated import', price: 15, images: [] } } }];

    it.each(['edit', 'create'] as const)('ignores late batch data and preserves saved import state in %s mode', async (mode) => {
        localStorage.setItem('active-batch-import-job', job._id);
        // Deliberately return cached values even for skipped queries: effects
        // must not merge another workflow or mutate its persistent state.
        mocks.query.mockImplementation((reference) => {
            const name = getFunctionName(reference);
            if (name === 'batchImports:getLatest' || name === 'batchImports:getJob') return job;
            if (name === 'batchImports:getItems') return rows;
            return undefined;
        });
        render(<ProductImport mode={mode} initialProduct={{ id: mode === 'edit' ? 'saved-product' : undefined,
            name: 'Original product', price: 30, images: [], collection: 'kids' }}
            collections={[]} onImportProducts={vi.fn()} onSaveProduct={vi.fn()} />);
        expect(screen.getByDisplayValue('Original product')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Next Item' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /review product/i }));
        expect(screen.getByText(mode === 'edit' ? 'Review Product Changes' : 'Review New Product')).toBeInTheDocument();
        expect(screen.queryByText('Unrelated import')).not.toBeInTheDocument();
        expect(localStorage.getItem('active-batch-import-job')).toBe(job._id);
        expect(mocks.action).not.toHaveBeenCalled();
        const batchCalls = mocks.query.mock.calls.filter(([ref]) => getFunctionName(ref).startsWith('batchImports:'));
        expect(batchCalls.length).toBeGreaterThan(0);
        expect(batchCalls.every(([, args]) => args === 'skip')).toBe(true);
    });

    it('still loads ready batch items when using the import workflow', () => {
        const activeJob = { ...job, status: 'ready' };
        mocks.query.mockImplementation((reference) => {
            const name = getFunctionName(reference);
            if (name === 'batchImports:getLatest' || name === 'batchImports:getJob') return activeJob;
            if (name === 'batchImports:getItems') return rows;
            return undefined;
        });
        render(<ProductImport collections={[]} onImportProducts={vi.fn()} />);
        expect(JSON.parse(sessionStorage.getItem('import-search-results') || '[]')).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Unrelated import', batchItemId: 'other-item' })]));
        expect(localStorage.getItem('active-batch-import-job')).toBe(job._id);
    });
});
