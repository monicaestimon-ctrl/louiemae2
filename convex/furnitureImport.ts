'use node';
import { v } from 'convex/values';
import { action } from './_generated/server';
import { api, internal } from './_generated/api';
import { buildBatchImportProduct } from '../lib/batchImportProduct';
import { blankFurniture, type FurnitureDraft } from '../lib/furniture';
type SourcePrice = { OriginalPrice?: number; ConvertedPriceList?: { Original?: { Price?: number } } };
type SourceOption = { Id?: string | number; Price?: SourcePrice };

export const fromUrl = action({
  args: { url: v.string() },
  handler: async (ctx, { url }): Promise<{ product: FurnitureDraft; warnings: string[] }> => {
    await ctx.runQuery(internal.cjAdminAccess.verifyCjAdminIdentity, {});
    if (url.length > 2048) throw new Error('Please use a shorter product link.');
    const result = await ctx.runAction(api.scraper.scrapeProduct, { url });
    const p = buildBatchImportProduct(
      { _id: 'furniture', normalizedUrl: url, result },
      '',
      (n) => n,
      { evidenceOnly: true }
    );
    const is1688 = result.source === '1688';
    const item = is1688 ? (result.data?.Result ?? result.data) : null;
    const originalCost = (price: SourcePrice | undefined) =>
      Number(price?.OriginalPrice ?? price?.ConvertedPriceList?.Original?.Price ?? 0);
    const currency = is1688 ? 'CNY' : p.sourceCurrency || 'USD';
    const variants =
      is1688 && item?.ConfiguredItems?.length
        ? item.ConfiguredItems.slice(0, 100).map((cfg: SourceOption, i: number) => ({
            id: String(cfg.Id ?? i),
            name: p.variants.find(v => v.id === String(cfg.Id))?.name || `Option ${i + 1}`,
            ...(p.variants.find(v => v.id === String(cfg.Id))?.image ? { image: p.variants.find(v => v.id === String(cfg.Id))!.image } : {}),
            cost: originalCost(cfg.Price),
            minimum: 1,
          }))
        : [
            {
              id: 'standard',
              name: 'Standard',
              cost: is1688
                ? originalCost(item?.PromotionPrice) || originalCost(item?.Price)
                : (p.sourcePriceOriginal ?? p.price ?? 0),
              minimum: 1,
            },
          ];
    const props = p.sourceProperties || {};
    return {
      product: {
        ...blankFurniture(),
        name: p.name || '',
        description: (p.rawSourceDescription || p.description || '').slice(0, 8000),
        images: p.images.filter((s) => /^https:\/\//i.test(s)).slice(0, 24),
        sourceUrl: p.productUrl || url,
        supplierKey: p.seller?.id ? `${result.source}:${p.seller.id}` : '',
        supplierName: p.seller?.name === 'Unknown' ? '' : p.seller?.name || '',
        currency,
        // A non-USD conversion must be explicitly entered by the operator; no guessed exchange rate.
        usdRate: currency === 'USD' ? 1 : 0,
        variants,
        supplierNotes: `Imported listing attributes (unconfirmed):\n${Object.entries(props)
          .map(([k, value]) => `${k}: ${value}`)
          .join('\n')}`.slice(0, 8000),
      },
      warnings: [
        'Review the name, category, description, photos and every variant before publishing.',
        'Minimum quantities default to 1 until you confirm them. Packaging, availability and commercial suitability are not verified.',
        ...(currency !== 'USD' ? ['Enter a dated USD conversion rate before saving.'] : []),
      ],
    };
  },
});
