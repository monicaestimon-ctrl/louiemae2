import React, { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import type { Id } from '../../convex/_generated/dataModel';
import { api } from '../../convex/_generated/api';
import { customerMessage } from '../../lib/errors';
import type { StockEvidence } from '../../lib/stockEvidence';

type Detail = FunctionReturnType<typeof api.catStock.detail>;
const input = 'border p-1 block max-w-full';
export default function CatalogStockEvidence({ variantId }: { variantId: Id<'catVariants'> }) {
  const data = useQuery(api.catStock.detail, { variantId });
  const [generation, setGeneration] = useState(0);
  if (!data) return <p role="status">Loading stock evidence…</p>;
  return (
    <StockForm
      key={`${variantId}:${generation}`}
      initial={data}
      latest={data}
      reload={() => setGeneration((n) => n + 1)}
    />
  );
}
function StockForm({
  initial,
  latest,
  reload,
}: {
  initial: Detail;
  latest: Detail;
  reload: () => void;
}) {
  const [base] = useState(initial);
  const [quantity, setQuantity] = useState(base.current?.quantity ?? '');
  const [kind, setKind] = useState<StockEvidence['kind']>(base.current?.kind ?? 'unknown');
  const [basis, setBasis] = useState<StockEvidence['unitBasis']>(
    base.current?.unitBasis ?? 'unknown'
  );
  const [availability, setAvailability] = useState<StockEvidence['availability']>(
    base.current?.availability ?? 'unknown'
  );
  const [confirmed, setConfirmed] = useState(false);
  const [validUntil, setValidUntil] = useState(() => {
    if (!base.current?.validUntil) return '';
    const date = new Date(base.current.validUntil);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [source, setSource] = useState(''),
    [observed, setObserved] = useState(''),
    [note, setNote] = useState('');
  const [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [message, setMessage] = useState('');
  const [retry, setRetry] = useState<{ key: string; payload: string } | null>(null);
  const save = useMutation(api.catStock.recordEvidence);
  const stale =
    (base.current?._id ?? null) !== (latest.current?._id ?? null) ||
    base.variant.warehouseId !== latest.variant.warehouseId ||
    base.warehouseFingerprint !== latest.warehouseFingerprint ||
    base.variant.piecesPerPack !== latest.variant.piecesPerPack;
  return (
    <details className="border p-3 mt-4">
      <summary>Warehouse stock evidence · {base.variant.sku}</summary>
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setMessage('');
          try {
            const args = {
              variantId: base.variant.id,
              expectedRevisionId: base.current?._id ?? null,
              expectedWarehouseId: base.variant.warehouseId,
              expectedWarehouseFingerprint: base.warehouseFingerprint,
              expectedPiecesPerPack: base.variant.piecesPerPack,
              quantity: quantity.trim() || null,
              unitBasis: basis,
              kind,
              availability,
              confirmed,
              observedAt: new Date(observed).getTime(),
              ...(validUntil ? { validUntil: new Date(validUntil).getTime() } : {}),
              source,
              note,
            };
            const payload = JSON.stringify(args),
              key = retry?.payload === payload ? retry.key : globalThis.crypto.randomUUID();
            setRetry({ key, payload });
            await save({ ...args, requestKey: key });
            setSaved(true);
            setMessage(
              'Stock evidence saved. Original exclusions and manual release holds remain. Prices are unchanged.'
            );
          } catch (error) {
            setMessage(customerMessage(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          Assigned warehouse:{' '}
          {base.warehouse
            ? `${base.warehouse.code} · ${base.warehouse.originZip}`
            : 'Unknown — assign a documented warehouse first'}{' '}
          · {base.variant.piecesPerPack} piece(s) per selling pack.
        </p>
        <p>
          Use this warehouse only. Do not combine California and Florida stock, include quantities
          in transit, or treat an ETA as inventory. On-hand stock may include other allocations; it
          is not automatically available for new orders.
        </p>
        {stale && !saved && (
          <p role="alert">
            Stock, warehouse or pack changed. Your edits are retained; reload before saving.
          </p>
        )}
        <fieldset disabled={busy || saved} className="space-y-2">
          <label className="block">
            Stock source meaning
            <select
              className={input}
              value={kind}
              onChange={(e) => {
                const next = e.target.value as typeof kind;
                setKind(next);
                if (next === 'binary') setQuantity('');
              }}
            >
              <option value="unknown">Unknown</option>
              <option value="on_hand">Physical on-hand count</option>
              <option value="available_to_sell">
                Available for new orders after existing allocations
              </option>
              <option value="binary">Only in-stock / out-of-stock status</option>
            </select>
          </label>
          <label className="block">
            Supplier stock quantity (blank means unknown)
            <input
              className={input}
              disabled={kind === 'binary'}
              inputMode="decimal"
              pattern="[0-9]+(\.[0-9]{1,9})?"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <label className="block">
            Stock quantity basis
            <select
              className={input}
              value={basis}
              onChange={(e) => setBasis(e.target.value as typeof basis)}
            >
              <option value="unknown">Unknown</option>
              <option value="piece">Individual pieces</option>
              <option value="pack">Selling packs</option>
              <option value="piece_or_pack">
                Either pieces or packs — not otherwise ambiguous
              </option>
            </select>
          </label>
          <p>
            “Either pieces or packs” is equivalent only for a one-piece pack. It does not resolve a
            multi-piece pack or an unknown carton/pallet basis.
          </p>
          <label className="block">
            Supplier availability
            <select
              className={input}
              value={availability}
              onChange={(e) => setAvailability(e.target.value as typeof availability)}
            >
              <option value="unknown">Unknown</option>
              <option value="in_stock">In stock</option>
              <option value="out_of_stock">Out of stock</option>
              <option value="discontinued">Discontinued</option>
            </select>
          </label>
          {base.variant.availability === 'discontinued' && !latest.canReactivate && (
            <p>
              Reactivation requires an approver. Original exclusions are never automatically
              removed.
            </p>
          )}
          <label className="block">
            Stock source reference
            <input
              className={`${input} w-full`}
              required
              maxLength={1000}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </label>
          <label className="block">
            Stock observed at (local time)
            <input
              className={input}
              required
              type="datetime-local"
              value={observed}
              onChange={(e) => setObserved(e.target.value)}
            />
          </label>
          <label className="block">
            Source expires at (local time, if specified)
            <input
              className={input}
              type="datetime-local"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </label>
          <p>
            An earlier supplier expiry overrides the approved freshness period. Blank expiry does
            not extend the freshness policy.
          </p>
          <label className="block">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{' '}
            I verified this warehouse, quantity meaning, unit basis and availability against the
            source
          </label>
          <label className="block">
            Stock review note
            <textarea
              className={`${input} w-full`}
              required
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button className="border px-3 py-1" disabled={stale}>
            Save stock evidence
          </button>
        </fieldset>
        <p role="status">{message}</p>
        <button type="button" disabled={busy} onClick={reload}>
          Reload stock evidence (discard edits)
        </button>
        <details>
          <summary>Latest 20 stock revisions</summary>
          {latest.history.map((row) => (
            <p key={row._id}>
              {new Date(row.observedAt).toLocaleString()} · {row.source} ·{' '}
              {row.quantity ?? 'Unknown quantity'} / {row.unitBasis} · {row.kind} ·{' '}
              {row.availability} · {row.confirmed ? 'Source checked' : 'Unverified'} ·{' '}
              {row.createdBy}
            </p>
          ))}
        </details>
      </form>
    </details>
  );
}
