import React from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
export function TrendsiReceipt({ route }: { route: string }) {
  const params = new URLSearchParams(route.split('?')[1] ?? '');
  const id = params.get('trendsi'),
    access = params.get('access');
  const receipt = useQuery(
    api.trendsiManual.receipt,
    id && access ? { id: id as Id<'trendsiOrders'>, access } : 'skip'
  );
  if (receipt?.status === 'refunded')
    return (
      <div>
        <h1 className="font-serif text-4xl mb-5">Payment refunded</h1>
        <p>{receipt.number}</p>
        <p className="mt-4">
          A full refund has been confirmed. Contact us for any supplier cancellation or return
          questions.
        </p>
      </div>
    );
  if (receipt && ['ordered', 'partially_shipped', 'shipped', 'delivered'].includes(receipt.status))
    return (
      <div>
        <h1 className="font-serif text-4xl mb-5">
          {receipt.status === 'delivered'
            ? 'Order delivered'
            : receipt.status === 'shipped'
              ? 'Order shipped'
              : receipt.status === 'partially_shipped'
                ? 'Order partially shipped'
                : 'Supplier order placed'}
        </h1>
        <p>{receipt.number}</p>
        <p className="mt-4">Contact our team for delivery and tracking details.</p>
      </div>
    );
  return (
    <div aria-live="polite">
      <h1 className="font-serif text-4xl mb-5">
        {receipt?.review
          ? 'Your order needs review'
          : receipt?.paid
            ? 'Payment received'
            : 'Your order request'}
      </h1>
      {receipt ? (
        <>
          <p>{receipt.number}</p>
          <p className="mt-4">
            {receipt.review
              ? 'Our team is reviewing this order. Please contact support before making another payment.'
              : receipt.paid
                ? 'Thank you. Our team will place your supplier order and follow up with tracking.'
                : 'Payment has not been confirmed. If you just paid, allow a moment for confirmation. Otherwise, use your payment link before it expires, or contact us to refresh availability.'}
          </p>
          {receipt.paid && receipt.totalMinor !== null && (
            <p className="mt-4">Total paid: {'$' + (receipt.totalMinor / 100).toFixed(2)}</p>
          )}
        </>
      ) : (
        <p>
          {receipt === null
            ? 'We could not verify this request. Please use your original payment link or contact support.'
            : 'Checking the latest payment status…'}
        </p>
      )}
    </div>
  );
}
