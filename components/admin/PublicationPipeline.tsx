import React from 'react';
import { usePaginatedQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';

const STAGES = [
  ['imported_draft', 'Imported drafts'], ['evidence_review', 'Evidence review'],
  ['economics_review', 'Economics review'], ['content_review', 'Content review'],
  ['ready', 'Ready'], ['published', 'Published'], ['archived', 'Archived'],
] as const;

function StageCount({ stage, label }: { stage: typeof STAGES[number][0]; label: string }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.v2Admin.pipelineStage, { stage }, { initialNumItems: 100 },
  );
  const count = new Set(results.map(row => row._id)).size;
  return <li className="flex flex-wrap items-center gap-2 py-1">
    <span aria-live="polite">{label}: {status === 'LoadingFirstPage' ? 'Loading…'
      : status === 'Exhausted' ? count.toLocaleString('en-US') : `At least ${count.toLocaleString('en-US')}`}</span>
    {status === 'CanLoadMore' && <button type="button" className="underline"
      aria-label={`Count more ${label.toLowerCase()}`} onClick={() => loadMore(100)}>Count next 100</button>}
    {status === 'LoadingMore' && <span role="status">Counting more…</span>}
  </li>;
}

export default function PublicationPipeline() {
  return <>
    <h3 className="font-serif text-lg">Publication pipeline</h3>
    <ul className="text-xs">{STAGES.map(([stage, label]) => <StageCount key={stage} stage={stage} label={label} />)}</ul>
    <p className="text-xs text-earth/60">Partial counts are marked “At least”. Continue counting until the full stage has been loaded. Counts update as products move between stages.</p>
  </>;
}
