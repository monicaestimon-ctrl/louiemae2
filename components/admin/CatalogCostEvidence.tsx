import React, { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import type { Id } from '../../convex/_generated/dataModel';
import { api } from '../../convex/_generated/api';
import { customerMessage } from '../../lib/errors';
import { dollarsToMinor } from '../../lib/decimal';

type Detail = FunctionReturnType<typeof api.catEvidence.detail>;
type Expense = { state: 'unknown' | 'confirmed_zero' | 'amount'; dollars: string };
function expense(minor: number | null | undefined, zero: boolean | undefined): Expense {
  return minor && minor > 0
    ? { state: 'amount', dollars: (minor / 100).toFixed(2) }
    : { state: zero ? 'confirmed_zero' : 'unknown', dollars: '' };
}

export default function CatalogCostEvidence({ variantId }: { variantId: Id<'catVariants'> }) {
  const data = useQuery(api.catEvidence.detail, { variantId });
  const [generation, setGeneration] = useState(0);
  if (!data) return <p role="status">Loading cost evidence…</p>;
  return (
    <CostForm
      key={`${variantId}:${generation}`}
      initial={data}
      latest={data}
      reload={() => setGeneration((n) => n + 1)}
    />
  );
}

function CostForm({
  initial,
  latest,
  reload,
}: {
  initial: Detail;
  latest: Detail;
  reload: () => void;
}) {
  const save = useMutation(api.catEvidence.recordCost);
  // Keep the base revision stable while reactive queries receive another staff member's edits.
  const [base] = useState(initial);
  const cost = base.current;
  const [wholesale, setWholesale] = useState(
    cost?.wholesalePrecise ??
      (cost?.wholesaleMinor == null ? '' : (cost.wholesaleMinor / 100).toFixed(2))
  );
  const [verified, setVerified] = useState(false);
  const [observed, setObserved] = useState('');
  const [evidence, setEvidence] = useState('');
  const [note, setNote] = useState('');
  const [expenses, setExpenses] = useState({
    duties: expense(cost?.dutiesMinor, cost?.dutiesConfirmedZero),
    inbound: expense(cost?.inboundFreightMinor, cost?.inboundConfirmedZero),
    fees: expense(cost?.supplierFeesMinor, cost?.feesConfirmedZero),
  });
  const [mapState, setMapState] = useState<'unknown' | 'not_applicable' | 'explicit_sku'>(
    cost?.mapApplicability === 'not_applicable'
      ? 'not_applicable'
      : cost?.mapSource === 'explicit_sku'
        ? 'explicit_sku'
        : 'unknown'
  );
  const [map, setMap] = useState(cost?.mapMinor == null ? '' : (cost.mapMinor / 100).toFixed(2));
  const [basis, setBasis] = useState<'piece' | 'pack'>(cost?.mapUnitBasis ?? 'piece');
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [retry, setRetry] = useState<{ payload: string; key: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const stale = (base.current?._id ?? null) !== (latest.current?._id ?? null);
  const labels = { duties: 'Duties', inbound: 'Inbound freight', fees: 'Other supplier fees' };
  const convert = (e: Expense) =>
    e.state === 'amount'
      ? { state: 'amount' as const, minor: dollarsToMinor(e.dollars, 'half_up') }
      : { state: e.state };
  return (
    <form
      className="space-y-3 border p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage('');
        try {
          const args = {
            variantId: base.variant._id,
            expectedRevisionId: base.current?._id ?? null,
            wholesaleUsd: wholesale.trim() || null,
            verified,
            observedAt: new Date(observed).getTime(),
            evidence,
            note,
            duties: convert(expenses.duties),
            inbound: convert(expenses.inbound),
            fees: convert(expenses.fees),
            map:
              mapState === 'explicit_sku'
                ? { state: mapState, minor: dollarsToMinor(map, 'half_up'), basis }
                : { state: mapState },
          };
          const payload = JSON.stringify(args);
          const key = retry?.payload === payload ? retry.key : globalThis.crypto.randomUUID();
          setRetry({ payload, key });
          await save({ ...args, requestKey: key });
          setSaved(true);
          setMessage(
            'Evidence saved. Prices are unchanged. Qualification and release review are still required.'
          );
        } catch (error) {
          setMessage(customerMessage(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h4>
        Cost evidence · {base.variant.supplierSku} · {base.variant.piecesPerPack} piece(s) per
        selling pack
      </h4>
      <p>
        USD only. Wholesale is per piece; additional expenses are per selling pack. Do not include
        customer delivery freight or the separately modeled $10 handling allowance again.
      </p>
      {stale && !saved && (
        <p role="alert">
          This record changed. Your edits are retained; reload and reconcile before saving.
        </p>
      )}
      <fieldset disabled={busy || saved} className="space-y-3">
        <label className="block">
          Wholesale USD per piece (blank means unknown)
          <input
            className="border block"
            value={wholesale}
            onChange={(e) => setWholesale(e.target.value)}
            inputMode="decimal"
          />
        </label>
        {(['duties', 'inbound', 'fees'] as const).map((key) => (
          <div key={key}>
            <label>
              {labels[key]} per pack
              <select
                className="border ml-2"
                value={expenses[key].state}
                onChange={(e) =>
                  setExpenses({
                    ...expenses,
                    [key]: { ...expenses[key], state: e.target.value as Expense['state'] },
                  })
                }
              >
                <option value="unknown">Unknown</option>
                <option value="confirmed_zero">Documented zero</option>
                <option value="amount">Known amount</option>
              </select>
            </label>
            {expenses[key].state === 'amount' && (
              <label className="ml-2">
                {labels[key]} USD
                <input
                  required
                  pattern="[0-9]+(\.[0-9]{1,2})?"
                  className="border"
                  value={expenses[key].dollars}
                  onChange={(e) =>
                    setExpenses({
                      ...expenses,
                      [key]: { ...expenses[key], dollars: e.target.value },
                    })
                  }
                />
              </label>
            )}
          </div>
        ))}
        <label className="block">
          MAP status
          <select
            className="border ml-2"
            value={mapState}
            onChange={(e) => setMapState(e.target.value as typeof mapState)}
          >
            <option value="unknown">Unknown / review required</option>
            <option value="explicit_sku">Explicit SKU minimum</option>
            <option value="not_applicable" disabled={!latest.canApproveMap}>
              Documented exemption (approver)
            </option>
          </select>
        </label>
        {mapState === 'explicit_sku' && (
          <div>
            <label>
              MAP USD
              <input
                required
                pattern="[0-9]+(\.[0-9]{1,2})?"
                className="border"
                value={map}
                onChange={(e) => setMap(e.target.value)}
              />
            </label>
            <label>
              MAP unit
              <select
                className="border"
                value={basis}
                onChange={(e) => setBasis(e.target.value as typeof basis)}
              >
                <option value="piece">Per piece</option>
                <option value="pack">Per selling pack</option>
              </select>
            </label>
          </div>
        )}
        <p>Policy-derived MAP requires separate policy review. Zero MAP is not an exemption.</p>
        <label className="block">
          Evidence reference
          <input
            required
            maxLength={1000}
            className="border block w-full"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
          />
        </label>
        <label className="block">
          Source observation time (your local time)
          <input
            required
            type="datetime-local"
            className="border block"
            value={observed}
            onChange={(e) => setObserved(e.target.value)}
          />
        </label>
        <label className="block">
          <input
            type="checkbox"
            checked={verified}
            onChange={(e) => setVerified(e.target.checked)}
          />{' '}
          I verified wholesale and MAP against this source at the stated time
        </label>
        <label className="block">
          Review note / basis for zero expenses
          <textarea
            required
            maxLength={1000}
            className="border block w-full"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button
          className="border px-3 py-1"
          disabled={stale || (mapState === 'not_applicable' && !latest.canApproveMap)}
        >
          Save evidence revision
        </button>
      </fieldset>
      <p role="status">{message}</p>
      <button type="button" disabled={busy} className="underline" onClick={reload}>
        Reload latest evidence (discard edits)
      </button>
      <details>
        <summary>Latest 20 cost revisions</summary>
        <ul>
          {latest.history.map((row) => (
            <li key={row._id}>
              {new Date(row.createdAt).toLocaleString()} · {row.createdBy} · {row.costSource} ·{' '}
              {row.verifiedAt
                ? `Source verified ${new Date(row.verifiedAt).toLocaleString()}`
                : 'Unverified'}{' '}
              · Wholesale{' '}
              {row.wholesalePrecise ??
                (row.wholesaleMinor == null ? 'unknown' : (row.wholesaleMinor / 100).toFixed(2))}
            </li>
          ))}
        </ul>
      </details>
    </form>
  );
}
