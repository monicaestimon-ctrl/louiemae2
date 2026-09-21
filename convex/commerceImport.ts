'use node';
import { v } from 'convex/values';
import { action } from './_generated/server';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { blankCommerceDraft, sourceIdentity, houseEstimateFromCost } from '../lib/commerce';
import { ashcroftDraft } from '../lib/ashcroft';
import { readSupplierText } from './scraper';

export const fromUrl = action({
  args: {
    url: v.string(),
    provider: v.union(v.literal('ashcroft'), v.literal('owner_managed')),
    entry: v.union(v.literal('retail'), v.literal('house')),
  },
  handler: async (ctx, args): Promise<{ id: Id<'commerceProducts'>; existing: boolean }> => {
    const actor = await ctx.runQuery(internal.cjAdminAccess.verifyCjAdminIdentity, {});
    if (args.url.length > 2048) throw new Error('Use a shorter product URL.');
    if (
      (args.provider === 'ashcroft' && args.entry !== 'retail') ||
      (args.provider === 'owner_managed' && args.entry !== 'house')
    )
      throw new Error('Use the correct supplier import entry point.');
    const sourceKey = sourceIdentity(args.url, args.provider);
    const url = sourceKey.slice(args.provider.length + 1);
    let d = blankCommerceDraft();
    if (args.provider === 'ashcroft') {
      const [json, page] = await Promise.all([
        readSupplierText(`${url}.json`),
        readSupplierText(url).catch(() => ''),
      ]);
      d = ashcroftDraft(JSON.parse(json), url, page);
      if (!page || d.facts === d.description)
        d.conflicts.push(
          'Technical features were not extracted. Confirm specifications from the Ashcroft product page before publishing.'
        );
    } else {
      const result = await ctx.runAction(api.furnitureImport.fromUrl, { url });
      const p = result.product;
      d = {
        ...d,
        name: p.name,
        description: p.description,
        sourceUrl: url,
        supplierName: p.supplierName,
        referenceImages: p.images,
        facts: p.supplierNotes,
        currency: p.currency,
        usdRate: p.usdRate,
        variants: p.variants.map((o) => ({
          ...o,
          sku: o.id,
          increment: 1,
          retail: 0,
          commercial: o.cost > 0 && p.usdRate > 0 ? houseEstimateFromCost(o.cost, p.usdRate) : 0,
        })),
      };
    }
    return await ctx.runMutation(internal.commerce.imported, {
      sourceKey,
      provider: args.provider,
      draft: d,
      actor: actor.email,
    });
  },
});
