import React, { useDeferredValue, useId, useState } from 'react';
import { usePaginatedQuery, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';

export function AdminProductPicker({ value, onChange }: { value?: string; onChange: (id: string) => void }) {
  const inputId = useId();
  const readiness = useQuery(api.catalogReadiness.status, {});
  const ready = readiness?.ready === true;
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const updating = term !== search.trim();
  const page = usePaginatedQuery(api.catalog.adminOptionsPage, ready ? { search: term || undefined } : 'skip', { initialNumItems: 25 });
  const selected = useQuery(api.catalog.adminOption, ready && value ? { id: value } : 'skip');
  const options = ready ? [...new Map(page.results.map(row => [row.id, row])).values()] : [];
  const needsPinnedOption = Boolean(value && !options.some(option => option.id === value));
  const pinnedName = selected?.id === value ? selected.name : selected === null ? 'Selected product unavailable' : 'Loading selected product…';
  const loading = readiness === undefined || (ready && page.status === 'LoadingFirstPage');
  return <div className="space-y-2">
    <label htmlFor={`${inputId}-search`} className="block text-[10px] uppercase tracking-widest text-earth/40">Search product names</label>
    <input id={`${inputId}-search`} type="search" value={search} onChange={event => setSearch(event.target.value)}
      disabled={!ready} className="w-full bg-cream/30 p-3 border border-earth/10 text-sm" />
    <label htmlFor={inputId} className="block text-[10px] uppercase tracking-widest text-earth/40">Select Product</label>
    <select id={inputId} value={value || ''} onChange={event => onChange(event.target.value)} disabled={!ready || updating}
      className="w-full bg-cream/30 p-3 border border-earth/10 text-sm">
      <option value="">Choose a product</option>
      {needsPinnedOption && <option value={value}>{pinnedName}</option>}
      {options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
    </select>
    <p role="status" className="text-xs text-earth/50">{loading || updating ? 'Loading products…'
      : !ready ? 'Product selection is temporarily unavailable.'
        : `${options.length} matching products loaded${page.status === 'Exhausted' ? ' · All matches loaded' : ''}`}</p>
    {ready && (page.status === 'CanLoadMore' || page.status === 'LoadingMore') && <button type="button"
      onClick={() => page.loadMore(25)} disabled={page.status === 'LoadingMore' || updating}
      className="text-xs text-earth underline disabled:opacity-50">
      {page.status === 'LoadingMore' ? 'Loading more products…' : 'Load more products'}
    </button>}
  </div>;
}
