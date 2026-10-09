import { usePaginatedQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { api } from '../convex/_generated/api';
import { isCjHealthProblem } from '../lib/productHealth';

export function ProductHealthPanel({ summary }: { summary: FunctionReturnType<typeof api.productHealth.status> | undefined }) {
  const ready = summary?.ready === true && typeof summary.productsWithCjIssues === 'number';
  const total = summary?.productsWithCjIssues;
  const issues = usePaginatedQuery(api.productHealth.issuesPage, ready ? { cjOnly: true } : 'skip', { initialNumItems: 5 });
  const clear = ready && total === 0;
  return <div className="backdrop-blur-2xl bg-black/40 border border-white/10 rounded-[2rem] p-6 shadow-[0_15px_30px_rgba(0,0,0,0.3)] relative overflow-hidden">
    <div className="flex items-center justify-between gap-4 mb-5">
      <div>
        <h3 className="font-serif text-lg text-cream">Fulfillment Readiness</h3>
        <span className="text-[10px] uppercase tracking-widest text-cream/50 mt-1 block">
          {ready ? `${total} CJ issue${total === 1 ? '' : 's'}` : summary ? 'Checks unavailable' : 'Loading checks'}
        </span>
      </div>
      {clear ? <CheckCircle className="w-5 h-5 text-green-400" /> : <AlertTriangle className="w-5 h-5 text-amber-400" />}
    </div>
    {!ready ? <p className="text-xs text-cream/50">
      {!summary ? 'Checking product readiness...' : summary.phase === 'failed'
        ? 'Health verification needs attention. Product readiness has not been confirmed.'
        : 'Health checks are unavailable until verification finishes. Product readiness has not been confirmed.'}
    </p> : clear ? <p className="text-xs text-green-300/80 bg-green-500/10 border border-green-500/20 rounded-xl p-3">
      CJ mappings and inventory snapshots are clear.
    </p> : <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
      {issues.results.map(issue => <div key={issue.productId} className="bg-white/5 border border-white/10 rounded-xl p-3 shadow-inner">
        <div className="flex items-center justify-between gap-3 mb-1">
          <span className="text-sm text-cream font-medium truncate">{issue.name}</span>
          {issue.cjInventoryStatus && <span className="text-[10px] uppercase tracking-widest text-cream/40 font-mono">
            {issue.cjInventoryStatus.replace(/_/g, ' ')}
          </span>}
        </div>
        <p className="text-[11px] text-amber-100/80 leading-relaxed">{issue.problems.find(isCjHealthProblem)}</p>
      </div>)}
      {issues.status === 'LoadingFirstPage' && <p className="text-xs text-cream/50">Loading issue details...</p>}
      {issues.status === 'Exhausted' && issues.results.length === 0 && <p className="text-xs text-cream/50">Issue details are updating. Readiness has not been confirmed.</p>}
      {(issues.status === 'CanLoadMore' || issues.status === 'LoadingMore') && <button type="button"
        disabled={issues.status === 'LoadingMore'} onClick={() => issues.loadMore(25)}
        className="w-full text-xs text-cream bg-white/10 rounded-xl py-2 disabled:opacity-50">
        {issues.status === 'LoadingMore' ? 'Loading more issues...' : 'Load more issues'}
      </button>}
      <p className="text-[10px] text-cream/40">Showing {issues.results.length} of {total} affected products.</p>
    </div>}
  </div>;
}
