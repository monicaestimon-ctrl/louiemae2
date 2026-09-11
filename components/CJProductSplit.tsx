import React, { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { SafeImage } from './SafeImage';
import { CJListingReview, type ListingDetails, type ListingContext } from './CJListingReview';
import { VariantImagePicker } from './VariantImagePicker';
import { getUserFacingErrorMessage } from '../lib/errorMessages';

interface Props {
    product: ListingContext & {
        images?: string[];
        sourceSnapshotId?: Id<'productSourceSnapshots'>;
        _id: Id<'products'>;
        name: string;
        productRevision?: number;
        cjVariants?: { vid: string; sku: string; name: string; image?: string }[];
        variants?: { id: string; name: string; image?: string; cjVariantId?: string }[];
    };
    disabled?: boolean;
    onBusyChange?: (busy: boolean) => void;
}

export function CJProductSplit({ product, disabled = false, onBusyChange }: Props) {
    const split = useMutation(api.products.splitCjProduct);
    const [open, setOpen] = useState(false);
    const [filter, setFilter] = useState('');
    const [supplierImages, setSupplierImages] = useState<string[]>([]);
    const [details, setDetails] = useState<ListingDetails>({ name: '', description: '', images: [], sourceSnapshotId: product.sourceSnapshotId, sourceScopeStatus: 'needs_confirmation' });
    const name = details.name;
    const [photoOverrides, setPhotoOverrides] = useState<Record<string, string>>({});
    const [generating, setGenerating] = useState(false);
    const [galleryEdited, setGalleryEdited] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);
    const [customerLinks, setCustomerLinks] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const variants = product.cjVariants ?? [];
    const visible = variants.filter(v => `${v.name} ${v.sku}`.toLowerCase().includes(filter.trim().toLowerCase()));
    const selectedVariants = variants.filter(v => selected.includes(v.vid));
    const optionFor = (vid: string) => product.variants?.find(option => customerLinks[vid] ? option.id === customerLinks[vid] : option.cjVariantId === vid);
    const reviewVariants = selectedVariants.map(v => ({ id: v.vid, cjVariantId: v.vid, supplierName: v.name, name: optionFor(v.vid)?.name || v.name, image: photoOverrides[v.vid] || optionFor(v.vid)?.image || v.image }));
    const reviewDetails = { ...details, images: galleryEdited ? details.images : [...new Set(reviewVariants.flatMap(v => v.image ? [v.image] : []))] };
    const availableImages = [...new Set([...supplierImages, ...(product.images ?? []), ...variants.map(v => v.image), ...(product.variants ?? []).map(v => v.image)].filter((url): url is string => Boolean(url)))];

    async function createListing() {
        setBusy(true);
        onBusyChange?.(true);
        setError('');
        setSuccess('');
        try {
            await split({ productId: product._id, selectedVariantIds: selected, name, expectedRevision: product.productRevision ?? 0, listing: reviewDetails,
                variantImages: selected.flatMap(cjVariantId => photoOverrides[cjVariantId] ? [{ cjVariantId, image: photoOverrides[cjVariantId] }] : []),
                customerLinks: selected.flatMap(cjVariantId => customerLinks[cjVariantId] ? [{ cjVariantId, customerVariantId: customerLinks[cjVariantId] }] : []) });
            setSuccess(`Created “${name.trim()}” with ${selected.length} variants. Find it in Products to review photos, description, and pricing before publishing.`);
            setSelected([]);
            setCustomerLinks({});
            setDetails({ name: '', description: '', images: [], sourceSnapshotId: product.sourceSnapshotId, sourceScopeStatus: 'needs_confirmation' });
            setPhotoOverrides({});
            setGalleryEdited(false);
            setOpen(false);
        } catch (err) {
            setError(getUserFacingErrorMessage(err, 'Could not separate this product. Please try again.'));
        } finally {
            setBusy(false);
            onBusyChange?.(false);
        }
    }

    return <section className="mt-4 rounded-2xl border border-purple-400/30 bg-purple-900/10 p-4 text-cream">
        <button type="button" aria-expanded={open} disabled={busy || disabled} onClick={() => setOpen(value => !value)} className="min-h-11 text-left font-medium text-purple-200 disabled:opacity-40">
            Separate into its own product
        </button>
        <p className="text-sm text-cream/60">Different dresses in one CJ listing? Move one dress and its sizes into a separate listing.</p>
        {disabled && <p className="mt-2 text-sm text-amber-200">Save your variant edits before separating this product.</p>}
        {success && <p role="status" className="mt-3 text-sm text-green-300">{success}</p>}
        {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
        {open && <fieldset disabled={busy || disabled || generating} className="mt-4 space-y-4 min-w-0">
            <label className="block text-sm">Find a dress or style
                <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search Green Lace, Pink Flowers, or SKU" className="mt-1 w-full rounded-lg border border-white/20 bg-black/40 p-3" />
            </label>
            <div className="flex flex-wrap items-center gap-3 text-sm">
                <button type="button" onClick={() => setSelected(ids => [...new Set([...ids, ...visible.map(v => v.vid)])])} className="min-h-11 rounded-lg border border-white/20 px-3">Select all shown ({visible.length})</button>
                <button type="button" onClick={() => setSelected([])} className="min-h-11 px-3">Clear selection</button>
                <span>{selectedVariants.length} of {variants.length} selected</span>
            </div>
            <div className="max-h-80 space-y-2 overflow-y-auto">
                {visible.map(v => <label key={v.vid} className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 p-3">
                    <input type="checkbox" checked={selected.includes(v.vid)} onChange={e => setSelected(ids => e.target.checked ? [...ids, v.vid] : ids.filter(id => id !== v.vid))} className="h-5 w-5 shrink-0" />
                    {v.image && <SafeImage src={v.image} alt="" className="h-16 w-12 shrink-0 rounded object-cover" />}
                    <span className="min-w-0 break-words text-sm">{v.name}{' '}<span className="block text-xs text-cream/50">{v.sku}</span></span>
                </label>)}
                {visible.length === 0 && <p className="text-sm text-cream/60">No matching variants.</p>}
            </div>
            {selectedVariants.length > 0 && <div className="rounded-lg bg-black/30 p-3 text-sm">
                <p className="font-medium">Moving to {name.trim() || 'the new listing'}:</p>
                <p className="mt-2 text-cream/60">If customer labels differ from CJ, choose the matching existing option so it moves with its photo and price. Already mapped options move automatically.</p>
                <div className="mt-2 max-h-80 space-y-3 overflow-y-auto">{selectedVariants.map(v => {
                    const mapped = product.variants?.find(option => option.cjVariantId === v.vid);
                    return <div key={v.vid}>
                        {mapped ? <p>{v.name} — moves “{mapped.name}”</p> : <label className="block">Existing customer option for {v.name}
                            <select value={customerLinks[v.vid] ?? ''} onChange={e => setCustomerLinks(links => ({ ...links, [v.vid]: e.target.value }))} className="mt-1 w-full rounded-lg border border-white/20 bg-black p-3 text-cream">
                                <option value="">Create a new linked option</option>
                                {(product.variants ?? []).filter(option => !option.cjVariantId).map(option => <option key={option.id} value={option.id}
                                    disabled={selected.some(id => id !== v.vid && customerLinks[id] === option.id)}>{option.name}</option>)}
                            </select>
                        </label>}
                        <VariantImagePicker label={v.name} value={photoOverrides[v.vid] || optionFor(v.vid)?.image || v.image} images={[...availableImages, ...reviewDetails.images]} recommended={v.image}
                            onChange={image => setPhotoOverrides(current => ({ ...current, [v.vid]: image }))} />
                    </div>;
                })}</div>
            </div>}
            <CJListingReview onAvailableImages={setSupplierImages} revision={product.productRevision} value={reviewDetails} context={product} variants={reviewVariants} availableImages={[...reviewVariants.flatMap(v => v.image ? [v.image] : []), ...availableImages]}
                onChange={value => { if (value.images !== reviewDetails.images) setGalleryEdited(true); setDetails(value); }} newListing onBusyChange={setGenerating} />
            <p className="text-sm text-cream/60">{selectedVariants.length} variants will move; {variants.length - selectedVariants.length} will remain. Mapped size options move with them. Unmapped CJ options become linked options in the new listing. Leave at least one variant in the original.</p>
            <p className="text-sm text-cream/60">The new listing starts hidden and keeps the original base price. Choose its photos and write or generate its own description here. CJ stock will refresh separately.</p>
            <button type="button" disabled={busy || !name.trim() || selectedVariants.length === 0 || selectedVariants.length >= variants.length} onClick={createListing} className="min-h-11 rounded-xl bg-purple-600 px-4 py-3 font-medium text-white disabled:opacity-40">
                {busy ? 'Separating…' : 'Move selected variants to new product'}
            </button>
        </fieldset>}
    </section>;
}
