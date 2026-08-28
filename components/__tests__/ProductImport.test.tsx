import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProductImport } from '../ProductImport';

const mocks = vi.hoisted(() => ({ action: vi.fn(), warning: vi.fn(), success: vi.fn(), translate: vi.fn() }));
vi.mock('convex/react', () => ({ useMutation: () => mocks.action, useAction: () => mocks.action, useQuery: () => undefined }));
vi.mock('../FadeIn', () => ({ FadeIn: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('sonner', () => ({ Toaster: () => null, toast: { success: mocks.success, warning: mocks.warning, error: vi.fn() } }));
vi.mock('../../services/translateService', () => ({ detectChinese: (text: string) => /[\u4e00-\u9fff]/.test(text), translateProductFields: mocks.translate }));

const product = (id: string, count: number) => ({
    id, name: `Product ${id}`, description: 'Draft description', price: 10, salePrice: 10,
    originalPrice: 10, images: [], collection: 'kids', targetCollection: 'kids', category: 'Tops',
    selected: true, inStock: true, productUrl: 'https://example.com/product',
    variants: Array.from({ length: count }, (_, index) => ({ id: `${id}-${index}`, name: `${id} variant ${index + 1}`, priceAdjustment: 0, inStock: true })),
});

beforeEach(() => {
    sessionStorage.clear(); localStorage.clear(); vi.clearAllMocks();
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
        mocks.translate.mockResolvedValue({ name: draft.name, description: draft.description, variantNames: ['蓝色'] });
        sessionStorage.setItem('import-search-results', JSON.stringify([draft]));
        render(<ProductImport collections={[]} onImportProducts={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /translate/i }));
        await waitFor(() => expect(mocks.warning).toHaveBeenCalledWith('Some variant labels still need translation', expect.any(Object)));
        expect(mocks.success).not.toHaveBeenCalledWith('Translation complete');
        expect(screen.getByDisplayValue('蓝色')).toBeInTheDocument();
    });
});
