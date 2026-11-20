import React, { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import type { Id } from '../../convex/_generated/dataModel';
import { api } from '../../convex/_generated/api';
import { customerMessage } from '../../lib/errors';

export default function InventoryCommitments({ variantId }: { variantId: Id<'catVariants'> }) {
  const data = useQuery(api.ordInventory.pending, { variantId });
  const reconcile = useMutation(api.ordInventory.reconcile);
  const [selected, setSelected] = useState<Id<'ordInventoryReservations'> | null>(null);
  const [revision, setRevision] = useState<Id<'catStockRevisions'> | null>(null);
  const [evidence, setEvidence] = useState(''),
    [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState<{ payload: string; key: string } | null>(null);
  if (!data) return <p role="status">Loading inventory commitments…</p>;
  const stale =
    !!selected &&
    (revision !== data.currentRevisionId || !data.rows.some((r) => r.id === selected));
  return (
    <details className="border p-3 mt-4">
      <summary>Paid inventory commitments awaiting supplier reconciliation</summary>
      <p>
        Paid quantities remain deducted until a newer verified supplier count accounts for the
        allocation. An internal checkout hold does not reserve stock at Zuo. A new feed alone does
        not release these commitments.
      </p>
      {!data.rows.length && <p>No unreconciled paid commitments for this variant.</p>}
      <ul>
        {data.rows.map((row) => (
          <li key={row.id}>
            {row.packs} pack(s) · checkout {row.intentId} · {row.piecesPerPack ?? 'Unknown'} pieces
            per pack
            {data.canReconcile && (
              <button
                className="border p-1 m-1"
                disabled={busy}
                onClick={() => {
                  setSelected(row.id);
                  setRevision(data.currentRevisionId);
                  setEvidence('');
                  setNote('');
                  setConfirmed(false);
                  setMessage('');
                  setRetry(null);
                }}
              >
                Review allocation {row.id}
              </button>
            )}
          </li>
        ))}
      </ul>
      {data.hasMore && (
        <p>
          The first 50 pending allocations are shown. Further entries appear as these are
          reconciled.
        </p>
      )}
      {selected && data.canReconcile && (
        <form
          className="space-y-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!revision || stale) return;
            setBusy(true);
            setMessage('');
            try {
              const args = {
                reservationId: selected,
                expectedRevisionId: revision,
                evidence,
                note,
                confirmed,
              };
              const payload = JSON.stringify(args),
          key = retry?.payload === payload ? retry.key : globalThis.crypto.randomUUID();
              setRetry({ payload, key });
              await reconcile({ ...args, requestKey: key });
              setSelected(null);
              setConfirmed(false);
              setMessage(
                'Supplier allocation reconciled. Order and payment records are unchanged.'
              );
            } catch (error) {
              setMessage(customerMessage(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>
            Selected allocation: {selected}. Current stock revision: {revision ?? 'Missing'}.
          </p>
          <label className="block">
            Supplier allocation evidence reference
            <input
              className="border block"
              required
              minLength={3}
              maxLength={1000}
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
            />
          </label>
          <label className="block">
            Reconciliation note
            <textarea
              className="border block"
              required
              minLength={3}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <label className="block">
            <input
              type="checkbox"
              required
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I verified that this newer warehouse available-to-sell count already accounts for this
            exact paid allocation.
          </label>
          {stale && (
            <p role="alert">
              Stock or allocation changed. Review the allocation again before saving; your current
              notes remain above.
            </p>
          )}
          <button disabled={busy || stale || !revision || !confirmed} className="border p-2">
            {busy ? 'Saving…' : 'Reconcile supplier allocation'}
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
