import React, { useState } from 'react';
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { CartonEvidence } from '../../lib/shipping/evidence';
import { warehouseCurrent } from '../../lib/shipping/evidence';
import { customerMessage } from '../../lib/errors';
import DeliveryBoundary from '../delivery/DeliveryBoundary';
import CatalogStockEvidence from './CatalogStockEvidence';
import InventoryCommitments from './InventoryCommitments';

type Detail = FunctionReturnType<typeof api.catShipping.detail>;
const blankCarton = (): CartonEvidence => ({
  count: 1,
  length: '',
  width: '',
  height: '',
  weight: '',
  dimensionsUnit: 'in',
  weightUnit: 'lb',
  supplierMethod: 'unknown',
});
const input = 'border p-1 max-w-full';

export default function CatalogShippingEvidence() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.catShipping.records,
    {},
    { initialNumItems: 20 }
  );
  const [selected, setSelected] = useState<Id<'catVariants'> | null>(null);
  return (
    <details className="border p-4 space-y-3">
      <summary>Warehouse and shipping carton evidence</summary>
      <p>
        Shipping measurements describe one selling pack. These controls do not change product prices
        or publish listings.
      </p>
      <div className="flex flex-wrap gap-2">
        {results.map((row) => (
          <button
            className={input}
            key={row.id}
            aria-pressed={selected === row.id}
            onClick={() => setSelected(row.id)}
          >
            {row.sku} · {row.piecesPerPack} piece(s) · {row.availability}
          </button>
        ))}
      </div>
      {status === 'LoadingFirstPage' && <p role="status">Loading variants…</p>}
      {status === 'CanLoadMore' && (
        <button onClick={() => loadMore(20)}>Load more shipping records</button>
      )}
      {selected && (
        <DeliveryBoundary key={selected}>
          <ShippingDetail variantId={selected} />
        </DeliveryBoundary>
      )}
    </details>
  );
}
function ShippingDetail({ variantId }: { variantId: Id<'catVariants'> }) {
  const data = useQuery(api.catShipping.detail, { variantId });
  const [generation, setGeneration] = useState(0);
  if (!data) return <p role="status">Loading shipping evidence…</p>;
  return (
    <div>
      <CartonForm
        key={generation}
        initial={data}
        latest={data}
        reload={() => setGeneration((n) => n + 1)}
      />
      <CatalogStockEvidence variantId={variantId} />
      <InventoryCommitments key={variantId} variantId={variantId} />
      {data.canApprove && <WarehouseEditor data={data} />}
    </div>
  );
}

function CartonForm({
  initial,
  latest,
  reload,
}: {
  initial: Detail;
  latest: Detail;
  reload: () => void;
}) {
  const [base] = useState(initial);
  const [rows, setRows] = useState<CartonEvidence[]>(() =>
    base.cartons.length
      ? base.cartons.map((c) => ({
          count: c.cartonsPerPack,
          length: String(c.lengthMm),
          width: String(c.widthMm),
          height: String(c.heightMm),
          weight: String(c.grossWeightG),
          dimensionsUnit: 'mm',
          weightUnit: 'g',
          supplierMethod: c.supplierMethod,
        }))
      : [blankCarton()]
  );
  const [warehouse, setWarehouse] = useState(base.warehouse?._id ?? ('' as string));
  const [evidence, setEvidence] = useState(''),
    [observed, setObserved] = useState(''),
    [note, setNote] = useState('');
  const [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [message, setMessage] = useState('');
  const [retry, setRetry] = useState<{ key: string; payload: string } | null>(null);
  const save = useMutation(api.catShipping.saveCartons);
  const stale = base.fingerprint !== latest.fingerprint;
  function edit(index: number, value: Partial<CartonEvidence>) {
    setRows(rows.map((row, i) => (i === index ? { ...row, ...value } : row)));
  }
  return (
    <form
      className="space-y-3 mt-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage('');
        try {
          const args = {
            variantId: base.variant.id,
            expectedFingerprint: base.fingerprint,
            warehouseId: warehouse ? (warehouse as Id<'catWarehouses'>) : null,
            cartons: rows,
            evidence,
            observedAt: new Date(observed).getTime(),
            note,
          };
          const payload = JSON.stringify(args),
            key = retry?.payload === payload ? retry.key : globalThis.crypto.randomUUID();
          setRetry({ key, payload });
          await save({ ...args, requestKey: key });
          setSaved(true);
          setMessage(
            'Shipping evidence saved. Prices are unchanged; delivery and economics release review is required.'
          );
        } catch (error) {
          setMessage(customerMessage(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h4>
        Shipping evidence · {base.variant.sku} · {base.variant.piecesPerPack} piece(s) per selling
        pack
      </h4>
      {stale && !saved && (
        <p role="alert">
          Shipping evidence changed. Your edits are retained; reload and reconcile before saving.
        </p>
      )}
      <fieldset disabled={busy || saved} className="space-y-3">
        <label className="block">
          Fulfillment warehouse
          <select
            className={input}
            value={warehouse}
            onChange={(e) => setWarehouse(e.target.value)}
          >
            <option value="">Unknown — review required</option>
            {latest.warehouses.map((w) => (
              <option key={w._id} value={w._id} disabled={!warehouseCurrent(w, Date.now())}>
                {w.code} · {w.originZip} ·{' '}
                {warehouseCurrent(w, Date.now()) ? 'Documented' : 'Needs review'}
              </option>
            ))}
          </select>
        </label>
        <p>
          Use packaged shipping dimensions and gross weights, not assembled product dimensions.
          Count identical cartons once per selling pack; do not multiply by pieces. Warehouse cutoff
          is operational evidence, not a delivery-date promise.
        </p>
        {rows.map((row, index) => (
          <fieldset key={index} className="border p-2 flex flex-wrap gap-2">
            <legend>Carton type {index + 1}</legend>
            <label>
              Carton count
              <input
                className={input}
                required
                type="number"
                min={1}
                max={100}
                step={1}
                value={row.count}
                onChange={(e) => edit(index, { count: Number(e.target.value) })}
              />
            </label>
            {(['length', 'width', 'height', 'weight'] as const).map((field) => (
              <label key={field}>
                {field === 'weight' ? 'Gross weight' : field}
                <input
                  className={`${input} w-24`}
                  required
                  inputMode="decimal"
                  pattern="[0-9]+(\.[0-9]{1,6})?"
                  value={row[field]}
                  onChange={(e) => edit(index, { [field]: e.target.value })}
                />
              </label>
            ))}
            <label>
              Dimension unit
              <select
                className={input}
                value={row.dimensionsUnit}
                onChange={(e) => edit(index, { dimensionsUnit: e.target.value as 'in' | 'mm' })}
              >
                <option value="in">Inches</option>
                <option value="mm">Millimeters</option>
              </select>
            </label>
            <label>
              Weight unit
              <select
                className={input}
                value={row.weightUnit}
                onChange={(e) => edit(index, { weightUnit: e.target.value as 'lb' | 'g' })}
              >
                <option value="lb">Pounds</option>
                <option value="g">Grams</option>
              </select>
            </label>
            <label>
              Supplier routing
              <select
                className={input}
                value={row.supplierMethod}
                onChange={(e) =>
                  edit(index, {
                    supplierMethod: e.target.value as CartonEvidence['supplierMethod'],
                  })
                }
              >
                <option value="unknown">Unknown</option>
                <option value="ground">Ground</option>
                <option value="ltl">LTL required</option>
              </select>
            </label>
            <button
              type="button"
              disabled={rows.length === 1}
              onClick={() => setRows(rows.filter((_, i) => i !== index))}
            >
              Remove carton type {index + 1}
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          disabled={rows.length >= 20}
          onClick={() => setRows([...rows, blankCarton()])}
        >
          Add carton type
        </button>
        <p>
          Changing a unit changes the interpretation of the entered value; it does not convert the
          displayed number.
        </p>
        <label className="block">
          Shipping source reference
          <input
            className={`${input} w-full`}
            required
            maxLength={1000}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
          />
        </label>
        <label className="block">
          Shipping observed at (local time)
          <input
            className={input}
            required
            type="datetime-local"
            value={observed}
            onChange={(e) => setObserved(e.target.value)}
          />
        </label>
        <label className="block">
          Shipping review note
          <textarea
            className={`${input} w-full`}
            required
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button className={input} disabled={stale}>
          Save shipping evidence
        </button>
      </fieldset>
      <p role="status">{message}</p>
      <button type="button" disabled={busy} onClick={reload}>
        Reload shipping evidence (discard edits)
      </button>
      <details>
        <summary>Latest 20 shipping evidence records</summary>
        {latest.history.map((row) => (
          <details key={row._id}>
            <summary>
              {new Date(row.observedAt).toLocaleString()} · {row.sourceFile} · {row.verifier}
            </summary>
            <pre className="overflow-auto max-h-64 text-xs">{row.extractedValue}</pre>
          </details>
        ))}
      </details>
    </form>
  );
}

function WarehouseEditor({ data }: { data: Detail }) {
  const [selected, setSelected] = useState(''),
    [generation, setGeneration] = useState(0);
  const warehouse = data.warehouses.find((w) => w._id === selected) ?? null;
  return (
    <details className="border p-3 mt-4">
      <summary>Approve warehouse evidence</summary>
      <label>
        Warehouse record
        <select
          className={input}
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setGeneration((n) => n + 1);
          }}
        >
          <option value="">New warehouse</option>
          {data.warehouses.map((w) => (
            <option key={w._id} value={w._id}>
              {w.code} · {w.originZip}
            </option>
          ))}
        </select>
      </label>
      <WarehouseForm
        key={`${selected}:${generation}`}
        data={data}
        initial={warehouse}
        reload={() => setGeneration((n) => n + 1)}
      />
    </details>
  );
}
function WarehouseForm({
  data,
  initial,
  reload,
}: {
  data: Detail;
  initial: Detail['warehouse'];
  reload: () => void;
}) {
  const [base] = useState(initial);
  const [form, setForm] = useState({
    code: base?.code ?? '',
    originZip: base?.originZip ?? '',
    state: base?.state ?? '',
    timezone: base?.timezone ?? '',
    cutoffLocal: base?.cutoffLocal ?? '',
    active: base?.active ?? true,
    evidence: '',
    observed: '',
    until: '',
  });
  const [services, setServices] = useState<('ground' | 'ltl')[]>(base?.services ?? []);
  const [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [message, setMessage] = useState('');
  const [retry, setRetry] = useState<{ key: string; payload: string } | null>(null);
  const save = useMutation(api.catShipping.saveWarehouse);
  const latest = data.warehouses.find((w) => w._id === base?._id);
  const stale = !!base && (base.updatedAt ?? null) !== (latest?.updatedAt ?? null);
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage('');
        try {
          const { observed, until, ...fields } = form;
          const args = {
            ...fields,
            supplierId: data.variant.supplierId,
            warehouseId: base?._id ?? null,
            expectedUpdatedAt: base?.updatedAt ?? null,
            services,
            observedAt: new Date(observed).getTime(),
            validUntil: new Date(until).getTime(),
          };
          const payload = JSON.stringify(args),
            key = retry?.payload === payload ? retry.key : globalThis.crypto.randomUUID();
          setRetry({ key, payload });
          await save({ ...args, requestKey: key });
          setSaved(true);
          setMessage(
            'Warehouse evidence saved. Reload the shipping form to assign it. Existing estimates must be recalculated.'
          );
        } catch (error) {
          setMessage(customerMessage(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>
        Verify ZIP/state against the supplier source. Creating a warehouse does not approve carrier
        rates, delivery fees, stock, or a delivery-date guarantee. Editing an assigned warehouse
        invalidates dependent estimates.
      </p>
      {stale && !saved && <p role="alert">Warehouse changed; reload before saving.</p>}
      <fieldset disabled={busy || saved} className="flex flex-wrap gap-3">
        {(
          [
            ['code', 'Warehouse code'],
            ['originZip', 'Origin ZIP'],
            ['state', 'State abbreviation'],
            ['timezone', 'IANA timezone'],
            ['cutoffLocal', 'Local dispatch cutoff'],
            ['evidence', 'Warehouse evidence reference'],
            ['observed', 'Warehouse observed at (local time)'],
            ['until', 'Warehouse evidence valid until (local time)'],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              className={`${input} block`}
              required
              maxLength={key === 'evidence' ? 1000 : 80}
              type={
                key === 'observed' || key === 'until'
                  ? 'datetime-local'
                  : key === 'cutoffLocal'
                    ? 'time'
                    : 'text'
              }
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />{' '}
          Warehouse active
        </label>
        {(['ground', 'ltl'] as const).map((service) => (
          <label key={service}>
            <input
              type="checkbox"
              checked={services.includes(service)}
              onChange={(e) =>
                setServices(
                  e.target.checked ? [...services, service] : services.filter((s) => s !== service)
                )
              }
            />{' '}
            {service} dispatch documented
          </label>
        ))}
        <button className={input} disabled={stale}>
          Save warehouse evidence
        </button>
      </fieldset>
      <p role="status">{message}</p>
      <button type="button" disabled={busy} onClick={reload}>
        Reload warehouse (discard edits)
      </button>
    </form>
  );
}
