"use node";
import { createHash } from 'node:crypto';
import { v } from 'convex/values';
import { action, internalAction } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { safeFetch } from '../lib/safeFetch';
import { mediaRenditions } from '../lib/mediaRenditions';
import { CommerceError, commerceErrorData } from '../lib/errors';

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

/** Deployment-admin only. Creates pending media; never grants rights or publishes products. */
export const prepareReviewedSource = internalAction({
  args: { variantId:v.id('catVariants'), sku:v.string(), piecesPerPack:v.number(), sourceUrl:v.string(), contentHash:v.string(), sourceWorkbookSha256:v.string(), reviewSha256:v.string() },
  handler: async (ctx,a):Promise<{assetId:Id<'catMediaAssets'>;duplicate:boolean;widths:number[]}> => {
    if (![a.contentHash,a.sourceWorkbookSha256,a.reviewSha256].every(x=>/^[a-f0-9]{64}$/.test(x))
      || !Number.isSafeInteger(a.piecesPerPack) || a.piecesPerPack<1)
      throw new CommerceError('INVALID_INPUT','Valid reviewed hashes and pack required');
    let url:URL;
    try { url=new URL(a.sourceUrl); } catch { throw new CommerceError('INVALID_INPUT','Invalid source URL'); }
    if(url.protocol!=='https:' || url.hostname!=='images.salsify.com' || url.username || url.password || (url.port && url.port!=='443'))
      throw new CommerceError('INVALID_INPUT','Use the supplier image host from the reviewed workbook');
    const selection={variantId:a.variantId,sku:a.sku,piecesPerPack:a.piecesPerPack,contentHash:a.contentHash,sourceUrl:a.sourceUrl};
    let target=await ctx.runQuery(internal.catMedia.reviewedSourceTarget,selection);
    if(target.asset?.widths.length)return {assetId:target.asset.id,duplicate:true,widths:target.asset.widths};
    const fetched=await safeFetch(a.sourceUrl,{allow:['images.salsify.com'],maxBytes:20*1024*1024});
    if(!fetched.ok)throw new CommerceError('INVALID_INPUT','Supplier image could not be fetched safely');
    if(createHash('sha256').update(fetched.bytes).digest('hex')!==a.contentHash)
      throw new CommerceError('INVALID_INPUT','Source bytes changed since visual review');
    const prepared=await mediaRenditions(fetched.bytes);
    target=await ctx.runQuery(internal.catMedia.reviewedSourceTarget,selection);
    if(target.asset?.widths.length)return {assetId:target.asset.id,duplicate:true,widths:target.asset.widths};
    const storageId=target.asset?.storageId ?? await ctx.storage.store(new Blob([fetched.bytes],{type:prepared.mime}));
    const record=target.asset ? {id:target.asset.id,duplicate:true} : await ctx.runMutation(internal.catMedia.record,{
      productId:target.productId,variantId:a.variantId,role:'hero',storageId,contentHash:a.contentHash,
      expectedZuo:{sku:a.sku,piecesPerPack:a.piecesPerPack},mime:prepared.mime,width:prepared.width,height:prepared.height,
      bytes:fetched.bytes.byteLength,sourceUrl:a.sourceUrl,status:'pending',
      rights:{basis:'Supplier source file; publication rights require separate review',evidenceRef:`Source workbook SHA256 ${a.sourceWorkbookSha256}; visual review SHA256 ${a.reviewSha256}; SKU ${a.sku}`,attributionRequired:false,privateOriginal:true},
    }).catch(async error => {
      // A typed validation rejection rolls back the transaction. Unknown failures
      // may already have committed, so preserve the source for reconciliation.
      if (commerceErrorData(error)?.code === 'INVALID_INPUT') await ctx.storage.delete(storageId);
      throw error;
    });
    // Retry reuses the original association; do not attach derivatives to an unreferenced blob.
    const current=await ctx.runQuery(internal.catMedia.reviewedSourceTarget,selection);
    if(!current.asset)throw new CommerceError('INVALID_INPUT','Media association was not retained');
    if(record.duplicate && !target.asset && current.asset.storageId!==storageId)await ctx.storage.delete(storageId);
    if(current.asset.widths.length)return {assetId:current.asset.id,duplicate:true,widths:current.asset.widths};
    const uploaded:{width:number;storageId:Id<'_storage'>;format:string}[]=[];
    try {
      for(const d of prepared.derivatives)uploaded.push({width:d.width,format:d.format,storageId:await ctx.storage.store(new Blob([d.bytes],{type:'image/webp'}))});
    } catch(error) { for(const d of uploaded)await ctx.storage.delete(d.storageId);throw error; }
    const attached=await ctx.runMutation(internal.catMedia.attachDerivatives,{assetId:current.asset.id,sourceStorageId:current.asset.storageId,contentHash:a.contentHash,derivatives:uploaded});
    if(!attached)for(const d of uploaded)await ctx.storage.delete(d.storageId);
    return {assetId:current.asset.id,duplicate:record.duplicate,widths:prepared.derivatives.map(d=>d.width)};
  },
});
