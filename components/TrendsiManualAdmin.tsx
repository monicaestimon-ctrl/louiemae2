import React, { useState } from 'react';
import { useAction, useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { Doc, Id } from '../convex/_generated/dataModel';
import { TRENDSI_STAGES } from '../lib/trendsiManual';
import './trendsi-manual.css';
import { AdminOrders } from './AdminOrders';
export function OrdersWorkspace() {
  const [lane, setLane] = useState<'trendsi' | 'existing'>('trendsi');
  return (
    <>
      <nav className="flex flex-wrap gap-3 mb-6" aria-label="Fulfillment provider">
        <button
          aria-pressed={lane === 'trendsi'}
          className="px-5 py-3 bg-earth text-cream rounded"
          onClick={() => setLane('trendsi')}
        >
          Trendsi · Manual
        </button>
        <button
          aria-pressed={lane === 'existing'}
          className="px-5 py-3 border border-earth/30 rounded"
          onClick={() => setLane('existing')}
        >
          Furniture & CJ orders
        </button>
      </nav>
      {lane === 'trendsi' ? <TrendsiManualAdmin /> : <AdminOrders />}
    </>
  );
}
const money = (n: number) => '$' + (n / 100).toFixed(2);
const label = (status: string) => TRENDSI_STAGES.find(([key]) => key === status)?.[1] ?? status;
export function TrendsiManualAdmin() {
  const [stage, setStage] = useState('all'),
    [id, setId] = useState<Id<'trendsiOrders'> | null>(null);
  const list = usePaginatedQuery(api.trendsiManual.list, stage === 'all' ? {} : { status: stage }, {
    initialNumItems: 25,
  });
  const detail = useQuery(api.trendsiManual.detail, id ? { id } : 'skip');
  const enabled = useQuery(api.trendsiManual.enabled, {});
  return (
    <section className="tm-admin">
      <header>
        <span className="tm-eyebrow">Retail operations</span>
        <h2>Trendsi · Manual fulfillment</h2>
        <p>
          Review stock and delivery, prepare payment, then place the supplier order yourself.
          Customer payment and supplier ordering are separate steps.
        </p>
        {enabled === false && (
          <p role="status">Customer requests are not enabled in this deployment yet.</p>
        )}
      </header>
      <label className="tm-filter">
        Show stage
        <select
          value={stage}
          onChange={(e) => {
            setStage(e.target.value);
            setId(null);
          }}
        >
          <option value="all">All requests</option>
          {TRENDSI_STAGES.map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
        </select>
      </label>
      <div className="tm-layout">
        <aside aria-label="Trendsi requests">
          {list.status === 'LoadingFirstPage' && <p role="status">Loading requests…</p>}
          {!list.results.length && list.status !== 'LoadingFirstPage' && (
            <p>No requests in this stage. New availability requests will appear here.</p>
          )}
          {list.results.map((o) => (
            <button
              className="tm-request"
              aria-pressed={id === o._id}
              key={o._id}
              onClick={() => setId(o._id)}
            >
              <strong>LM-T-{o._id.slice(-8).toUpperCase()}</strong>
              <span>{o.name}</span>
              <span>{label(o.status)}</span>
              <small>{new Date(o.createdAt).toLocaleString()}</small>
            </button>
          ))}
          {list.status === 'CanLoadMore' && (
            <button onClick={() => list.loadMore(25)}>Load more requests</button>
          )}
        </aside>
        <div>
          {detail?.order ? (
            <Editor
              key={detail.order._id + ':' + detail.order.updatedAt}
              order={detail.order}
              stock={detail.stock}
              events={detail.events}
            />
          ) : (
            <div className="tm-card">
              <h3>Select a request</h3>
              <p>
                Each request keeps stock review, customer details, payment, supplier order,
                shipments, and staff history together.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
function Editor({
  order: o,
  stock,
  events,
}: {
  order: Doc<'trendsiOrders'>;
  stock: { checkedAt: string | null; status: string }[];
  events: Doc<'trendsiOrderEvents'>[];
}) {
  const confirm = useMutation(api.trendsiManual.confirm),
    progress = useMutation(api.trendsiManual.progress),
    ship = useMutation(api.trendsiManual.ship);
  const createLink = useAction(api.trendsiPayments.createLink),
    check = useAction(api.trendsiPayments.check);
  const resolve = useMutation(api.trendsiManual.resolveException);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [note, setNote] = useState(''),
    [reference, setReference] = useState(o.supplierReference ?? '');
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      setMessage('Saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  const subtotal = o.items.reduce((n, i) => n + i.unitMinor * i.quantity, 0);
  return (
    <article className="tm-card">
      <div className="tm-heading">
        <h3>LM-T-{o._id.slice(-8).toUpperCase()}</h3>
        <span className="tm-badge">{label(o.status)}</span>
      </div>
      <section>
        <h4>Customer & delivery</h4>
        <p>
          {o.name} · <a href={'mailto:' + o.email}>{o.email}</a> · {o.phone}
        </p>
        <p>
          {[
            o.address.line1,
            o.address.line2,
            o.address.city,
            o.address.state,
            o.address.postalCode,
            'United States',
          ]
            .filter(Boolean)
            .join(', ')}
        </p>
        {o.notes && <p>Customer note: {o.notes}</p>}
      </section>
      <section>
        <h4>Selection & supplier details</h4>
        {o.items.map((i, index) => (
          <div className="tm-line" key={i.productId + ':' + i.variantId}>
            <strong>{i.name}</strong>
            <p>
              {i.variantName} · {i.quantity} × {money(i.unitMinor)}
            </p>
            <p>
              SKU {i.supplierSku} ·{' '}
              <a href={i.sourceUrl} target="_blank" rel="noopener noreferrer">
                Open Trendsi item
              </a>
            </p>
            <small>
              Daily monitor: {stock[index]?.status ?? 'Not checked'}
              {stock[index]?.checkedAt
                ? ' · ' + new Date(stock[index].checkedAt!).toLocaleString()
                : ''}
              . Confirm the requested quantity directly before payment.
            </small>
          </div>
        ))}
        <p>
          Merchandise: {money(subtotal)} · Delivery:{' '}
          {o.shippingMinor === undefined ? 'Needs review' : money(o.shippingMinor)} · Tax:{' '}
          {o.taxMinor === undefined ? 'Calculated at payment' : money(o.taxMinor)}
        </p>
      </section>
      {['requested', 'confirmed'].includes(o.status) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(() =>
              confirm({
                id: o._id,
                revision: o.revision,
                shippingMinor: Math.round(Number(f.get('shipping')) * 100),
                deliveryEstimate: String(f.get('delivery')),
                stockEvidence: String(f.get('evidence')),
                quantities: o.items.map((_, i) => Number(f.get('quantity-' + i))),
                confirmed: f.get('confirmed') === 'on',
              })
            );
          }}
        >
          <h4>1 · Confirm stock & shipping</h4>
          {o.items.map((i, index) => (
            <label key={i.variantId}>
              Supplier quantity available · {i.variantName}
              <input name={'quantity-' + index} type="number" step="1" min={i.quantity} required />
            </label>
          ))}
          <label>
            Customer delivery charge ($)
            <input
              name="shipping"
              type="number"
              min="0"
              step="0.01"
              required
              defaultValue={o.shippingMinor === undefined ? '' : o.shippingMinor / 100}
            />
          </label>
          <label>
            Delivery estimate / service
            <input
              name="delivery"
              required
              maxLength={300}
              defaultValue={o.deliveryEstimate}
              placeholder="For example: 5–10 business days"
            />
          </label>
          <label>
            Supplier check / evidence
            <textarea
              name="evidence"
              required
              minLength={5}
              maxLength={1000}
              defaultValue={o.stockEvidence}
            />
          </label>
          <label className="tm-check">
            <input type="checkbox" name="confirmed" required />I checked the exact sizes/colors and
            quantities with Trendsi and reviewed delivery to this address.
          </label>
          <button disabled={busy}>Save confirmation</button>
          <small>Confirmation must be less than 30 minutes old when preparing payment.</small>
        </form>
      )}
      {['confirmed', 'payment_pending'].includes(o.status) && (
        <section>
          <h4>2 · Customer payment</h4>
          <p>
            The payment link expires after 35 minutes. Stripe confirms payment; staff cannot mark an
            order paid.
          </p>
          <button
            disabled={busy}
            onClick={() => void run(() => createLink({ id: o._id, revision: o.revision }))}
          >
            Prepare / recover payment link
          </button>
          {o.paymentUrl && (
            <>
              <a className="tm-link" href={o.paymentUrl} target="_blank" rel="noopener noreferrer">
                Open payment link
              </a>
              <button
                disabled={busy}
                onClick={() => void run(() => navigator.clipboard.writeText(o.paymentUrl!))}
              >
                Copy link for customer
              </button>
            </>
          )}
          <button disabled={busy} onClick={() => void run(() => check({ id: o._id }))}>
            Check payment
          </button>
          {o.sessionExpiresAt && (
            <small>Link expires {new Date(o.sessionExpiresAt).toLocaleString()}</small>
          )}
        </section>
      )}
      {o.paidAt && (
        <section>
          <h4>Payment verified</h4>
          <p>
            {money(o.paidTotalMinor ?? 0)} · {new Date(o.paidAt).toLocaleString()}
          </p>
          <button disabled={busy} onClick={() => void run(() => check({ id: o._id }))}>
            Recheck payment / refunds
          </button>
        </section>
      )}
      {o.paymentHold && <p role="alert">{o.paymentHold}</p>}
      {o.status === 'exception' && !o.paidAt && o.paymentAttemptRevision && (
        <button disabled={busy} onClick={() => void run(() => check({ id: o._id }))}>
          Recheck payment / refunds
        </button>
      )}
      {o.status === 'paid' && (
        <section>
          <h4>3 · Order manually from Trendsi</h4>
          <p>
            Use the supplier links and exact SKUs above. After placing the order, save its reference
            here. This button does not purchase anything.
          </p>
          <label>
            Trendsi order number
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={150}
            />
          </label>
          <label>
            Order note
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </label>
          <button
            disabled={busy || !reference.trim() || !note.trim()}
            onClick={() =>
              void run(() =>
                progress({
                  id: o._id,
                  revision: o.revision,
                  action: 'ordered',
                  supplierReference: reference,
                  note,
                })
              )
            }
          >
            Record supplier order
          </button>
        </section>
      )}
      {o.supplierReference && (
        <p>
          Trendsi order: <strong>{o.supplierReference}</strong>
        </p>
      )}
      {['ordered', 'partially_shipped'].includes(o.status) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(() =>
              ship({
                id: o._id,
                revision: o.revision,
                lineIndex: Number(f.get('line')),
                quantity: Number(f.get('quantity')),
                carrier: String(f.get('carrier')),
                tracking: String(f.get('tracking')),
              })
            );
          }}
        >
          <h4>4 · Record a shipment</h4>
          <label>
            Item
            <select name="line">
              {o.items.map((i, n) => (
                <option key={n} value={n}>
                  {i.name} · {i.variantName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quantity in this shipment
            <input name="quantity" type="number" min="1" max="20" step="1" required />
          </label>
          <label>
            Carrier
            <input name="carrier" maxLength={80} required />
          </label>
          <label>
            Tracking number
            <input name="tracking" maxLength={150} required />
          </label>
          <button disabled={busy}>Record shipment</button>
        </form>
      )}
      {!!o.shipments.length && (
        <section>
          <h4>Shipment history</h4>
          {o.shipments.map((s, i) => (
            <p key={i}>
              {o.items[s.lineIndex].variantName} · {s.quantity} units · {s.carrier} · {s.tracking}
            </p>
          ))}
        </section>
      )}
      {o.status === 'refunded' && (
        <p>
          Full refund verified in Stripe. Handle any supplier cancellation or return manually using
          the supplier reference above.
        </p>
      )}
      {!['cancelled', 'delivered', 'refunded'].includes(o.status) && (
        <section>
          <h4>Operations notes & exceptions</h4>
          <label>
            Note
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </label>
          {(['requested', 'confirmed'].includes(o.status)
            ? ['cancelled', 'exception']
            : o.status === 'shipped'
              ? ['delivered', 'exception']
              : ['exception']
          ).map((action) => (
            <button
              disabled={busy || !note.trim()}
              key={action}
              onClick={() =>
                void run(() =>
                  progress({
                    id: o._id,
                    revision: o.revision,
                    action: action as 'cancelled' | 'exception' | 'delivered',
                    note,
                  })
                )
              }
            >
              {action === 'cancelled'
                ? 'Cancel unpaid request'
                : action === 'delivered'
                  ? 'Confirm delivery'
                  : 'Move to needs attention'}
            </button>
          ))}
          {o.status === 'exception' && (
            <>
              <p>
                Resolve stock or delivery issues with the customer. Review any paid refund in
                Stripe; do not place another supplier order while this request needs attention.
              </p>
              <button
                disabled={busy || note.trim().length < 5 || Boolean(o.paymentHold)}
                onClick={() => void run(() => resolve({ id: o._id, revision: o.revision, note }))}
              >
                Record resolution & resume
              </button>
            </>
          )}
        </section>
      )}
      {error && (
        <p role="alert" className="tm-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <details>
        <summary>Staff history</summary>
        {events.map((e) => (
          <p key={e._id}>
            <small>
              {new Date(e.at).toLocaleString()} · {e.actor}
            </small>
            <br />
            {e.action.replaceAll('_', ' ')}
            {e.note && ' — ' + e.note}
          </p>
        ))}
      </details>
    </article>
  );
}
