import type { FunctionReturnType } from 'convex/server';
import { STANDARD_ACCESS } from '../../lib/delivery/destination';
import DeliveryAccessFields from '../delivery/DeliveryAccessFields';
import DeliveryBoundary from '../delivery/DeliveryBoundary';
import DeliveryActualCosts from './DeliveryActualCosts';
import React, { useState } from 'react';
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { customerMessage } from '../../lib/errors';
import { dollarsToMinor } from '../../lib/decimal';
import DeliveryDiagnostics, {
  DeliveryTaxCertificates,
  DeliveryTaxReporting,
} from './DeliveryDiagnostics';

const money = (n: number | null) => (n === null ? 'Not recorded' : `$${(n / 100).toFixed(2)}`);
const input = 'block w-full border p-2';
export default function DeliveryOperations() {
  const permissions = useQuery(api.dlvAccess.permissions, {});
  if (!permissions) return <p>Checking delivery permissions…</p>;
  if (!permissions.support) return <p>Your account has no assigned delivery role.</p>;
  if (!permissions.operations) return <DeliverySupport />;
  return (
    <DeliveryOperationsWorkspace finance={permissions.finance} approver={permissions.approver} />
  );
}
function DeliverySupport() {
  const rows = useQuery(api.dlvAccess.supportQueue, {});
  return (
    <section>
      <h3>Delivery request status</h3>
      {rows?.map((r) => (
        <p key={r.id}>
          {r.name} · {r.postalCode} · {r.status} · {r.customerMessage}
        </p>
      ))}
    </section>
  );
}
function DeliveryOperationsWorkspace({
  finance,
  approver,
}: {
  finance: boolean;
  approver: boolean;
}) {
  const {
    results: queue,
    status: queueStatus,
    loadMore,
  } = usePaginatedQuery(api.dlvOperations.queue, {}, { initialNumItems: 20 });
  const [selected, setSelected] = useState<Id<'dlvQuoteRequests'> | null>(null);
  const [supplierOrder, setSupplierOrder] = useState(''),
    [invoiceOrder, setInvoiceOrder] = useState('');
  return (
    <section className="space-y-5 text-sm">
      <h3 className="font-serif text-xl">Delivery quotes and actual freight</h3>
      {finance && (
        <>
          <DeliveryDiagnostics />
          <DeliveryTaxCertificates />
          <DeliveryTaxReporting />
          <DeliveryActualCosts />
        </>
      )}
      <p>
        Rate versions and scoped controls are managed in Decisions & flags. A quote does not reserve
        inventory or authorize a payment.
      </p>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h4>Delivery requests</h4>
          {queueStatus === 'CanLoadMore' && (
            <button onClick={() => loadMore(20)}>Load more requests</button>
          )}
          {queue?.map((r) => (
            <button
              className="block w-full text-left border p-2"
              key={r._id}
              onClick={() => setSelected(r._id)}
              aria-pressed={selected === r._id}
            >
              {r.name} · {r.postalCode} · {r.status.replaceAll('_', ' ')}
              <br />
              {r.lines.length} items · {new Date(r.createdAt).toLocaleDateString()}
            </button>
          ))}
        </div>
        {selected && <QuoteEditor key={selected} id={selected} canSend={approver} />}
      </div>
      {finance && (
        <div className="border p-4 space-y-2">
          <h4>Freight reconciliation</h4>
          <p>
            Copy the supplier order ID from Dealer orders. Record the invoice against its supplier
            order; shipping an order in several shipments does not duplicate its customer charge.
          </p>
          <label>
            Supplier order ID
            <input
              className={input}
              value={supplierOrder}
              onChange={(e) => setSupplierOrder(e.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={() => setInvoiceOrder(supplierOrder.trim())}
            disabled={!supplierOrder.trim()}
          >
            Open freight record
          </button>
          {invoiceOrder && (
            <DeliveryBoundary key={invoiceOrder}>
              <InvoiceEditor id={invoiceOrder as Id<'ordSupplierOrders'>} />
            </DeliveryBoundary>
          )}
        </div>
      )}
    </section>
  );
}
function QuoteEditor({ id, canSend }: { canSend: boolean; id: Id<'dlvQuoteRequests'> }) {
  const detail = useQuery(api.dlvOperations.quoteDetail, { id });
  if (!detail) return <p>Loading request…</p>;
  return <LoadedQuoteEditor id={id} canSend={canSend} detail={detail} />;
}
function LoadedQuoteEditor({
  id,
  canSend,
  detail,
}: {
  id: Id<'dlvQuoteRequests'>;
  canSend: boolean;
  detail: NonNullable<FunctionReturnType<typeof api.dlvOperations.quoteDetail>>;
}) {
  const [recipientName, setRecipientName] = useState(
    detail.request.address?.recipientName ?? detail.request.name
  );
  const [line2, setLine2] = useState(detail.request.address?.line2 ?? '');
  const [access, setAccess] = useState(detail.request.address?.access ?? STANDARD_ACCESS);
  const [confirmedAccess, setConfirmedAccess] = useState(false);
  const update = useMutation(api.dlvOperations.updateRequest),
    save = useMutation(api.ordQuotes.saveVersion),
    send = useMutation(api.ordQuotes.markSent),
    attach = useMutation(api.dlvOperations.attachQuote);
  const [message, setMessage] = useState(''),
    [assignee, setAssignee] = useState(''),
    [feedback, setFeedback] = useState(''),
    [busy, setBusy] = useState(false);
  const [delivery, setDelivery] = useState(''),
    [tax, setTax] = useState(''),
    [taxEvidence, setTaxEvidence] = useState(''),
    [terms, setTerms] = useState(''),
    [days, setDays] = useState(7);
  const [line1, setLine1] = useState(detail.request.address?.line1 ?? ''),
    [city, setCity] = useState(detail.request.address?.city ?? ''),
    [phone, setPhone] = useState(detail.request.address?.phone ?? detail.request.phone ?? ''),
    [state, setState] = useState(detail.request.address?.state ?? '');
  const [freight, setFreight] = useState<
      Record<string, { freight: string; fee: string; evidence: string }>
    >({}),
    [fixed, setFixed] = useState('');
  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    setFeedback('');
    try {
      await work();
      setFeedback('Saved.');
    } catch (e) {
      setFeedback(customerMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const r = detail.request;
  return (
    <div className="border p-4 space-y-2">
      <h4>
        {r.name} · {r.email}
      </h4>
      <p>
        {r.phone} · {r.notes}
      </p>
      {r.lines.map((l) => (
        <p key={l.variantId}>
          {l.name} × {l.packs} packs
        </p>
      ))}
      <label>
        Assigned to
        <input className={input} value={assignee} onChange={(e) => setAssignee(e.target.value)} />
      </label>
      <label>
        Customer message
        <textarea
          className={input}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={2000}
        />
      </label>
      <div className="flex flex-wrap gap-3">
        {(['sourcing', 'needs_information', 'cancelled'] as const).map((status) => (
          <button
            key={status}
            disabled={busy || ['accepted', 'cancelled', 'declined', 'converted'].includes(r.status)}
            onClick={() => action(() => update({ id, status, assignedTo: assignee, message }))}
          >
            {status.replaceAll('_', ' ')}
          </button>
        ))}
      </div>
      <h4>New quote version</h4>
      <p>
        Uses the request's merchandise lines. Confirm the current prices and delivery evidence
        before sending; automatic checks can block this quote.
      </p>
      <label>
        Recipient name
        <input
          className={input}
          value={recipientName}
          onChange={(e) => setRecipientName(e.target.value)}
          maxLength={150}
        />
      </label>
      <DeliveryAccessFields
        value={access}
        onChange={(value) => {
          setAccess(value);
          setConfirmedAccess(false);
        }}
      />
      <label>
        <input
          type="checkbox"
          checked={confirmedAccess}
          onChange={(e) => setConfirmedAccess(e.target.checked)}
        />{' '}
        Confirmed delivery service and access with customer and carrier
      </label>
      <label>
        Apartment / suite
        <input className={input} value={line2} onChange={(e) => setLine2(e.target.value)} />
      </label>
      <label>
        Street
        <input className={input} value={line1} onChange={(e) => setLine1(e.target.value)} />
      </label>
      <label>
        City
        <input className={input} value={city} onChange={(e) => setCity(e.target.value)} />
      </label>
      <label>
        State (two letters)
        <input
          className={input}
          value={state}
          maxLength={2}
          onChange={(e) => setState(e.target.value.toUpperCase())}
        />
      </label>
      <label>
        Customer delivery ($)
        <input
          className={input}
          inputMode="decimal"
          value={delivery}
          onChange={(e) => setDelivery(e.target.value)}
        />
      </label>
      <label>
        Delivery appointment phone
        <input
          className={input}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxLength={25}
        />
      </label>
      <label>
        Verified tax ($)
        <input
          className={input}
          inputMode="decimal"
          value={tax}
          onChange={(e) => setTax(e.target.value)}
        />
      </label>
      <label>
        Address-specific tax evidence (including confirmed zero)
        <input
          className={input}
          value={taxEvidence}
          onChange={(e) => setTaxEvidence(e.target.value)}
          maxLength={2000}
        />
      </label>
      <label>
        Valid days
        <input
          className={input}
          type="number"
          min={1}
          max={30}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        />
      </label>
      <label>
        Service, evidence and terms
        <textarea className={input} value={terms} onChange={(e) => setTerms(e.target.value)} />
      </label>
      <label>
        Fixed payment expense ($; enter 0 only if confirmed)
        <input className={input} value={fixed} onChange={(e) => setFixed(e.target.value)} />
      </label>
      {detail.groups.map((g) => {
        const key = `${g.supplierCode}:${g.originZip}`,
          value = freight[key] ?? { freight: '', fee: '', evidence: '' };
        return (
          <fieldset key={key} className="border p-2">
            <legend>{key}</legend>
            {(['freight', 'fee', 'evidence'] as const).map((k) => (
              <label key={k}>
                {k}
                {k !== 'evidence' ? ' ($)' : ''}
                <input
                  className={input}
                  value={value[k]}
                  onChange={(e) =>
                    setFreight((all) => ({ ...all, [key]: { ...value, [k]: e.target.value } }))
                  }
                />
              </label>
            ))}
          </fieldset>
        );
      })}
      <button
        disabled={
          busy ||
          !confirmedAccess ||
          !recipientName.trim() ||
          !terms.trim() ||
          !line1 ||
          !city ||
          state.length !== 2
        }
        onClick={() =>
          action(() =>
            save({
              projectId: r.projectId,
              lines: detail.lines.map((l) => ({
                productId: l.productId,
                variantId: l.variantId,
                packs: l.quantity,
                unitPackMinor: l.unitPrice,
                discountMinor: 0,
              })),
              address: {
                recipientName,
                access,
                line2: line2 || undefined,
                line1,
                city,
                state,
                phone: phone || r.phone,
                postalCode: r.postalCode,
                country: 'US',
              },
              service:
                access.requestedService === 'standard' ? 'curbside' : access.requestedService,
              deliveryMinor: dollarsToMinor(delivery),
              taxMinor: dollarsToMinor(tax),
              taxEvidence,
              validDays: days,
              terms,
              fixedPaymentMinor: dollarsToMinor(fixed),
              freight: detail.groups.map((g) => {
                const f = freight[`${g.supplierCode}:${g.originZip}`];
                return {
                  ...g,
                  freightMinor: dollarsToMinor(f?.freight ?? ''),
                  supplierFeeMinor: dollarsToMinor(f?.fee ?? ''),
                  evidence: f?.evidence ?? '',
                };
              }),
            })
          )
        }
      >
        Save draft and check pricing
      </button>
      {detail.versions.map((v) => (
        <div className="border-t pt-2" key={v._id}>
          <p>
            Version {v.version} · {v.status} · Delivery {money(v.deliveryMinor)} · Tax{' '}
            {money(v.taxMinor)}
          </p>
          <p>{v.checks.notes.join('; ')}</p>
          {canSend && v.status === 'draft' && (
            <button
              disabled={busy}
              onClick={() =>
                action(async () => {
                  await send({ versionId: v._id });
                  await attach({ id, versionId: v._id });
                })
              }
            >
              Send checked quote to customer
            </button>
          )}
          {v.status === 'sent' && (r.quoteVersionId !== v._id || r.status !== 'sent') && (
            <button disabled={busy} onClick={() => action(() => attach({ id, versionId: v._id }))}>
              Attach sent version
            </button>
          )}
        </div>
      ))}
      <p role="status">{feedback}</p>
    </div>
  );
}
function InvoiceEditor({ id }: { id: Id<'ordSupplierOrders'> }) {
  const data = useQuery(api.dlvOperations.reconciliation, { supplierOrderId: id }),
    record = useMutation(api.dlvOperations.recordInvoice);
  const [fields, setFields] = useState({
    reference: '',
    carrier: '',
    base: '',
    fuel: '0',
    accessorial: '0',
    supplierFee: '0',
    credit: '0',
    evidence: '',
    note: '',
  });
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  if (data === undefined) return <p>Loading freight record…</p>;
  if (data === null) return <p>Supplier order not found.</p>;
  return (
    <div className="space-y-2">
      <h4>
        {data.orderNumber} · {data.supplierCode}
      </h4>
      <p>
        Customer delivery allocated: {money(data.customerDeliveryMinor)} · Estimated freight:{' '}
        {money(data.estimatedFreightMinor)} · Actual freight: {money(data.actualFreightMinor)} ·
        Freight variance: {money(data.freightVarianceMinor)}
      </p>
      <p>{data.note}</p>
      {data.invoices.map((i) => (
        <p key={i._id}>
          {i.carrier} · {i.reference} · {money(i.totalMinor)}
        </p>
      ))}
      <div className="grid sm:grid-cols-2 gap-2">
        {(Object.keys(fields) as (keyof typeof fields)[]).map((k) => (
          <label key={k}>
            {k}
            {['base', 'fuel', 'accessorial', 'supplierFee', 'credit'].includes(k) ? ' ($)' : ''}
            <input
              className={input}
              value={fields[k]}
              onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await record({
              supplierOrderId: id,
              reference: fields.reference,
              carrier: fields.carrier,
              baseMinor: dollarsToMinor(fields.base),
              fuelMinor: dollarsToMinor(fields.fuel),
              accessorialMinor: dollarsToMinor(fields.accessorial),
              supplierFeeMinor: dollarsToMinor(fields.supplierFee),
              creditMinor: dollarsToMinor(fields.credit),
              evidence: fields.evidence,
              note: fields.note,
            });
            setMessage('Invoice recorded. Customer total remains unchanged.');
          } catch (e) {
            setMessage(customerMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Record invoice
      </button>
      <p role="status">{message}</p>
    </div>
  );
}
