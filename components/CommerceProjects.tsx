import React, { useState } from 'react';
import { useAction, useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { Doc, Id } from '../convex/_generated/dataModel';
import { providerLabels, totalLines } from '../lib/commerce';
import './commerce.css';
const usd = (n: number) => (n / 100).toFixed(2);
export function CommerceProjects() {
  const list = usePaginatedQuery(api.commerceProjects.list, {}, { initialNumItems: 30 });
  const [id, setId] = useState<Id<'commerceProjects'> | null>(null);
  const detail = useQuery(api.commerceProjects.get, id ? { id } : 'skip');
  return (
    <section className="commerce-studio">
      <h2>Project quotes & fulfillment</h2>
      <p>
        Review the selection, save the agreed quote, record acceptance, then send the itemized
        payment invoice.
      </p>
      {list.results.map((p) => (
        <button className="commerce-library-row" key={p._id} onClick={() => setId(p._id)}>
          {p.business || p.name} · {p.channel} · {p.status} · $
          {usd(totalLines(p.lines, p.delivery, p.tax))}
        </button>
      ))}
      {list.status === 'CanLoadMore' && (
        <button onClick={() => list.loadMore(30)}>Load more</button>
      )}
      {detail?.project && (
        <ProjectEditor
          key={`${detail.project._id}:${detail.project.revision}:${detail.project.status}`}
          project={detail.project}
        />
      )}
      {detail?.groups.map((g) => (
        <Fulfillment key={`${g._id}:${g.updatedAt}`} group={g} />
      ))}
    </section>
  );
}
function ProjectEditor({ project: p }: { project: Doc<'commerceProjects'> }) {
  const save = useMutation(api.commerceProjects.save),
    accept = useMutation(api.commerceProjects.accept);
  const invoice = useAction(api.commerceStripe.sendInvoice),
    reconcile = useAction(api.commerceStripe.refreshPayment);
  const voidInvoice = useAction(api.commerceStripe.voidInvoice),
    retryEmail = useMutation(api.commerceProjects.retryEmail);
  const catalog = usePaginatedQuery(
    api.commerce.catalog,
    { channel: p.channel },
    { initialNumItems: 50 }
  );
  const [lines, setLines] = useState(p.lines),
    [delivery, setDelivery] = useState(p.delivery),
    [tax, setTax] = useState(p.tax),
    [address, setAddress] = useState(p.address),
    [notes, setNotes] = useState(p.notes);
  const [acceptance, setAcceptance] = useState(''),
    [readiness, setReadiness] = useState(''),
    [ceiling, setCeiling] = useState(0),
    [logistics, setLogistics] = useState(''),
    [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const locked = !!p.stripeInvoiceId || !['draft', 'requested', 'accepted'].includes(p.status);
  const dirty =
    JSON.stringify([lines, delivery, tax, address, notes]) !==
    JSON.stringify([p.lines, p.delivery, p.tax, p.address, p.notes]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMessage('');
    try {
      await fn();
      setMessage('Saved.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <h3>
        {p.business || p.name} — revision {p.revision}
      </h3>
      <p>
        {p.name} · {p.email} · {p.phone}
      </p>
      <p>
        Request emails: customer {p.customerEmailStatus || 'not sent'} · owner{' '}
        {p.ownerEmailStatus || 'not sent'}
      </p>
      <button disabled={busy} onClick={() => void run(() => retryEmail({ id: p._id }))}>
        Retry unsent request emails
      </button>
      <details>
        <summary>Original request</summary>
        {p.requested.map((l, i) => (
          <p key={i}>
            {l.name} / {l.variantName} × {l.quantity}
          </p>
        ))}
      </details>
      <fieldset disabled={locked || busy}>
        <legend>Final quote</legend>
        {lines.map((l, i) => (
          <fieldset key={`${l.productId}:${l.variantId}`}>
            <legend>
              {l.name} / {l.variantName}
            </legend>
            <div className="commerce-fields">
              <label>
                Quantity
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={l.quantity}
                  onChange={(e) =>
                    setLines((old) =>
                      old.map((x, n) => (n === i ? { ...x, quantity: Number(e.target.value) } : x))
                    )
                  }
                />
              </label>
              <label>
                Unit price (USD)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={usd(l.unitPrice)}
                  onChange={(e) =>
                    setLines((old) =>
                      old.map((x, n) =>
                        n === i ? { ...x, unitPrice: Math.round(Number(e.target.value) * 100) } : x
                      )
                    )
                  }
                />
              </label>
            </div>
            <button onClick={() => setLines((old) => old.filter((_, n) => n !== i))}>
              Remove item
            </button>
          </fieldset>
        ))}
        <label>
          Add a published product / variant
          <select
            value=""
            onChange={(e) => {
              const [id, vid] = e.target.value.split('|');
              const product = catalog.results.find((x) => x.id === id);
              const variant = product?.variants.find((x) => x.id === vid);
              if (
                product &&
                variant &&
                !lines.some((l) => l.productId === id && l.variantId === vid)
              )
                setLines((old) => [
                  ...old,
                  {
                    productId: product.id,
                    variantId: variant.id,
                    name: product.name,
                    variantName: variant.name,
                    quantity: variant.minimum,
                    unitPrice: variant.price,
                    provider: 'owner_managed',
                    sku: '',
                  },
                ]);
            }}
          >
            <option value="">Choose an item…</option>
            {catalog.results.flatMap((x) =>
              x.variants.map((v) => (
                <option key={`${x.id}:${v.id}`} value={`${x.id}|${v.id}`}>
                  {x.name} / {v.name}
                </option>
              ))
            )}
          </select>
        </label>
        {catalog.status === 'CanLoadMore' && (
          <button onClick={() => catalog.loadMore(50)}>Load more product choices</button>
        )}
        <div className="commerce-fields">
          <label>
            Confirmed delivery (USD)
            <input
              type="number"
              min="0"
              step="0.01"
              value={usd(delivery)}
              onChange={(e) => setDelivery(Math.round(Number(e.target.value) * 100))}
            />
          </label>
          <label>
            Reviewed tax (USD)
            <input
              type="number"
              min="0"
              step="0.01"
              value={usd(tax)}
              onChange={(e) => setTax(Math.round(Number(e.target.value) * 100))}
            />
          </label>
          {(Object.keys(address) as (keyof typeof address)[]).map((k) => (
            <label key={k}>
              {k}
              <input
                value={address[k]}
                onChange={(e) => setAddress((old) => ({ ...old, [k]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <label>
          Customer-facing invoice notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button
          disabled={!dirty}
          onClick={() =>
            void run(() =>
              save({
                id: p._id,
                revision: p.revision,
                items: lines.map(({ productId, variantId, quantity, unitPrice }) => ({
                  productId,
                  variantId,
                  quantity,
                  unitPrice,
                })),
                delivery,
                tax,
                address,
                notes,
              })
            )
          }
        >
          Save revised quote
        </button>
      </fieldset>
      {!locked && p.status !== 'accepted' && (
        <fieldset disabled={busy || dirty}>
          <legend>Customer agreement & supply review</legend>
          <label>
            Acceptance record (date, email reference, agreed quantities)
            <textarea value={acceptance} onChange={(e) => setAcceptance(e.target.value)} />
          </label>
          <label>
            Availability, delivery timing, tax, logistics checks
            <textarea value={readiness} onChange={(e) => setReadiness(e.target.value)} />
          </label>
          {p.lines.some((l) => l.provider === 'cj') && (
            <div className="commerce-fields">
              <label>
                Maximum CJ supplier charge (USD)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={ceiling}
                  onChange={(e) => setCeiling(Number(e.target.value))}
                />
              </label>
              <label>
                Confirmed CJ logistics service
                <input value={logistics} onChange={(e) => setLogistics(e.target.value)} />
              </label>
              <label>
                Supply approval expires
                <input
                  type="datetime-local"
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                />
              </label>
            </div>
          )}
          <button
            onClick={() =>
              void run(() =>
                accept({
                  id: p._id,
                  revision: p.revision,
                  acceptance,
                  readiness,
                  maxCjCost: Math.round(ceiling * 100),
                  cjLogistics: logistics,
                  cjApprovedUntil: expiry ? new Date(expiry).getTime() : 0,
                })
              )
            }
          >
            Record customer acceptance
          </button>
        </fieldset>
      )}
      {['accepted', 'invoicing', 'invoiced'].includes(p.status) && (
        <button
          disabled={busy || dirty}
          onClick={() => void run(() => invoice({ id: p._id, revision: p.revision }))}
        >
          Send / reconcile itemized invoice
        </button>
      )}
      {p.invoiceUrl && (
        <p>
          <a href={p.invoiceUrl} target="_blank" rel="noreferrer">
            Open customer payment invoice ↗
          </a>
        </p>
      )}
      {p.stripeInvoiceId && !p.paidAt && (
        <button disabled={busy} onClick={() => void run(() => reconcile({ id: p._id }))}>
          Verify online payment
        </button>
      )}
      {p.stripeInvoiceId && !p.paidAt && (
        <button
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                'Void the unpaid payment link and reopen this quote? Customer acceptance must be recorded again.'
              )
            )
              void run(() => voidInvoice({ id: p._id }));
          }}
        >
          Void unpaid invoice & revise
        </button>
      )}
      {p.invoiceError && <p role="alert">{p.invoiceError}</p>}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
function Fulfillment({
  group: g,
}: {
  group: Doc<'commerceFulfillments'> & { order: Doc<'orders'> | null };
}) {
  const save = useMutation(api.commerceProjects.manualProgress),
    retry = useMutation(api.commerceFulfillment.retry);
  const [reference, setReference] = useState(g.supplierReference || ''),
    [tracking, setTracking] = useState(g.tracking || ''),
    [note, setNote] = useState(g.note),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      setMessage('Updated.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Please retry.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <fieldset disabled={busy}>
      <legend>
        {providerLabels[g.provider]} — {g.status}
      </legend>
      <p>{g.note}</p>
      {g.provider === 'cj' ? (
        <>
          <p>
            CJ order: {g.order?.cjOrderId || 'Not created'} · Supplier payment:{' '}
            {g.order?.cjPaymentStatus || 'Not started'}
          </p>
          <p>{g.order?.cjError}</p>
          {g.status === 'needs_attention' && (
            <button onClick={() => void run(() => retry({ id: g._id }))}>
              Retry after resolving readiness
            </button>
          )}
          <a href="/#admin" target="_blank" rel="noreferrer">
            Open Atelier CJ Control Room ↗
          </a>
        </>
      ) : (
        <>
          <p>
            {g.provider === 'ashcroft'
              ? 'Place the dealer order manually with Ashcroft for delivery to this customer, then record its reference here.'
              : 'Arrange procurement and logistics with your supplier, then record progress here.'}
          </p>
          <label>
            Supplier / order reference
            <input value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
          <label>
            Tracking / delivery details
            <input value={tracking} onChange={(e) => setTracking(e.target.value)} />
          </label>
          <label>
            Internal logistics notes
            <textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {(['ordered', 'shipped', 'delivered', 'hold'] as const).map((status) => (
            <button
              key={status}
              onClick={() => void run(() => save({ id: g._id, status, reference, tracking, note }))}
            >
              {status}
            </button>
          ))}
        </>
      )}
      {g.provider === 'cj' && g.status === 'needs_attention' && !g.orderId && (
        <ReleaseReview id={g._id} />
      )}
      {message && <p role="status">{message}</p>}
    </fieldset>
  );
}
function ReleaseReview({ id }: { id: Id<'commerceFulfillments'> }) {
  const review = useMutation(api.commerceFulfillment.review);
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <details>
      <summary>Review the exact paid items for release</summary>
      <p>
        For mapping repairs, first verify the same selected variant in CJ Control Room.
        Substitutions require a revised customer agreement and payment adjustment; this control
        never changes quantities or customer prices.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          setBusy(true);
          try {
            await review({
              id,
              evidence: String(data.get('evidence')),
              maxCjCost: Math.round(Number(data.get('ceiling')) * 100),
              logistics: String(data.get('logistics')),
              expires: new Date(String(data.get('expires'))).getTime(),
              adoptVerifiedMappings: data.get('mapping') === 'on',
              coordinatedRelease: data.get('coordinated') === 'on',
              cjShippingAllowance: Math.round(Number(data.get('shipping')) * 100),
            });
            setMessage('Review saved. Use Retry after resolving readiness to release.');
          } catch (e) {
            setMessage(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Same-item and delivery verification
          <textarea name="evidence" required minLength={12} maxLength={3000} />
        </label>
        <label>
          Maximum CJ charge (USD)
          <input name="ceiling" type="number" min="0.01" step="0.01" required />
        </label>
        <label>
          CJ share of customer delivery charge (USD; mixed-provider projects)
          <input name="shipping" type="number" min="0" step="0.01" defaultValue="0" required />
        </label>
        <label>
          CJ logistics service
          <input name="logistics" required />
        </label>
        <label>
          Supply approval expires
          <input name="expires" type="datetime-local" required />
        </label>
        <label>
          <input type="checkbox" name="mapping" /> Adopt the current verified mapping for the same
          paid variant
        </label>
        <label>
          <input type="checkbox" name="coordinated" /> I reviewed delivery coordination across all
          suppliers
        </label>
        <button disabled={busy}>Save release review</button>
        {message && <p role="status">{message}</p>}
      </form>
    </details>
  );
}
