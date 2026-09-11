import React from 'react';
import { DetailsAndStory, type CopyDraft } from './product/DetailsAndStory';
import { useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import type { Product } from '../types';
import { SafeImage } from './SafeImage';

export type ListingDetails = CopyDraft & Pick<Product, 'images'>;
export type ListingContext = Partial<Pick<Product, 'price' | 'category' | 'collection' | 'audience' | 'subcategoryIds' | 'sourceUrl' | 'subcategory' | 'sourceScopeStatus'>>;

export function CJListingReview({ value, context, variants, availableImages, onChange, productId, newListing = false, onBusyChange, revision, onAvailableImages }: {
    value: ListingDetails; context: ListingContext; variants: { name: string; image?: string }[];
    availableImages: string[]; onChange: (value: ListingDetails) => void; productId?: Id<'products'>;
    onAvailableImages?: (images: string[]) => void; revision?: number; newListing?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
    const source = useQuery(api.productSources.preview, value.sourceSnapshotId ? { id: value.sourceSnapshotId } : 'skip');
    const sourceImages = [...(source?.snapshot?.images ?? []), ...(source?.snapshot?.descriptionImages ?? [])].map((image: { url: string }) => image.url);
    const images = [...new Set([...value.images, ...availableImages, ...sourceImages])];
    return <fieldset className="my-4 min-w-0 space-y-3 rounded-xl border border-purple-400/20 p-4">
        <legend className="px-2 text-cream">{newListing ? 'Review the new listing' : 'Final listing review'}</legend>
        <p className="text-sm text-cream/60">Review the name, story, photos, and each variant before publishing. Smart tools use the photos and variants selected for this listing.</p>
        <DetailsAndStory onAvailableImages={onAvailableImages} value={value} context={{ sourceUrl: context.sourceUrl, price: context.price, category: context.category, collection: context.collection, audience: context.audience, subcategory: context.subcategory, subcategoryIds: context.subcategoryIds }} productId={productId} revision={revision} selection={{ images: value.images, variants, subset: newListing || value.sourceScopeStatus === 'needs_confirmation' || value.sourceScopeStatus === 'confirmed_subset' || context.sourceScopeStatus === 'needs_confirmation' || context.sourceScopeStatus === 'confirmed_subset', evidence: value.sourceEvidenceOverrides }}
            onChange={copy => onChange({ ...value, ...copy })} newListing={newListing} dark onBusyChange={onBusyChange} />
        <p className="text-sm text-cream/60">Listing photos — select the photos to include. The first selected photo is the main image.</p>
        <div className="flex max-h-72 flex-wrap gap-2 overflow-auto">{images.map((url, index) => <button key={url} type="button" aria-label={`Listing photo ${index + 1}`} aria-pressed={value.images.includes(url)}
            onClick={() => onChange({ ...value, images: value.images.includes(url) ? value.images.filter(image => image !== url) : [...value.images, url] })}
            className={`w-24 rounded-lg border-2 p-1 ${value.images.includes(url) ? 'border-purple-400' : 'border-white/10'}`}>
            <SafeImage src={url} alt="" className="h-24 w-full rounded object-cover" />
            <span className="text-xs text-cream">{value.images[0] === url ? 'Main image' : value.images.includes(url) ? 'Selected' : 'Include'}</span>
        </button>)}</div>
    </fieldset>;
}
