import React, { useState } from 'react';
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { commerceErrorData, customerMessage } from '../../lib/errors';

const button = 'min-h-11 border border-earth/30 px-3 py-2 text-sm disabled:opacity-40';
const stages = [
  'imported_draft',
  'evidence_review',
  'economics_review',
  'content_review',
  'ready',
] as const;

function ProductReview({ productId }: { productId: Id<'commerceProducts'> }) {
  const data = useQuery(api.catPublication.status, { productId });
  const restoreStock = useMutation(api.catPublication.restoreStockExcludedDraft);
  const release = useMutation(api.catPublication.releaseManualReview);
  const verifyIdentity = useMutation(api.catPublication.verifyCanonicalIdentity);
  const advance = useMutation(api.catPublication.advance);
  const publish = useMutation(api.catPublication.publish);
  const [selected, setSelected] = useState<Id<'catVariants'>[]>([]);
  const [channels, setChannels] = useState<('retail' | 'house')[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setFailed(false);
    setMessage('Checking current product records…');
    try {
      await action();
      setMessage(success);
    } catch (error) {
      setFailed(true);
      setMessage(commerceErrorData(error)?.detail ?? customerMessage(error));
    } finally {
      setBusy(false);
    }
  }
  if (!data) return <p role="status">Loading product review…</p>;
  const index = stages.findIndex((s) => s === data.stage);
  const next = index >= 0 && index < stages.length - 1 ? stages[index + 1] : null;
  const blockers = Object.values(data.gates).flat();
  return (
    <div className="border border-earth/20 p-3 space-y-3">
      <p>
        Stage: {data.stage}. Product holds: {data.holds.join(', ') || 'None'}.
      </p>
      <fieldset disabled={busy} className="space-y-2">
        <legend>Variants reviewed</legend>
        {data.variants.map((cv) => (
          <label key={cv.id} className="min-h-11 flex gap-2 items-center">
            <input
              type="checkbox"
              disabled={cv.availability === 'discontinued'}
              checked={selected.includes(cv.id)}
              onChange={(e) =>
                setSelected((old) =>
                  e.target.checked ? [...old, cv.id] : old.filter((id) => id !== cv.id)
                )
              }
            />
            <span>
              {cv.sku} · {cv.availability} · {cv.holds.join(', ') || 'No holds'}
            </span>
          </label>
        ))}
      </fieldset>
      <button
        className={button}
        disabled={busy || data.stockExcluded || !selected.length || selected.length > 50}
        onClick={() =>
          run(
            () => verifyIdentity({ productId, variantIds: selected }),
            'Product identity verified. Availability, costs and publication checks still apply.'
          )
        }
      >
        Verify retail and HOLM identity
      </button>
      <label className="block">
        Completed review and evidence references
        <textarea
          className="block border w-full p-2"
          maxLength={1000}
          value={reason}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {data.stockExcluded && (
        <button
          className={button}
          disabled={busy || !selected.length || selected.length > 50 || reason.trim().length < 10}
          onClick={() =>
            run(
              () => restoreStock({ productId, variantIds: selected, reason }),
              'Restocked draft restored for review. Nothing was published.'
            )
          }
        >
          Restore verified restock to draft review
        </button>
      )}
      <button
        className={button}
        disabled={
          busy ||
          data.stockExcluded ||
          !selected.length ||
          selected.length > 50 ||
          reason.trim().length < 10
        }
        onClick={() =>
          run(
            () => release({ productId, variantIds: selected, reason }),
            'Manual review saved. No product was published.'
          )
        }
      >
        Complete manual review
      </button>
      <details>
        <summary className="min-h-11 py-3">Current stage checks ({blockers.length})</summary>
        <ul>
          {blockers.map((item, i) => (
            <li key={`${i}:${item}`}>{item}</li>
          ))}
        </ul>
      </details>
      {next && next !== 'imported_draft' ? (
        <button
          className={button}
          disabled={busy || data.stockExcluded}
          onClick={() => run(() => advance({ productId, to: next }), `Moved to ${next}.`)}
        >
          Advance to {next.replaceAll('_', ' ')}
        </button>
      ) : null}
      <fieldset disabled={busy} className="space-y-2">
        <legend>Publication destinations</legend>
        {(['retail', 'house'] as const).map((channel) => (
          <label key={channel} className="min-h-11 flex gap-2 items-center">
            <input
              type="checkbox"
              checked={channels.includes(channel)}
              onChange={(e) =>
                setChannels((old) =>
                  e.target.checked ? [...old, channel] : old.filter((c) => c !== channel)
                )
              }
            />
            {channel === 'retail' ? 'Louie Mae retail' : 'HOLM trade'}
          </label>
        ))}
      </fieldset>
      <p className="text-xs">
        Publishing includes only variants that pass current server checks. Both selected
        destinations must pass together. Checkout flags and inventory checks still apply.
      </p>
      <button
        className={button}
        disabled={
          busy ||
          data.stockExcluded ||
          !channels.length ||
          !['ready', 'published'].includes(data.stage) ||
          blockers.length > 0
        }
        onClick={() =>
          run(
            () => publish({ productIds: [productId], channels }),
            'Published to the selected destinations. Checkout eligibility remains governed by current flags and inventory.'
          )
        }
      >
        Publish reviewed product
      </button>
      <p role={failed ? 'alert' : 'status'}>{message}</p>
    </div>
  );
}

function Queue() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.catPublication.reviewQueue,
    {},
    { initialNumItems: 25 }
  );
  const [productId, setProductId] = useState<Id<'commerceProducts'> | null>(null);
  return (
    <div className="space-y-3">
      <ul className="max-h-72 overflow-auto space-y-2">
        {results.map((row) => (
          <li key={row.productId}>
            <button
              className={button}
              disabled={(!row.included && !row.stockExcluded) || row.stage === 'archived'}
              onClick={() => setProductId(row.productId)}
            >
              {row.name} · {row.stage}
            </button>
            {!row.included ? (
              <span>
                {row.stockExcluded
                  ? ' Stock excluded; verified restock review required'
                  : ' Excluded or missing staging evidence'}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {status === 'LoadingFirstPage' ? <p role="status">Loading publication queue…</p> : null}
      {status === 'CanLoadMore' || status === 'LoadingMore' ? (
        <button className={button} disabled={status === 'LoadingMore'} onClick={() => loadMore(25)}>
          Load more products
        </button>
      ) : null}
      {status === 'Exhausted' && results.length === 0 ? (
        <p>No catalog products to review.</p>
      ) : null}
      {productId ? <ProductReview key={productId} productId={productId} /> : null}
    </div>
  );
}

function AshcroftPreparation() {
  const { results, status, loadMore } = usePaginatedQuery(api.catPublication.ashcroftPreparationQueue, {}, { initialNumItems: 25 });
  const prepare = useMutation(api.catPublication.prepareAshcroft);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  async function review(row: (typeof results)[number]) {
    setBusy(true); setFailed(false); setMessage('Preparing review…');
    try {
      await prepare({ productId: row.productId, expectedRevision: row.revision, reason: reason.trim() });
      setMessage('Added to the review queue. Category, costs, prices and images still require review.');
    } catch (error) { setFailed(true); setMessage(commerceErrorData(error)?.detail ?? customerMessage(error)); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3 border border-earth/20 p-3">
    <p>Prepare existing Ashcroft identities for review. This does not approve evidence, change live prices or publish products.</p>
    <label className="block">Preparation review note<textarea value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} className="block w-full border p-2" /></label>
    <ul>{results.map(row => <li key={row.productId}><button className={button} disabled={busy || reason.trim().length < 10} onClick={() => review(row)}>Prepare {row.name}</button></li>)}</ul>
    {status === 'LoadingFirstPage' && <p role="status">Loading Ashcroft records…</p>}
    {(status === 'CanLoadMore' || status === 'LoadingMore') && <button className={button} disabled={busy || status === 'LoadingMore'} onClick={() => loadMore(25)}>Load more Ashcroft records</button>}
    {status === 'Exhausted' && results.length === 0 && <p>No unprepared Ashcroft records remain.</p>}
    <p role={failed ? 'alert' : 'status'}>{message}</p>
  </div>;
}

export default function CatalogPublicationReview() {
  const [open, setOpen] = useState(false);
  const [prepare, setPrepare] = useState(false);
  return (
    <section className="bg-white border border-earth/10 rounded-lg p-4 space-y-3">
      <button className={button} aria-expanded={open} onClick={() => setOpen(!open)}>
        Product review and publication
      </button>
      {open ? <><Queue /><button className={button} aria-expanded={prepare} onClick={() => setPrepare(!prepare)}>Prepare Ashcroft for catalog review</button>{prepare && <AshcroftPreparation />}</> : null}
    </section>
  );
}
