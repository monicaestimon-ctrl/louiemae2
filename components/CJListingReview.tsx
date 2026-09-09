import React, { useRef, useState } from 'react';
import { useAction } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import type { Product } from '../types';
import { buildSourceProductSnapshot } from '../lib/smartDescription';
import { getUserFacingErrorMessage } from '../lib/errorMessages';
import { SafeImage } from './SafeImage';

export type ListingDetails = Pick<Product, 'name' | 'description' | 'images' | 'smartDescription' | 'descriptionSource' | 'pendingNameClaimId' | 'nameOwnerKey'>;
export type ListingContext = Partial<Pick<Product, 'price' | 'category' | 'collection' | 'audience' | 'subcategoryIds' | 'sourceUrl'>>;

export function CJListingReview({ value, context, variants, availableImages, onChange, productId, newListing = false, onBusyChange }: {
    value: ListingDetails; context: ListingContext; variants: { name: string; image?: string }[];
    availableImages: string[]; onChange: (value: ListingDetails) => void; productId?: Id<'products'>;
    newListing?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
    const generateName = useAction(api.smartNames.generateSmartName);
    const generateDescription = useAction(api.smartDescriptions.generateSmartDescription);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const latest = useRef('');
    // Ignore responses after a selection or draft change, including changes outside this editor.
    const signature = JSON.stringify({ value, variants, context });
    latest.current = signature;
    async function generate(kind: 'name' | 'description') {
        setBusy(kind); setError(''); onBusyChange?.(true);
        try {
            const sourceSnapshot = buildSourceProductSnapshot({
                price: context.price, category: context.category, collection: context.collection, sourceUrl: context.sourceUrl,
                name: value.name || variants.map(v => v.name).join(', '),
                description: value.description, rawDescription: value.description,
                images: value.images, variants, currency: 'USD',
                categoryHints: { selectedCategory: context.category, selectedCollection: context.collection,
                    selectedSubcategoryIds: context.subcategoryIds, audience: context.audience, selectionSource: 'admin' },
            });
            const request = { productId, ownerKey: value.nameOwnerKey, sourceSnapshot,
                adminContext: { selectedCategory: context.category, selectedCollection: context.collection,
                    selectedSubcategoryIds: context.subcategoryIds, audience: context.audience },
                generationMode: 'manual_generate', options: { allowImageAnalysis: true, forceFreshVariation: true, allowSeoKeywords: true } };
            if (kind === 'name') {
                const result = await generateName({ request });
                if (!result.ok || !result.name) throw new Error(result.error || 'Could not generate a name.');
                if (latest.current !== signature) return;
                onChange({ ...value, name: result.name, pendingNameClaimId: result.claimId as Id<'productNameClaims'>, nameOwnerKey: result.ownerKey });
            } else {
                const result = await generateDescription({ request });
                if (!result.ok || !result.description || !result.auditId) throw new Error(result.error || 'Could not generate a description.');
                if (latest.current !== signature) return;
                onChange({ ...value, description: result.description, descriptionSource: 'ai_generated', smartDescription: {
                    description: result.description, auditId: result.auditId as Id<'descriptionAudits'>, generatedAt: Date.now(),
                    model: 'server-configured', promptVersion: 'smart-description-v2.0.0', sourceSnapshotHash: 'pending-link',
                    adminEdited: false, status: result.fallbackUsed ? 'fallback' : 'generated',
                } });
            }
        } catch (err) { setError(getUserFacingErrorMessage(err, 'Generation failed. You can edit the listing manually.')); }
        finally { setBusy(''); onBusyChange?.(false); }
    }
    const images = [...new Set([...value.images, ...availableImages])];
    return <fieldset disabled={Boolean(busy)} className="my-4 min-w-0 space-y-3 rounded-xl border border-purple-400/20 p-4">
        <legend className="px-2 text-cream">{newListing ? 'Review the new listing' : 'Final listing review'}</legend>
        <p className="text-sm text-cream/60">Review the name, story, photos, and each variant before publishing. Smart tools use the photos and variants selected for this listing.</p>
        <label className="block text-sm text-cream">{newListing ? 'New product name' : 'Product name'}
            <input value={value.name} onChange={e => onChange({ ...value, name: e.target.value, pendingNameClaimId: undefined, nameOwnerKey: undefined })} className="mt-1 w-full rounded-lg border border-white/20 bg-black/40 p-3" />
        </label>
        <button type="button" onClick={() => generate('name')} className="min-h-11 rounded-lg border border-purple-400/40 px-3 text-purple-200">{busy === 'name' ? 'Generating name…' : 'Smart Name'}</button>
        <label className="block text-sm text-cream">Product description
            <textarea rows={5} value={value.description} onChange={e => onChange({ ...value, description: e.target.value,
                descriptionSource: value.smartDescription ? 'ai_generated_admin_edited' : 'admin_written',
                smartDescription: value.smartDescription ? { ...value.smartDescription, adminEdited: true, status: 'edited' } : undefined })} className="mt-1 w-full rounded-lg border border-white/20 bg-black/40 p-3" />
        </label>
        <button type="button" onClick={() => generate('description')} className="min-h-11 rounded-lg border border-purple-400/40 px-3 text-purple-200">{busy === 'description' ? 'Generating description…' : 'Smart Description'}</button>
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <p className="text-sm text-cream/60">Listing photos — select the photos to include. The first selected photo is the main image.</p>
        <div className="flex max-h-72 flex-wrap gap-2 overflow-auto">{images.map((url, index) => <button key={url} type="button" aria-label={`Listing photo ${index + 1}`} aria-pressed={value.images.includes(url)}
            onClick={() => onChange({ ...value, images: value.images.includes(url) ? value.images.filter(image => image !== url) : [...value.images, url] })}
            className={`w-24 rounded-lg border-2 p-1 ${value.images.includes(url) ? 'border-purple-400' : 'border-white/10'}`}>
            <SafeImage src={url} alt="" className="h-24 w-full rounded object-cover" />
            <span className="text-xs text-cream">{value.images[0] === url ? 'Main image' : value.images.includes(url) ? 'Selected' : 'Include'}</span>
        </button>)}</div>
    </fieldset>;
}
