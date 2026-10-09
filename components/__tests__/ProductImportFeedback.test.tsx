import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConvexError } from 'convex/values';
import { toast } from 'sonner';
import { ProductImport } from '../ProductImport';

vi.mock('convex/react', () => ({ useMutation: () => vi.fn(), useAction: () => vi.fn(), useQuery: () => undefined }));
vi.mock('../FadeIn', () => ({ FadeIn: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../services/translateService', () => ({ detectChinese: () => false }));

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { toast.dismiss(); cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const fixture = { id: 'saved-product', name: 'Hazelquill Cabinet', description: 'Original description', price: 120,
  images: [], collection: 'furniture' as const, category: 'Side Storage Cabinets',
  subcategoryIds: ['side-storage-cabinets'], primarySubcategoryId: 'side-storage-cabinets', productRevision: 1 };

describe('product studio visible save feedback', () => {
  it('shows a revision conflict on final review and preserves the unsaved draft', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onSave = vi.fn().mockRejectedValue(new ConvexError({ code: 'PRODUCT_REVISION_CONFLICT',
      message: 'This product changed after you opened it. Reload the latest version before saving.' }));
    const onClose = vi.fn();
    render(<ProductImport mode="edit" initialProduct={fixture} collections={[]} onImportProducts={vi.fn()} onSaveProduct={onSave} onClose={onClose} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Product description' }), { target: { value: 'My unsaved draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review Product →' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Save Product Changes' })[0]);
    expect(await screen.findByText('Product save stopped')).toBeVisible();
    expect(screen.getByText('This product changed after you opened it. Reload the latest version before saving.')).toBeVisible();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ productRevision: 1, description: 'My unsaved draft' }));
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Save Product Changes' })[0]).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Back to Editing' }));
    expect(screen.getByRole('textbox', { name: 'Product description' })).toHaveValue('My unsaved draft');
    expect(screen.getByText('Product save stopped')).toBeVisible();
  });

  it('shows required-category validation on the create review without calling save', async () => {
    const onSave = vi.fn();
    render(<ProductImport mode="create" initialProduct={{ name: 'Hazelquill Cabinet', price: 120, images: [] }} collections={[]} onImportProducts={vi.fn()} onSaveProduct={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review Product →' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Create Product' })[0]);
    expect(await screen.findByText('Choose a collection and at least one subcategory before saving.')).toBeVisible();
    expect(onSave).not.toHaveBeenCalled();
  });
});
