import React, { useState } from 'react';
import { useMutation } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { customerMessage } from '../../lib/errors';

type Reconciliation = NonNullable<FunctionReturnType<typeof api.dlvOperations.reconciliation>>;
export default function LegacyFreightReview({
  row,
  invoices,
  approver,
}: {
  row: Reconciliation['legacyFreight'][number];
  invoices: Reconciliation['invoices'];
  approver: boolean;
}) {
  const save = useMutation(api.dlvOperations.reviewLegacyFreight);
  const [resolution, setResolution] = useState<'matched_invoice' | 'duplicate_or_invalid'>(
    'matched_invoice'
  );
  const [selected, setSelected] = useState<Id<'dlvFreightInvoices'>[]>([]);
  const [evidence, setEvidence] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <details className="border p-3 space-y-2">
      <summary>
        Historical freight {row.invoiceRef}: ${(row.actualMinor / 100).toFixed(2)} —{' '}
        {row.review ? 'Reviewed' : 'Review required'}
      </summary>
      <p>
        Historical totals are not counted again. Match itemized invoice freight (excluding supplier
        fees), or document why this record is duplicate or invalid. Unresolved entries block final
        profit reporting.
      </p>
      {row.review && (
        <p>
          Latest decision: {row.review.resolution} · {row.review.note}. A correction creates a new
          audit record and requires a new final cost statement.
        </p>
      )}
      {!approver ? (
        <p>An approver must resolve this historical entry.</p>
      ) : (
        <>
          <label>
            Resolution
            <select
              className="block border p-2 w-full"
              value={resolution}
              onChange={(e) => setResolution(e.target.value as typeof resolution)}
            >
              <option value="matched_invoice">Match itemized invoice freight</option>
              <option value="duplicate_or_invalid">Document duplicate or invalid entry</option>
            </select>
          </label>
          {resolution === 'matched_invoice' && (
            <fieldset>
              <legend>Invoices for this supplier order</legend>
              {invoices.length === 0 && <p>Record the itemized invoice first.</p>}
              {invoices.map((i) => (
                <label className="block" key={i._id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(i._id)}
                    onChange={(e) =>
                      setSelected((ids) =>
                        e.target.checked ? [...ids, i._id] : ids.filter((id) => id !== i._id)
                      )
                    }
                  />{' '}
                  {i.reference} · Freight $
                  {((i.baseMinor + i.fuelMinor + i.accessorialMinor - i.creditMinor) / 100).toFixed(
                    2
                  )}
                </label>
              ))}
            </fieldset>
          )}
          <label>
            Review evidence
            <input
              className="block border p-2 w-full"
              maxLength={2000}
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
            />
          </label>
          <label>
            Decision explanation
            <textarea
              className="block border p-2 w-full"
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            disabled={
              busy ||
              !evidence.trim() ||
              !note.trim() ||
              (resolution === 'matched_invoice' && selected.length === 0)
            }
            onClick={async () => {
              setBusy(true);
              try {
                await save({
                  legacyId: row._id,
                  resolution,
                  invoiceIds: resolution === 'matched_invoice' ? selected : [],
                  evidence,
                  note,
                });
                setMessage(
                  'Review recorded. Reconcile the final cost statement; customer charges are unchanged.'
                );
              } catch (error) {
                setMessage(customerMessage(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            Record historical review
          </button>
        </>
      )}
      <p role="status">{message}</p>
    </details>
  );
}
