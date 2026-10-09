import { useEffect, useState } from 'react';
import { usePaginatedQuery, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { Product } from '../types';

export type CatalogPreviewProduct = Pick<Product, 'id' | 'name' | 'price' | 'images' | 'category' | 'collection' | 'isNew'>;
const previewProduct = (row: Omit<CatalogPreviewProduct, 'id'> & { _id: string }): CatalogPreviewProduct => ({
  id: row._id, name: row.name, price: row.price, images: row.images,
  category: row.category, collection: row.collection, isNew: row.isNew,
});
const PREVIEW_SIZE = 12;

export function useCollectionArrivalPreview(collection: string, since: number, ready: boolean) {
  const dated = usePaginatedQuery(api.catalog.arrivalsPage,
    ready ? { collection, since, kind: 'dated' } : 'skip', { initialNumItems: PREVIEW_SIZE });
  const needsLegacy = ready && dated.status === 'Exhausted' && dated.results.length < PREVIEW_SIZE;
  const legacy = usePaginatedQuery(api.catalog.arrivalsPage,
    needsLegacy ? { collection, since, kind: 'legacy' } : 'skip', { initialNumItems: PREVIEW_SIZE });
  const datedCount = dated.results.length;
  const legacyCount = needsLegacy ? legacy.results.length : 0;
  const { loadMore: loadDated, status: datedStatus } = dated;
  const { loadMore: loadLegacy, status: legacyStatus } = legacy;

  // A byte-limited page may be short or empty without being exhausted. Keep its
  // cursor until the preview is filled, including when source rows change live.
  useEffect(() => {
    if (ready && datedCount < PREVIEW_SIZE && datedStatus === 'CanLoadMore') loadDated(PREVIEW_SIZE - datedCount);
  }, [ready, datedCount, datedStatus, loadDated]);
  useEffect(() => {
    if (needsLegacy && datedCount + legacyCount < PREVIEW_SIZE && legacyStatus === 'CanLoadMore') {
      loadLegacy(PREVIEW_SIZE - datedCount - legacyCount);
    }
  }, [needsLegacy, datedCount, legacyCount, legacyStatus, loadLegacy]);

  const complete = datedCount >= PREVIEW_SIZE || (datedStatus === 'Exhausted'
    && (datedCount + legacyCount >= PREVIEW_SIZE || legacyStatus === 'Exhausted'));
  const products: CatalogPreviewProduct[] = ready
    ? [...dated.results, ...(needsLegacy ? legacy.results : [])].slice(0, PREVIEW_SIZE).map(previewProduct) : [];
  return { products, loading: ready && !complete };
}

export function useArrivalPreviews() {
  const readiness = useQuery(api.catalogReadiness.status, {});
  const ready = readiness?.ready === true;
  // One cutoff for this visit: rerenders must not restart every pagination query.
  const [since] = useState(() => Date.now() - 30 * 24 * 60 * 60 * 1000);
  const fashion = useCollectionArrivalPreview('fashion', since, ready);
  const kids = useCollectionArrivalPreview('kids', since, ready);
  const furniture = useCollectionArrivalPreview('furniture', since, ready);
  const decor = useCollectionArrivalPreview('decor', since, ready);
  return {
    collectionProducts: { fashion: fashion.products, kids: kids.products, furniture: furniture.products, decor: decor.products } as Record<string, CatalogPreviewProduct[]>,
    loading: readiness === undefined || fashion.loading || kids.loading || furniture.loading || decor.loading,
    unavailable: readiness !== undefined && !ready,
  };
}

export function useCollectionDropPreview(collection: string, ready: boolean) {
  const page = usePaginatedQuery(api.catalog.dropPage, ready ? { collection } : 'skip', { initialNumItems: 4 });
  const count = page.results.length;
  const { status, loadMore } = page;
  useEffect(() => {
    if (ready && count < 4 && status === 'CanLoadMore') loadMore(4 - count);
  }, [ready, count, status, loadMore]);
  return { products: ready ? page.results.slice(0, 4).map(previewProduct) : [],
    loading: ready && count < 4 && status !== 'Exhausted' };
}

export function useDropPreviews() {
  const readiness = useQuery(api.catalogReadiness.status, {});
  const ready = readiness?.ready === true;
  const fashion = useCollectionDropPreview('fashion', ready);
  const kids = useCollectionDropPreview('kids', ready);
  const furniture = useCollectionDropPreview('furniture', ready);
  const decor = useCollectionDropPreview('decor', ready);
  return {
    dropProducts: { fashion: fashion.products, kids: kids.products, furniture: furniture.products, decor: decor.products } as Record<string, CatalogPreviewProduct[]>,
    loading: readiness === undefined || fashion.loading || kids.loading || furniture.loading || decor.loading,
    unavailable: readiness !== undefined && !ready,
  };
}
