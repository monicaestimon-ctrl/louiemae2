import React from 'react';

export function SourcingPageControls({ ready, status, count, label, loadMore }: {
  ready: boolean; status: 'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted';
  count: number; label: string; loadMore: (count: number) => void;
}) {
  return <div className="relative z-10 my-3 space-y-2 text-xs text-cream/60">
    <p role="status">{!ready ? 'Sourcing lists are being prepared. Try again after verification completes.'
      : status === 'LoadingFirstPage' ? `Loading ${label}…`
        : `${count} ${label} loaded${status === 'Exhausted' ? ' · All results loaded' : ' · More results available'}`}</p>
    {ready && (status === 'CanLoadMore' || status === 'LoadingMore') && <button type="button"
      disabled={status === 'LoadingMore'} onClick={() => loadMore(25)}
      className="rounded-lg border border-white/20 px-3 py-2 text-cream disabled:opacity-40">
      {status === 'LoadingMore' ? `Loading more ${label}…` : `Load more ${label}`}
    </button>}
  </div>;
}
