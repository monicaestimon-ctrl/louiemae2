import React, { useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import type { FunctionArgs, FunctionReturnType } from 'convex/server';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { commerceErrorData, customerMessage } from '../../lib/errors';
import { dollarsToMinor } from '../../lib/decimal';

type Detail = FunctionReturnType<typeof api.ordFulfillment.shipmentDetail>;
const field = 'border p-2 block w-full',
  button = 'border p-2';

/** An uncertain response locks the original payload until an exact retry confirms its outcome. */
function useRecordedRequest<T extends { requestKey: string }>(save: (a: T) => Promise<unknown>) {
  const running = useRef(false);
  const [pending, setPending] = useState<T | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  async function run(args: T, onSuccess?: () => void) {
    if (running.current) return;
    running.current = true;
    setPending(args);
    setBusy(true);
    setMessage('');
    try {
      await save(args);
      setPending(null);
      setMessage('Saved.');
      onSuccess?.();
    } catch (error) {
      setMessage(customerMessage(error));
      // A typed rejection rolled back; an unknown transport failure may have committed.
      if (commerceErrorData(error)) setPending(null);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return { pending, busy, message, run };
}

export default function FulfillmentShipments({
  supplierOrderId,
}: {
  supplierOrderId: Id<'ordSupplierOrders'>;
}) {
  const data = useQuery(api.ordFulfillment.shipmentDetail, { supplierOrderId });
  const acknowledge = useMutation(api.ordFulfillment.acknowledge),
    delivered = useMutation(api.ordFulfillment.markDelivered);
  const [confirmation, setConfirmation] = useState(''),
    [cost, setCost] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  if (!data) return <p role="status">Loading supplier shipments…</p>;
  return (
    <section className="border p-3 space-y-4" aria-label={`Shipments for ${data.number}`}>
      <h4>Fulfillment for {data.number}</h4>
      <p>
        {data.address
          ? [
              data.address.line1,
              data.address.line2,
              data.address.city,
              data.address.state,
              data.address.postalCode,
              data.address.country,
            ]
              .filter(Boolean)
              .join(', ')
          : 'Delivery address needs review'}
      </p>
      <p>{data.serviceTerms?.label ?? data.supplierOrder.service}</p>
      {['submitted', 'acknowledged'].includes(data.supplierOrder.status) && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage('');
            try {
              await acknowledge({
                supplierOrderId,
                confirmation,
                ...(cost ? { invoicedCostMinor: dollarsToMinor(cost, 'half_up') } : {}),
              });
              setMessage('Supplier acknowledgement recorded.');
            } catch (error) {
              setMessage(customerMessage(error));
            } finally {
              setBusy(false);
            }
          }}
          className="space-y-2"
        >
          <label>
            Supplier acknowledgement reference
            <input
              className={field}
              required
              maxLength={500}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
          <label>
            Confirmed supplier amount in dollars (optional)
            <input
              className={field}
              inputMode="decimal"
              pattern="\d+(\.\d{1,2})?"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </label>
          <button className={button} disabled={busy}>
            Record acknowledgement
          </button>
        </form>
      )}
      <ShipmentForm data={data} />
      <CancellationForm data={data} />
      <h5>Recorded shipments</h5>
      {!data.shipments.length && <p>No shipments recorded.</p>}
      {data.shipments.map((s) => (
        <section
          className="border p-3 space-y-2"
          key={s._id}
          aria-label={`Shipment ${s.trackingNumber ?? s._id}`}
        >
          <p>
            {s.carrier ?? 'Carrier not recorded'} · {s.trackingNumber ?? 'No tracking number'} ·{' '}
            {s.status}
          </p>
          <ul>
            {s.items.map((item, i) => (
              <li key={i}>
                {item.name} — {item.pieces} physical piece(s)
              </li>
            ))}
          </ul>
          {s.activeIssue && (
            <p role="status">
              {s.activeIssue.kind.replaceAll('_', ' ')}: {s.activeIssue.message}
            </p>
          )}
          {s.status !== 'delivered' && (
            <button
              className={button}
              disabled={busy || !!s.activeIssue || s.status !== 'shipped'}
              onClick={async () => {
                setBusy(true);
                setMessage('');
                try {
                  await delivered({ shipmentId: s._id });
                  setMessage('Delivery recorded for this shipment only.');
                } catch (error) {
                  setMessage(customerMessage(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirm this shipment was delivered
            </button>
          )}
          <IssueForm shipment={s} />
        </section>
      ))}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

function ShipmentForm({ data }: { data: Detail }) {
  const save = useMutation(api.ordFulfillment.recordShipment);
  const request = useRecordedRequest<FunctionArgs<typeof api.ordFulfillment.recordShipment>>(save);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [carrier, setCarrier] = useState(''),
    [tracking, setTracking] = useState(''),
    [url, setUrl] = useState(''),
    [window, setWindow] = useState('');
  const canShip =
    !!data.supplierOrder.submission.handoffAt &&
    ['submitted', 'acknowledged', 'partially_shipped', 'shipped'].includes(
      data.supplierOrder.status
    );
  const clear = () => {
    setQuantities({});
    setCarrier('');
    setTracking('');
    setUrl('');
    setWindow('');
  };
  return (
    <div className="space-y-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const items = data.items
            .filter((i) => Number(quantities[i.allocationId]) > 0)
            .map((i) => ({
              allocationId: i.allocationId,
              pieces: Number(quantities[i.allocationId]),
            }));
          void request.run(
            {
              supplierOrderId: data.supplierOrder._id,
              requestKey: globalThis.crypto.randomUUID(),
              items,
              ...(carrier ? { carrier } : {}),
              ...(tracking ? { trackingNumber: tracking } : {}),
              ...(url ? { trackingUrl: url } : {}),
              ...(window ? { estimatedWindow: window } : {}),
            },
            clear
          );
        }}
      >
        <fieldset disabled={!canShip || request.busy || !!request.pending} className="space-y-2">
          <legend>Record a shipment</legend>
          {!canShip && <p>Record the supplier handoff before entering shipments.</p>}
          <p>
            Enter physical pieces actually dispatched, not selling packs. This queues a customer
            shipment update.
          </p>
          {data.items.map((i) => (
            <label key={i.allocationId} className="block">
              {i.name} ({i.sku}) — {i.remainingPieces} piece(s) remaining
              <input
                className={field}
                aria-label={`Pieces shipped: ${i.name}`}
                type="number"
                min={0}
                max={i.remainingPieces}
                step={1}
                disabled={!i.remainingPieces}
                value={quantities[i.allocationId] ?? ''}
                onChange={(e) =>
                  setQuantities((old) => ({ ...old, [i.allocationId]: e.target.value }))
                }
              />
            </label>
          ))}
          <label>
            Carrier
            <input
              className={field}
              maxLength={100}
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
            />
          </label>
          <label>
            Tracking number
            <input
              className={field}
              maxLength={200}
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
            />
          </label>
          <label>
            HTTPS tracking link
            <input
              className={field}
              type="url"
              pattern="https://.*"
              maxLength={2048}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <label>
            Carrier-provided estimated delivery window
            <input
              className={field}
              maxLength={200}
              value={window}
              onChange={(e) => setWindow(e.target.value)}
            />
          </label>
          <button
            className={button}
            disabled={!data.items.some((i) => Number(quantities[i.allocationId]) > 0)}
          >
            Record shipment and queue update
          </button>
        </fieldset>
      </form>
      {request.pending && !request.busy && (
        <button className={button} onClick={() => void request.run(request.pending!, clear)}>
          Retry exact shipment record
        </button>
      )}
      {request.pending && !request.busy && (
        <p>Outcome is unconfirmed. Retry this same record before entering another shipment.</p>
      )}
      {request.message && <p role="status">{request.message}</p>}
    </div>
  );
}

function IssueForm({ shipment }: { shipment: Detail['shipments'][number] }) {
  const save = useMutation(api.ordFulfillment.recordShipmentIssue);
  const request =
    useRecordedRequest<FunctionArgs<typeof api.ordFulfillment.recordShipmentIssue>>(save);
  const [kind, setKind] =
    useState<FunctionArgs<typeof api.ordFulfillment.recordShipmentIssue>['kind']>('delayed');
  const [message, setMessage] = useState(''),
    [evidence, setEvidence] = useState(''),
    [email, setEmail] = useState(false);
  const clear = () => {
    setMessage('');
    setEvidence('');
    setEmail(false);
    setKind('delayed');
  };
  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void request.run(
            {
              shipmentId: shipment._id,
              kind,
              message,
              evidence,
              notifyCustomer: email,
              requestKey: globalThis.crypto.randomUUID(),
            },
            clear
          );
        }}
      >
        <fieldset disabled={request.busy || !!request.pending} className="space-y-2">
          <legend>Shipment issue or resolution</legend>
          <label>
            Update type
            <select
              className={field}
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="delayed">Delayed</option>
              <option value="lost">Lost</option>
              <option value="damaged">Damaged</option>
              <option value="delivery_exception">Delivery exception</option>
              {(shipment.activeIssue ||
                shipment.status === 'lost' ||
                shipment.status === 'damaged') && <option value="resolved">Issue resolved</option>}
            </select>
          </label>
          <label>
            Customer-facing update
            <textarea
              className={field}
              required
              minLength={5}
              maxLength={1000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <label>
            Internal carrier or support evidence
            <textarea
              className={field}
              required
              minLength={5}
              maxLength={2000}
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
            />
          </label>
          <label>
            <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} />{' '}
            Queue this update for the customer by email
          </label>
          <p>
            The customer-facing update appears in order status. Internal evidence stays private.
            This does not issue a refund or replacement order.
          </p>
          <button className={button}>Save shipment update</button>
        </fieldset>
      </form>
      {request.pending && !request.busy && (
        <button className={button} onClick={() => void request.run(request.pending!, clear)}>
          Retry exact shipment update
        </button>
      )}
      {request.message && <p role="status">{request.message}</p>}
    </div>
  );
}

function CancellationForm({ data }: { data: Detail }) {
  const save = useMutation(api.ordFulfillment.cancelAllocations);
  const request =
    useRecordedRequest<FunctionArgs<typeof api.ordFulfillment.cancelAllocations>>(save);
  const [selected, setSelected] = useState<Id<'ordAllocations'>[]>([]),
    [reason, setReason] = useState('');
  const eligible = data.items.filter((i) => i.status === 'open' && i.shippedPieces === 0);
  const clear = () => {
    setSelected([]);
    setReason('');
  };
  if (!eligible.length && !request.pending) return null;
  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void request.run(
            {
              supplierOrderId: data.supplierOrder._id,
              allocationIds: selected,
              reason,
              requestKey: globalThis.crypto.randomUUID(),
            },
            clear
          );
        }}
      >
        <fieldset disabled={request.busy || !!request.pending} className="space-y-2">
          <legend>Record supplier cancellation of unshipped items</legend>
          {eligible.map((i) => (
            <label className="block" key={i.allocationId}>
              <input
                type="checkbox"
                checked={selected.includes(i.allocationId)}
                onChange={(e) =>
                  setSelected((old) =>
                    e.target.checked
                      ? [...old, i.allocationId]
                      : old.filter((id) => id !== i.allocationId)
                  )
                }
              />{' '}
              {i.name} — all {i.pieces} piece(s)
            </label>
          ))}
          <label>
            Supplier cancellation confirmation and reason
            <textarea
              className={field}
              required
              minLength={5}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <p>
            Record only a confirmed cancellation. This queues a customer notice; refund approval and
            payment remain separate. Partly shipped items require a reviewed return or partial
            cancellation.
          </p>
          <button className={button} disabled={!selected.length}>
            Record cancellation and queue notice
          </button>
        </fieldset>
      </form>
      {request.pending && !request.busy && (
        <button className={button} onClick={() => void request.run(request.pending!, clear)}>
          Retry exact cancellation record
        </button>
      )}
      {request.message && <p role="status">{request.message}</p>}
    </div>
  );
}
