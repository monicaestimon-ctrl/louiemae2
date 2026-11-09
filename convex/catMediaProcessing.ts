"use node";
import { createHash } from 'node:crypto';
import { v } from 'convex/values';
import { action } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { mediaRenditions } from '../lib/mediaRenditions';
import { CommerceError } from '../lib/errors';

/** Reuses a source file already uploaded with the staged SKU. Never downloads arbitrary URLs. */
export const prepareStagedPrimary = action({
  args: { variantId: v.id('catVariants') },
  handler: async (ctx, a): Promise<{ assetId: Id<'catMediaAssets'>; duplicate: boolean; widths: number[] }> => {
    const source = await ctx.runQuery(internal.catMedia.stagedPrimary, a);
    const blob = await ctx.storage.get(source.storageId);
    if (!blob || blob.size > 20 * 1024 * 1024) throw new CommerceError('INVALID_INPUT', 'Stored source image is missing or too large');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== source.sha256) throw new CommerceError('INVALID_INPUT', 'Stored image does not match its source manifest');
    if (source.prepared) return { ...source.prepared, duplicate: true };
    const prepared = await mediaRenditions(bytes);
    const record = await ctx.runMutation(internal.catMedia.record, {
      productId: source.productId, variantId: a.variantId, role: 'hero', storageId: source.storageId,
      contentHash: hash, mime: prepared.mime, width: prepared.width, height: prepared.height,
      bytes: bytes.byteLength, sourceUrl: source.sourceUrl, status: 'pending',
      rights: { basis: 'Supplier source file; publication rights require separate review', evidenceRef: source.evidenceRef, attributionRequired: false, privateOriginal: true },
    });
    const uploaded: { width: number; storageId: Id<'_storage'>; format: string }[] = [];
    try {
      for (const d of prepared.derivatives) uploaded.push({ width: d.width, format: d.format,
        storageId: await ctx.storage.store(new Blob([d.bytes], { type: 'image/webp' })) });
    } catch (error) {
      // Delete only this attempt's unreferenced outputs; keep the staged original.
      for (const d of uploaded) await ctx.storage.delete(d.storageId);
      throw error;
    }
    // An uncertain mutation response may already have committed: never delete its outputs
    // in that case. A retry safely reuses the asset and discards only confirmed duplicates.
    const saved = await ctx.runMutation(internal.catMedia.attachDerivatives, {
      assetId: record.id, sourceStorageId: source.storageId, contentHash: hash, derivatives: uploaded,
    });
    if (!saved) for (const d of uploaded) await ctx.storage.delete(d.storageId);
    return { assetId: record.id, duplicate: record.duplicate, widths: prepared.derivatives.map(d => d.width) };
  },
});
