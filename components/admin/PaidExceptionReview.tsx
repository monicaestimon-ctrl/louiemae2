import React, { useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { customerMessage } from '../../lib/errors';

export default function PaidExceptionReview() {
  const rows = useQuery(api.v2Admin.paidExceptions, {});
  const [selected, setSelected] = useState<Id<'ordPaidExceptions'> | null>(null);
  return (
    <section className="border p-4 space-y-3">
      <h3 className="font-serif text-lg">Paid orders needing resolution ({rows?.length ?? '…'})</h3>
      <p>
        A note alone cannot close a payment obligation. Verify the existing payment before recording
        a completed refund. Fulfillment recovery remains a separate reviewed action.
      </p>
      {rows?.map((row) => (
        <button
          key={row._id}
          aria-pressed={selected === row._id}
          className="border p-2 m-1 text-sm"
          onClick={() => setSelected(row._id)}
        >
          {row.reason} · {row.paymentIntentId ?? row.stripeSessionId ?? row._id}
        </button>
      ))}
      {rows?.length === 200 && (
        <p>
          Showing the latest 200 open exceptions. Older entries remain in the queue and appear as
          these are resolved.
        </p>
      )}
      {selected && <Review key={selected} id={selected} />}
    </section>
  );
}
function Review({ id }: { id: Id<'ordPaidExceptions'> }) {
  const data = useQuery(api.ordExceptionRefunds.detail, { id });
  const verify = useAction(api.ordExceptionActions.verify);
  const close = useMutation(api.ordExceptionRefunds.closeRefunded);
  const [verifiedId, setVerifiedId] = useState<Id<'ordPaymentVerifications'> | null>(null);
  const [agreement, setAgreement] = useState(''),
    [supplier, setSupplier] = useState('');
  const [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [retry, setRetry] = useState<{ payload: string; key: string } | null>(null);
  if (!data) return <p role="status">Loading payment exception…</p>;
  const proof = data.proof;
  const complete =
    proof &&
    proof._id === verifiedId &&
    proof.captured &&
    !proof.disputed &&
    proof.currency === 'usd' &&
    proof.amountMinor > 0 &&
    proof.amountMinor === proof.succeededRefundMinor &&
    !proof.pendingRefundMinor;
  if (data.exception.status === 'resolved')
    return <p role="status">Resolution saved. Payment and audit history remain available.</p>;
  return (
    <div className="border-t pt-3 space-y-3">
      <button
        className="border p-2"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage('');
          setVerifiedId(null);
          setConfirmed(false);
          try {
            setVerifiedId(await verify({ id }));
            setMessage('Read-only verification saved. Review the result below.');
          } catch (error) {
            setMessage(customerMessage(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Working…' : 'Verify existing payment and refunds'}
      </button>
      <p>
        This reads payment records. It does not issue a payment, refund, cancellation or customer
        message.
      </p>
      {proof && (
        <dl>
          <dt>Payment amount ({proof.currency.toUpperCase()})</dt>
          <dd>{(proof.amountMinor / 100).toFixed(2)}</dd>
          <dt>Successful refunds</dt>
          <dd>{(proof.succeededRefundMinor / 100).toFixed(2)}</dd>
          <dt>Pending refunds</dt>
          <dd>{(proof.pendingRefundMinor / 100).toFixed(2)}</dd>
          <dt>Disputed</dt>
          <dd>{proof.disputed ? 'Yes — requires review' : 'No'}</dd>
          <dt>Verification valid until</dt>
          <dd>{new Date(proof.validUntil).toLocaleString()}</dd>
        </dl>
      )}
      {!complete && (
        <p>
          A full successful refund and fresh verification are required before closing this
          exception. Partial/pending refunds and fulfillment requests stay open.
        </p>
      )}
      {data.canApprove && (
        <form
          className="space-y-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!complete || !proof) return;
            setBusy(true);
            setMessage('');
            try {
              const args = {
                id,
                verificationId: proof._id,
                customerAgreement: agreement,
                supplierCancellationEvidence: supplier,
                noOutstandingFulfillment: confirmed,
              };
              const payload = JSON.stringify(args),
                key = retry?.payload === payload ? retry.key : globalThis.crypto.randomUUID();
              setRetry({ payload, key });
              await close({ ...args, requestKey: key });
              setMessage('Verified refund resolution recorded. No money was moved.');
            } catch (error) {
              setMessage(customerMessage(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="block">
            Customer agreement reference and note
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
            Supplier cancellation or verified no-handoff evidence
            <textarea
              className="border block w-full"
              required
              minLength={5}
              maxLength={1000}
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
            />
          </label>
          <label className="block">
            <input
              type="checkbox"
              required
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{' '}
            I verified that no supplier fulfillment remains outstanding for this checkout.
          </label>
          <button className="border p-2" disabled={busy || !complete || !confirmed}>
            Record completed refund resolution
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
