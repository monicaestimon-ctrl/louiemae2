import React, { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import type { Id } from '../../convex/_generated/dataModel';
import { api } from '../../convex/_generated/api';
import { customerMessage } from '../../lib/errors';

type Detail = FunctionReturnType<typeof api.ordExceptionFulfillment.detail>;
export default function OriginalOrderRecovery({
  id,
  verificationId,
  eligible,
}: {
  id: Id<'ordPaidExceptions'>;
  verificationId: Id<'ordPaymentVerifications'>;
  eligible: boolean;
}) {
  const data = useQuery(api.ordExceptionFulfillment.detail, { id });
  const [generation, setGeneration] = useState(0);
  if (!data) return <p role="status">Loading original order terms…</p>;
  return (
    <RecoveryForm
      key={generation}
      id={id}
      verificationId={verificationId}
      eligible={eligible}
      initial={data}
      latest={data}
      reload={() => setGeneration((n) => n + 1)}
    />
  );
}
function RecoveryForm({
  id,
  verificationId,
  eligible,
  initial,
  latest,
  reload,
}: {
  id: Id<'ordPaidExceptions'>;
  verificationId: Id<'ordPaymentVerifications'>;
  eligible: boolean;
  initial: Detail;
  latest: Detail;
  reload: () => void;
}) {
  const [base] = useState(initial),
    [proof] = useState(verificationId);
  const [lines, setLines] = useState(() =>
    base.lines.map((line) => ({ lineKey: line.lineKey, source: '', observed: '', quantity: '' }))
  );
  const [agreement, setAgreement] = useState(''),
    [cost, setCost] = useState(false),
    [handoff, setHandoff] = useState(false);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [retry, setRetry] = useState<{ payload: string; key: string } | null>(null);
  const resume = useMutation(api.ordExceptionFulfillment.resumeOriginal);
  const stale =
    base.fingerprint !== latest.fingerprint ||
    proof !== verificationId ||
    !eligible ||
    latest.status !== 'open';
  return (
    <form
      className="border p-4 space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (stale || !latest.canApprove) return;
        setBusy(true);
        setMessage('');
        try {
          const args = {
            id,
            verificationId: proof,
            expectedFingerprint: base.fingerprint,
            customerAgreement: agreement,
            acceptedCostRisk: cost,
            noPriorSupplierHandoff: handoff,
            confirmations: lines.map((line) => ({
              lineKey: line.lineKey,
              source: line.source,
              observedAt: new Date(line.observed).getTime(),
              availablePacks: Number(line.quantity),
            })),
          };
          const payload = JSON.stringify(args),
            key = retry?.payload === payload ? retry.key : globalThis.crypto.randomUUID();
          setRetry({ payload, key });
          const orderId = await resume({ ...args, requestKey: key });
          setMessage(
            `Original order recovered: ${orderId}. No new payment was created. Supplier orders are queued for manual handoff.`
          );
        } catch (error) {
          setMessage(customerMessage(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h4>Resume the original paid order</h4>
      <p>
        Accepted cash total: ${(base.totalMinor / 100).toFixed(2)}. Applied store credit: $
        {(base.creditMinor / 100).toFixed(2)}.
      </p>
      <p>
        {base.serviceTerms?.label ?? 'Missing delivery terms — needs investigation'} ·{' '}
        {base.shippingAddress
          ? `${base.shippingAddress.line1}, ${base.shippingAddress.city}, ${base.shippingAddress.state} ${base.shippingAddress.postalCode}`
          : 'Missing address — needs investigation'}
      </p>
      <p>
        Prices, address, quantities, delivery terms and referral rates stay as accepted. This cannot
        substitute products or charge an additional amount. Any changed supplier cost remains our
        responsibility.
      </p>
      {base.lines.map((line, index) => (
        <fieldset className="border p-2" key={line.lineKey}>
          <legend>
            {line.name} · {line.supplierCode} · SKU {line.sku ?? 'Unknown'}
          </legend>
          <p>
            {line.packs} selling pack(s), {line.pieces} physical piece(s). Origin{' '}
            {line.originZip || 'Existing supplier route'} · {line.service}
          </p>
          <label className="block">
            Supplier confirmation source for {line.sku}
            <input
              className="border block w-full"
              required
              minLength={5}
              maxLength={1000}
              value={lines[index].source}
              onChange={(e) =>
                setLines((old) =>
                  old.map((l, i) => (i === index ? { ...l, source: e.target.value } : l))
                )
              }
            />
          </label>
          <label className="block">
            Confirmation time for {line.sku}
            <input
              className="border block"
              type="datetime-local"
              required
              value={lines[index].observed}
              onChange={(e) =>
                setLines((old) =>
                  old.map((l, i) => (i === index ? { ...l, observed: e.target.value } : l))
                )
              }
            />
          </label>
          <label className="block">
            Available selling packs for {line.sku}
            <input
              className="border block"
              type="number"
              min={line.packs}
              max={1000000}
              step={1}
              required
              value={lines[index].quantity}
              onChange={(e) =>
                setLines((old) =>
                  old.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l))
                )
              }
            />
          </label>
        </fieldset>
      ))}
      <label className="block">
        Customer agreement to original fulfillment
        <textarea
          className="border block w-full"
          required
          minLength={5}
          maxLength={1000}
          value={agreement}
          onChange={(e) => setAgreement(e.target.value)}
        />
      </label>
      <label className="block">
        <input
          type="checkbox"
          required
          checked={cost}
          onChange={(e) => setCost(e.target.checked)}
        />{' '}
        I confirmed the original delivery service can be provided and accept current
        supplier/delivery costs without changing the customer total or earned commission terms.
      </label>
      <label className="block">
        <input
          type="checkbox"
          required
          checked={handoff}
          onChange={(e) => setHandoff(e.target.checked)}
        />{' '}
        I verified no supplier order has already been submitted for this checkout.
      </label>
      {stale && (
        <p role="alert">
          Payment or order inputs changed. Notes remain visible. Refresh payment verification and
          reload the recovery form before submitting.
        </p>
      )}
      <button type="button" className="border p-2" disabled={busy} onClick={reload}>
        Reload recovery form (discard edits)
      </button>
      <button
        className="border p-2"
        disabled={busy || stale || !cost || !handoff || !latest.canApprove}
      >
        {busy ? 'Recovering…' : 'Recover original paid order'}
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
