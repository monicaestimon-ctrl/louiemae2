import React, { useDeferredValue, useEffect, useState } from 'react';
import { usePaginatedQuery, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { CjQueueFilter } from '../lib/cjVariantQueue';
import { CJVariantManager } from './CJVariantManager';
import { SafeImage } from './SafeImage';

const filters: Array<{ value: CjQueueFilter; label: string }> = [
  { value: 'needs_attention', label: 'Needs attention' },
  { value: 'awaiting_approval', label: 'Not CJ approved' },
  { value: 'unmapped', label: 'Needs mapping' },
  { value: 'missing_customer', label: 'Missing customer variants' },
  { value: 'missing_cj', label: 'Missing CJ variants' },
  { value: 'ready', label: 'Ready' },
  { value: 'all', label: 'All CJ products' },
];

export function CJVariantQueue({ targetProductId, onEditProduct }: {
  targetProductId?: string; onEditProduct?: (productId: string) => void;
}) {
  const readiness = useQuery(api.catalogReadiness.status, {});
  const [filter, setFilter] = useState<CjQueueFilter>('needs_attention');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [selected, setSelected] = useState<string | undefined>(targetProductId);
  useEffect(() => { if (targetProductId) setSelected(targetProductId); }, [targetProductId]);
  const { results, status, loadMore } = usePaginatedQuery(api.catalog.variantQueuePage,
    readiness?.ready ? { filter, search: deferredSearch } : 'skip', { initialNumItems: 25 });
  const waiting = status === 'LoadingFirstPage' || search.trim() !== deferredSearch;
  const canContinue = status === 'CanLoadMore';

  return <section className="space-y-4 rounded-[2rem] border border-white/10 bg-black/40 p-5 md:p-8" aria-label="Product resolution queue">
    <h3 className="font-serif text-2xl text-cream">Product Resolution Queue</h3>
    <p className="text-sm text-cream/60">Find a product, then open its complete variants and CJ mappings.</p>
    {!readiness?.ready ? <p role="status" className="text-amber-200">
      {readiness === undefined ? 'Checking product queue availability…' : 'The product queue is being prepared. Try again after verification completes.'}
    </p> : <>
      <label className="block text-sm text-cream/70">Search products and variants
        <input value={search} onChange={event => setSearch(event.target.value)}
          placeholder="Product, SKU, VID, CJ product ID, or source URL"
          className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-cream" />
      </label>
      <div className="flex flex-wrap gap-2" aria-label="Queue filters">
        {filters.map(option => <button key={option.value} type="button" aria-pressed={filter === option.value}
          onClick={() => setFilter(option.value)} className="rounded-full border border-white/20 px-3 py-2 text-xs text-cream aria-pressed:bg-purple-700">
          {option.label}
        </button>)}
      </div>
      <p role="status" className="text-sm text-cream/60">{waiting ? 'Loading matching products…'
        : `${results.length} matching products loaded${status === 'Exhausted' ? ' · All results loaded' : ' · More products remain to check'}`}</p>
      {!waiting && results.length === 0 && <p className="text-cream/60">{status === 'Exhausted'
        ? 'No products match this queue view.' : 'No matches in the products checked so far. Continue to check more.'}</p>}
      <div className="max-h-96 space-y-2 overflow-y-auto" aria-busy={waiting}>
        {results.map(product => <button key={product._id} type="button" onClick={() => setSelected(product._id)}
          aria-pressed={selected === product._id} className="flex w-full items-center gap-4 rounded-xl border border-white/10 p-4 text-left text-cream aria-pressed:border-purple-400">
          {product.image && <SafeImage src={product.image} alt="" className="h-12 w-12 rounded-lg object-cover" />}
          <span className="min-w-0 flex-1"><strong className="block truncate">{product.name}</strong>
            <span className="block text-xs text-cream/60">{product.connectionStatus.label}</span>
            <span className="block text-xs text-cream/60">{product.mappingSummary.customerVariantCount} customer options · {product.mappingSummary.cjVariantCount} CJ options · {product.mappingSummary.unmappedVariantCount} unmapped</span>
          </span>
          <span className="text-xs text-purple-200">Open workspace</span>
        </button>)}
      </div>
      {(canContinue || status === 'LoadingMore') && <button type="button" disabled={!canContinue || waiting}
        onClick={() => loadMore(25)} className="rounded-xl border border-purple-400/40 px-5 py-3 text-sm text-purple-200 disabled:opacity-50">
        {status === 'LoadingMore' ? 'Loading more products…' : 'Load more products'}
      </button>}
    </>}
    {/* Keep this instance mounted across selections so unsaved per-product drafts survive. */}
    <CJVariantManager detailOnly targetProductId={readiness?.ready ? selected : undefined} onEditProduct={onEditProduct} />
  </section>;
}
