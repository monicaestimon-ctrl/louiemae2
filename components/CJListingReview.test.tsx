import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('convex/react', () => ({ useQuery: () => null, useAction: () => generate }));
import { CJListingReview } from './CJListingReview';
import { VariantImagePicker } from './VariantImagePicker';

const value = { name: '', description: '', images: ['https://example.com/green.jpg'] };
const variants = [{ name: 'Green Lace 90cm', image: value.images[0] }];
beforeEach(() => { generate.mockReset(); });
afterEach(cleanup);

describe('CJ final listing review', () => {
    it('generates for only the selected style and carries the reserved name to saving', async () => {
        generate.mockResolvedValue({ ok: true, name: 'Celia Lace Dress', claimId: 'claim', ownerKey: 'owner', warnings: [] });
        const change = vi.fn();
        render(<CJListingReview value={value} context={{ category: 'Dresses', collection: 'kids' }} variants={variants} availableImages={['https://example.com/pink.jpg']} onChange={change} newListing />);
        fireEvent.click(screen.getByRole('button', { name: 'Smart Name' }));
        await waitFor(() => expect(change).toHaveBeenCalledWith(expect.objectContaining({ name: 'Celia Lace Dress', pendingNameClaimId: 'claim', nameOwnerKey: 'owner' })));
        const request = generate.mock.calls[0][0].request;
        expect(request.productId).toBeUndefined();
        expect(request.sourceSnapshot.rawTitle).toBe('Green Lace 90cm');
        expect(request.sourceSnapshot.images.map((v: { url: string }) => v.url)).toEqual(value.images);
        expect(JSON.stringify(request.sourceSnapshot)).not.toContain('pink.jpg');
    });

    it('discards a generation result when the selection changes', async () => {
        let finish!: (value: unknown) => void;
        generate.mockReturnValue(new Promise(resolve => { finish = resolve; }));
        const change = vi.fn();
        const props = { value, context: {}, variants, availableImages: [], onChange: change };
        const view = render(<CJListingReview {...props} />);
        fireEvent.click(screen.getByRole('button', { name: 'Smart Name' }));
        view.rerender(<CJListingReview {...props} variants={[{ name: 'Pink 100cm' }]} />);
        await act(async () => finish({ ok: true, name: 'Stale Name' }));
        expect(change).not.toHaveBeenCalled();
    });

    it('keeps generated description audit metadata with the draft', async () => {
        generate.mockResolvedValue({ ok: true, description: 'A green embroidered dress.', auditId: 'audit', fallbackUsed: true, warnings: [], validation: { passed: false }, model: 'actual-model', promptVersion: 'v1', sourceSnapshotHash: 'hash' });
        const change = vi.fn();
        render(<CJListingReview value={value} context={{}} variants={variants} availableImages={[]} onChange={change} />);
        fireEvent.click(screen.getByRole('button', { name: 'Smart Description' }));
        await screen.findByRole('button', { name: 'Use this draft' });
        expect(change).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Use this draft' }));
        await waitFor(() => expect(change).toHaveBeenCalledWith(expect.objectContaining({ description: 'A green embroidered dress.', descriptionSource: 'safe_fallback', smartDescription: expect.objectContaining({ auditId: 'audit', status: 'fallback' }) })));
    });

    it('preserves existing text when generation fails', async () => {
        generate.mockResolvedValue({ ok: false, warnings: [], error: 'Not enough verified facts', validation: { passed: false } });
        const change = vi.fn();
        render(<CJListingReview value={{ ...value, description: 'Existing detailed story' }} context={{}} variants={variants} availableImages={[]} onChange={change} />);
        fireEvent.click(screen.getByRole('button', { name: 'Smart Description' }));
        await screen.findByRole('alert');
        expect(change).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Product description')).toHaveValue('Existing detailed story');
    });

    it('shows both saved and CJ photos and links the selected image explicitly', () => {
        const change = vi.fn();
        render(<VariantImagePicker label="Green 90cm" value="saved.jpg" images={['saved.jpg', 'pink.jpg']} recommended="cj-green.jpg" onChange={change} />);
        fireEvent.click(screen.getByRole('button', { name: 'Choose photo for Green 90cm' }));
        expect(screen.getByRole('button', { name: 'Photo 2 for Green 90cm' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Photo 1 for Green 90cm (CJ match)' }));
        expect(change).toHaveBeenCalledWith('cj-green.jpg');
    });
});
