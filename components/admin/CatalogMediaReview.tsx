import React, { useEffect, useRef, useState } from 'react';
import { useAction, useConvex, useMutation, usePaginatedQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../../convex/_generated/api';
import { commerceErrorData, customerMessage } from '../../lib/errors';

type Row = FunctionReturnType<typeof api.catMedia.reviewQueue>['page'][number];
const button = 'border border-earth/30 px-3 py-2 text-sm disabled:opacity-40';
const errorText = (error: unknown) => commerceErrorData(error)?.detail ?? customerMessage(error);

function ImageReview({ row, asset }: { row: Row; asset: Row['assets'][number] }) {
  const verify = useMutation(api.catMedia.verify);
  const [altText, setAltText] = useState(asset.altText);
  const [checked, setChecked] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function review(approve: boolean) {
    setBusy(true); setMessage('');
    try {
      await verify({ assetId: asset.id, approve, altText, sku: row.sku, pack: row.packId,
        ...(row.color ? { color: row.color } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}) });
      setMessage(approve ? 'Visual review saved. Rights and other publishing checks remain separate.' : 'Image rejected; replacement review is required.');
      setChecked(false);
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(false); }
  }
  return <div className="border-t border-earth/20 pt-3 space-y-2">
    {asset.url ? <img src={asset.url} alt={asset.altText || `Unreviewed supplier photo for ${row.sku}`} loading="lazy" className="max-w-full w-64 h-48 object-contain bg-white" /> : <p>Stored image unavailable.</p>}
    <p>{asset.role} · {asset.status} · Web sizes: {asset.widths.join(', ') || 'Not prepared'}</p>
    <p className="text-xs break-words">Source/rights record: {asset.rights.basis}. {asset.rights.evidenceRef}</p>
    {asset.rejectReason ? <p>Review note: {asset.rejectReason}</p> : null}
    <label className="block">Accurate image description
      <textarea value={altText} onChange={e => setAltText(e.target.value)} maxLength={1000} className="block border w-full p-2" />
    </label>
    <label className="flex items-start gap-2"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />
      I checked SKU {row.sku}, pack {row.packId} ({row.piecesPerPack} pieces){row.color ? ` and color ${row.color}` : ''} against this photograph.
    </label>
    <label className="block">Review or rejection note
      <input value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} className="block border w-full p-2" />
    </label>
    <div className="flex flex-wrap gap-2">
      <button className={button} disabled={busy || !asset.url || !checked || altText.trim().length < 8} onClick={() => review(true)}>Save visual approval</button>
      <button className={button} disabled={busy || reason.trim().length < 5} onClick={() => review(false)}>Reject image</button>
    </div>
    <p role="status">{message}</p>
  </div>;
}

function VariantMedia({ row }: { row: Row }) {
  const prepare = useAction(api.catMediaProcessing.prepareStagedPrimary);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function run() {
    setBusy(true); setMessage('Verifying stored source and preparing web images…');
    try {
      const result = await prepare({ variantId: row.variantId });
      setMessage(`Prepared ${result.widths.join(', ')} pixel web copies. Review the photograph below.`);
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(false); }
  }
  return <details className="border border-earth/20 p-3 rounded">
    <summary className="cursor-pointer">{row.sku} · {row.name} · {row.mediaHold ? 'Photo review needed' : 'Photo reviewed'}</summary>
    <div className="space-y-3 pt-3">
      <p>Supplier: {row.supplierName} · {row.supplierVariantName} · Louie Mae variant: {row.variantName}</p>
      <p>Pack {row.packId} · {row.piecesPerPack} physical pieces · {row.rightsHold ? 'Publication rights still require review' : 'Check current supplier rights before publishing'}</p>
      <button className={button} disabled={busy || !row.hasStagedSource} onClick={run}>Prepare uploaded source image</button>
      <p role="status">{message}</p>
      {row.assets.map(asset => <ImageReview key={`${asset.id}:${row.sku}:${row.packId}:${row.color}`} row={row} asset={asset} />)}
      {!row.assets.length ? <p>No registered image. Preparing a stored source does not approve or publish it.</p> : null}
    </div>
  </details>;
}

function ReviewQueue() {
  const { results, status, loadMore } = usePaginatedQuery(api.catMedia.reviewQueue, {}, { initialNumItems: 20 });
  const client = useConvex();
  const prepare = useAction(api.catMediaProcessing.prepareStagedPrimary);
  const stop = useRef(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [failures, setFailures] = useState<string[]>([]);
  useEffect(() => () => { stop.current = true; }, []);
  async function prepareAll() {
    stop.current = false; setBusy(true); setFailures([]);
    let count = 0;
    let skipped = 0;
    let failed = 0;
    let cursor: string | null = null;
    const cursors = new Set<string>();
    try {
      do {
        const page = await client.query(api.catMedia.reviewQueue, { paginationOpts: { cursor, numItems: 20 } });
        for (const row of page.page) {
          if (stop.current) break;
          if (!row.hasStagedSource) { skipped++; continue; }
          try { await prepare({ variantId: row.variantId }); count++; }
          catch (error) { failed++; setFailures(items => [...items, `${row.sku}: ${errorText(error)}`]); }
          if (!stop.current) setProgress(`${count} prepared or already prepared · ${skipped} excluded/no staged source · ${failed} need review`);
        }
        if (page.isDone || stop.current) break;
        if (cursors.has(page.continueCursor)) throw new Error('Pagination did not advance. Retry the remaining records.');
        cursors.add(page.continueCursor); cursor = page.continueCursor;
      } while (!stop.current);
      setProgress(`${stop.current ? 'Stopped after current image' : 'Preparation complete'}: ${count} prepared · ${skipped} excluded/no staged source · ${failed} need review. No images were visually approved or products published.`);
    } catch (error) { setProgress(errorText(error)); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3 pt-3">
    <p>Verify the actual photograph, SKU, color and pack before visual approval. Source-file preparation does not establish publication rights or make the product purchasable.</p>
    <div className="flex flex-wrap gap-2">
      <button className={button} disabled={busy} onClick={prepareAll}>Prepare all included stored sources</button>
      {busy ? <button className={button} onClick={() => { stop.current = true; setProgress('Stopping after the current image…'); }}>Stop preparation</button> : null}
    </div>
    <p role="status">{progress}</p>
    {failures.length ? <details><summary>{failures.length} source preparation errors</summary><ul>{failures.map((failure, i) => <li key={i}>{failure}</li>)}</ul></details> : null}
    {results.map(row => <VariantMedia key={row.variantId} row={row} />)}
    {status === 'LoadingFirstPage' ? <p role="status">Loading media records…</p> : null}
    {status === 'CanLoadMore' || status === 'LoadingMore' ? <button className={button} disabled={status === 'LoadingMore'} onClick={() => loadMore(20)}>Load more media records</button> : null}
  </div>;
}

export default function CatalogMediaReview() {
  const [open, setOpen] = useState(false);
  return <section className="bg-white border border-earth/10 rounded-lg p-4 text-sm">
    <button className={button} aria-expanded={open} onClick={() => setOpen(value => !value)}>Supplier image preparation and review</button>
    {open ? <ReviewQueue /> : null}
  </section>;
}
