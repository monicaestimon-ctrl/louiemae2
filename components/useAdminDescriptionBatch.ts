import { useEffect, useRef, useState } from 'react';
import { useAction, useConvex } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import type { Product } from '../types';
import { buildSourceProductSnapshot } from '../lib/smartDescription';

export type DescriptionPreview = {
  product: Product; description: string; generatedDescription: string; auditId: string;
  fallbackUsed: boolean; warnings: string[]; sourceQuality?: number;
};

export function useAdminDescriptionBatch(enabled: boolean) {
  const convex = useConvex();
  const generate = useAction(api.smartDescriptions.generateSmartDescription);
  const requests = useRef({ generation: 0, busy: false });
  const [busy, setBusy] = useState(false);
  const [previews, setPreviews] = useState<DescriptionPreview[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const current = requests.current;
    current.busy = false;
    setBusy(false); setPreviews([]); setError(null);
    return () => { current.generation++; current.busy = false; };
  }, [enabled]);

  const run = async (ids: string[]) => {
    if (!enabled || requests.current.busy) return;
    const generation = ++requests.current.generation;
    requests.current.busy = true;
    const current = () => generation === requests.current.generation;
    setBusy(true); setPreviews([]); setError(null);
    let completed = 0;
    try {
      for (const id of new Set(ids)) {
        if (!current()) return;
        const detail = await convex.query(api.products.getAdmin, { id: id as Id<'products'> });
        if (!current()) return;
        // List rows may omit source evidence and protection metadata. Fetch the
        // complete product and recheck protection immediately before generation.
        if (!detail || detail.smartDescription?.adminEdited) continue;
        const product: Product = { ...detail, id: detail._id };
        const result = await generate({ request: {
          productId: id,
          sourceSnapshot: buildSourceProductSnapshot({
            sourceUrl: product.sourceUrl, name: product.name, description: product.description,
            rawDescription: product.rawSourceDescription || product.description,
            htmlDescription: product.rawHtmlDescription || '', price: product.price,
            currency: product.sourceCurrency || 'USD', images: product.images || [],
            descriptionImages: product.descriptionImages || [], variants: product.variants || [],
            category: product.category, subcategory: product.subcategory, collection: product.collection,
            sourceMetadata: { productId: product.id, descriptionSource: product.descriptionSource, sourcePriceCny: product.sourcePriceCny },
          }),
          adminContext: { selectedCategory: product.category, selectedSubcategory: product.subcategory, selectedCollection: product.collection },
          generationMode: 'batch_regenerate',
          options: { allowImageAnalysis: true, allowSeoKeywords: true, forceFreshVariation: true },
        } });
        if (!current()) return;
        if (!result.ok || !result.description || !result.auditId) throw new Error('Generation unavailable');
        const preview = { product, description: result.description, generatedDescription: result.description,
          auditId: result.auditId, fallbackUsed: Boolean(result.fallbackUsed), warnings: result.warnings || [], sourceQuality: result.facts?.sourceQuality?.score };
        completed++;
        setPreviews(previous => [...previous, preview]);
      }
      if (!completed) setError('No eligible products found. Deleted products and admin-edited descriptions were skipped.');
    } catch {
      if (current()) setError('The batch could not finish. Completed previews are available below; try the remaining products again later.');
    } finally {
      if (current()) { requests.current.busy = false; setBusy(false); }
    }
  };
  return { busy, previews, setPreviews, error, run };
}
