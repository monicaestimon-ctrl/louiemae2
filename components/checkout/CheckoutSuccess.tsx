import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { useCart } from '../../contexts/CartContext';
import {
  cartFingerprint,
  cartLines,
  checkoutAccess,
  consumeCheckoutCart,
} from '../../lib/delivery/checkoutReturn';

const money = (n: number) => `$${(n / 100).toFixed(2)}`;
const safeTracking = (url: string | null) => {
  try {
    const u = new URL(url ?? '');
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
};

function Receipt() {
  const { clearCart, items } = useCart();
  const [sessionId] = useState(
    () => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('session_id') ?? ''
  );
  const [access] = useState(() => checkoutAccess(sessionId));
  const receipt = useQuery(
    api.ordReceipts.receipt,
    sessionId
      ? {
          sessionId,
          ...(access?.guestCapability ? { guestCapability: access.guestCapability } : {}),
        }
      : 'skip'
  );
  const [slow, setSlow] = useState(false);
  const cleared = useRef(false);
  const confirmed = receipt?.state === 'confirmed' || receipt?.state === 'legacy_confirmed';
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 30000);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (
      !confirmed ||
      cleared.current ||
      !access?.cart ||
      access.cart !== cartFingerprint(cartLines(items))
    )
      return;
    cleared.current = true;
    consumeCheckoutCart(sessionId);
    clearCart();
  }, [confirmed, access, items, clearCart, sessionId]);

  const order = receipt?.state === 'confirmed' ? receipt.order : null;
  const unavailable = !sessionId || receipt?.state === 'unavailable';
  return (
    <>
      <h1 className="font-serif text-4xl text-earth mb-4">
        {confirmed
          ? (order?.statusLabel ?? 'Order confirmed')
          : unavailable
            ? 'Order access needed'
            : 'Checking your order'}
      </h1>
      <div aria-live="polite" role="status" className="space-y-4">
        {unavailable ? (
          <p>
            We cannot verify this order from this browser. Return using the browser where you
            checked out, or sign in with the purchasing account through{' '}
            <a className="underline" href="/trade" target="_blank" rel="noopener noreferrer">
              HOLM
            </a>
            , then return here. Guest access lasts 90 days. For help, contact{' '}
            <a className="underline" href="/#support">
              customer support
            </a>
            .
          </p>
        ) : receipt?.state === 'review_required' ? (
          <p>
            Your payment needs review. Please contact customer support before attempting another
            payment. Your cart has been preserved.
          </p>
        ) : receipt?.state === 'not_completed' ? (
          <p>
            This checkout was not completed or the order was cancelled. Your cart has been
            preserved. If you see a charge, contact customer support before paying again.
          </p>
        ) : !confirmed ? (
          <p>
            {slow
              ? 'Confirmation is taking longer than expected. This page will update when payment is verified. Keep your payment reference and contact support if needed; do not pay again while confirmation is pending.'
              : 'Waiting for verified payment confirmation. Your cart is preserved until your order is confirmed.'}
          </p>
        ) : (
          <>
            {receipt.state === 'confirmed' && (
              <p>
                {receipt.emailStatus === 'accepted'
                  ? 'Your confirmation email has been accepted by our email provider. Check your inbox and spam folder.'
                  : receipt.emailStatus === 'pending'
                    ? 'Your confirmation email is queued for sending.'
                    : 'Your order is saved. Email confirmation is not yet verified; contact support if it does not arrive.'}
              </p>
            )}
            {receipt.state === 'legacy_confirmed' && (
              <p>
                Your payment is recorded. Email delivery is not verified on this page. Keep your
                payment receipt for support.
              </p>
            )}
            <p>
              {order?.disclosure ??
                (receipt.state === 'legacy_confirmed' ? receipt.disclosure : '')}
            </p>
            {order && (
              <section
                className="bg-white border p-6 text-left space-y-3"
                aria-label="Order details"
              >
                <h2 className="font-serif text-xl">Order {order.number}</h2>
                <p>Merchandise: {money(order.totals.merchandise)}</p>
                {order.totals.discount > 0 && <p>Discount: −{money(order.totals.discount)}</p>}
                {order.totals.credit > 0 && <p>Store credit: −{money(order.totals.credit)}</p>}
                <p>Delivery: {money(order.totals.delivery)}</p>
                <p>Tax: {money(order.totals.tax)}</p>
                <p>
                  <strong>Total paid: {money(order.totals.total)}</strong>
                </p>
                {order.serviceTerms && (
                  <div>
                    <p>{order.serviceTerms.label}</p>
                    {order.serviceTerms.details.map((d, i) => (
                      <p key={i}>{d}</p>
                    ))}
                  </div>
                )}
                {order.shipments.map((group) => (
                  <section key={group.label} className="border-t pt-3">
                    <h3>{group.label}</h3>
                    {group.items.map((item, i) => (
                      <p key={i}>
                        {item.name} · {item.pieces} pieces · {item.status.replaceAll('_', ' ')}
                      </p>
                    ))}
                    {group.tracking.length === 0 && (
                      <p>Tracking will appear once this shipment is dispatched.</p>
                    )}
                    {group.tracking.map((tracking, i) => (
                      <p key={i}>
                        {tracking.carrier ?? 'Carrier'} · {tracking.status.replaceAll('_', ' ')}{' '}
                        {tracking.estimatedWindow ?? ''}{' '}
                        {safeTracking(tracking.trackingUrl) && (
                          <a
                            className="underline"
                            href={safeTracking(tracking.trackingUrl)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            referrerPolicy="no-referrer"
                          >
                            Track shipment
                          </a>
                        )}
                      </p>
                    ))}
                  </section>
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}

class ReceiptBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div role="alert">
        <h1>Order confirmation unavailable</h1>
        <p>
          We cannot load the current order status. Refresh to check again, or contact support before
          attempting another payment.
        </p>
      </div>
    ) : (
      this.props.children
    );
  }
}
const subscribeHash = (changed: () => void) => {
  window.addEventListener('hashchange', changed);
  return () => window.removeEventListener('hashchange', changed);
};
export const CheckoutSuccess: React.FC = () => {
  const route = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => ''
  );
  return (
    <main className="min-h-screen bg-cream pt-32 pb-20 px-6">
      <div className="max-w-2xl mx-auto text-center">
        <ReceiptBoundary key={route}>
          <Receipt />
        </ReceiptBoundary>
        <nav className="mt-8 flex gap-6 justify-center" aria-label="After checkout">
          <a href="/#shop">Continue shopping</a>
          <a href="/#support">Contact support</a>
        </nav>
      </div>
    </main>
  );
};
export default CheckoutSuccess;
