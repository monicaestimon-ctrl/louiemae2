import React, { useState } from 'react';
import { useConvex, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { customerMessage } from '../../lib/errors';
import { dollarsToMinor } from '../../lib/decimal';
const fields = {
  wholesaleMinor: 'Merchandise wholesale',
  dutiesMinor: 'Duties',
  inboundMinor: 'Inbound freight',
  otherSupplierFeesMinor: 'Other supplier fees (exclude dropship fees on freight invoices)',
  paymentMinor: 'Actual payment processing',
  commissionMinor: 'Actual referral commission',
  overheadMinor: 'Allocated overhead',
  returnLossMinor: 'Additional return/damage loss (exclude refunds and costs already above)',
  advertisingMinor: 'Advertising allocation',
  recoveriesMinor: 'Supplier reimbursements / recovered inventory value',
  merchandiseRefundMinor: 'Merchandise revenue refunded (exclude tax and restored store credit)',
  deliveryRefundMinor: 'Delivery revenue refunded (exclude tax)',
} as const;
export default function DeliveryActualCosts() {
  const client = useConvex(),
    record = useMutation(api.dlvOperations.recordActualCosts);
  const [order, setOrder] = useState(''),
    [amounts, setAmounts] = useState<Record<string, string>>({}),
    [evidence, setEvidence] = useState(''),
    [final, setFinal] = useState(false),
    [details, setDetails] = useState<unknown>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  async function run(save: boolean) {
    setBusy(true);
    setMessage('');
    try {
      const orderId = order.trim() as Id<'ordOrders'>;
      if (save) {
        const values = Object.fromEntries(
          Object.keys(fields).map((k) => {
            if (!amounts[k]?.trim())
              throw new Error('Enter each expense, including a confirmed 0.');
            return [k, dollarsToMinor(amounts[k])];
          })
        ) as Record<keyof typeof fields, number>;
        await record({ orderId, ...values, freightFinal: final, evidence });
      }
      setDetails(await client.query(api.dlvOperations.actualContribution, { orderId }));
    } catch (e) {
      setMessage(customerMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="border p-4 space-y-3">
      <summary>Actual order costs and contribution</summary>
      <p>
        Enter dollars using reviewed invoices and settlement records. Leave unknown costs blank.
        Freight, fuel, accessorials and dropship fees come from the supplier-order invoices, so do
        not enter them again. A delivery allowance is not another expense.
      </p>
      <label>
        Paid order ID
        <input
          className="block border p-2 w-full"
          value={order}
          onChange={(e) => setOrder(e.target.value)}
        />
      </label>
      <div className="grid md:grid-cols-2 gap-3">
        {Object.entries(fields).map(([key, label]) => (
          <label key={key}>
            {label} ($)
            <input
              className="block border p-2 w-full"
              inputMode="decimal"
              value={amounts[key] ?? ''}
              onChange={(e) => setAmounts((x) => ({ ...x, [key]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <label>
        Evidence and allocation explanation
        <textarea
          className="block border p-2 w-full"
          maxLength={4000}
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
        />
      </label>
      <label>
        <input type="checkbox" checked={final} onChange={(e) => setFinal(e.target.checked)} /> All
        supplier freight invoices are final and reconciled.
      </label>
      <div className="flex gap-3">
        <button disabled={busy} onClick={() => run(false)}>
          View contribution record
        </button>
        <button disabled={busy || !evidence.trim()} onClick={() => run(true)}>
          Record cost statement
        </button>
      </div>
      <p role="status">{message}</p>
      {details !== null && (
        <pre className="overflow-auto max-h-96 text-xs">{JSON.stringify(details, null, 2)}</pre>
      )}
    </details>
  );
}
