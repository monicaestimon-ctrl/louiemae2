import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { customerMessage } from '../../lib/errors';
import { SPLIT_MAY } from '../../lib/customerCopy';
import { useAuthToken } from '@convex-dev/auth/react';
const money = (n: number) => `$${(n / 100).toFixed(2)}`;
export type QuoteAccess = { id: Id<'dlvQuoteRequests'>; guestCapability?: string };

export default function DeliveryQuoteStatus({ request }: { request: QuoteAccess }) {
  const status = useQuery(api.dlvOperations.requestStatus, request),
    accept = useMutation(api.dlvOperations.acceptQuote);
  const prepare = useMutation(api.dlvOperations.prepareCheckout),
    authToken = useAuthToken();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const q = status?.quote;
  const url = new URL(window.location.href);
  url.searchParams.set('deliveryQuote', request.id);
  url.hash = request.guestCapability ? `delivery-access=${request.guestCapability}` : '';
  return (
    <section className="space-y-2 text-sm" aria-label="Delivery quote status">
      <h3>Your delivery quote</h3>
      <p>Reference: {request.id}</p>
      <p>
        Status:{' '}
        {status === null ? 'Quote unavailable' : (status?.status.replaceAll('_', ' ') ?? 'Loading')}
      </p>
      {status?.message && <p>{status.message}</p>}
      <p>
        <a href={url.href} className="underline" referrerPolicy="no-referrer">
          Save this private quote link
        </a>
        . Anyone with a guest link can view and accept this quote. Guest access expires 90 days
        after your request.
      </p>
      {q && (
        <div className="border p-3 space-y-2">
          <h4>Version {q.version}</h4>
          {q.lines.map((l) => (
            <p key={l.variantId}>
              {status?.lines.find((x) => x.variantId === l.variantId)?.name ?? 'Quoted product'} ×{' '}
              {l.packs} packs · {money(l.unitPackMinor * l.packs - l.discountMinor)}
            </p>
          ))}
          <p>Merchandise: {money(q.merchandiseMinor)}</p>
          <p>Delivery: {money(q.deliveryMinor)}</p>
          <p>Tax: {money(q.taxMinor)}</p>
          <p>
            <strong>Total: {money(q.totalMinor)}</strong>
          </p>
          <p>Service: {q.service}</p>
          {q.address && (
            <p>
              {q.address.line1}, {q.address.city}, {q.address.state} {q.address.postalCode}
            </p>
          )}
          <p>{q.terms}</p>
          <p>{SPLIT_MAY}</p>
          <p>Valid until {new Date(q.expiresAt).toLocaleString()}.</p>
          {now >= q.expiresAt ? (
            <p>This quote has expired. Request an updated version before ordering.</p>
          ) : (
            status?.status === 'sent' && (
              <button
                type="button"
                disabled={busy}
                className="border p-2"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await accept({ ...request, versionId: q.id });
                    setMessage(
                      'Quote accepted. This does not charge you. Payment availability is confirmed separately.'
                    );
                  } catch (e) {
                    setMessage(customerMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Accept this exact quote
              </button>
            )
          )}
        </div>
      )}
      {q && status?.status === 'accepted' && q.expiresAt > now && (
        <button
          type="button"
          className="border p-2"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMessage('');
            try {
              const prepared = await prepare(request);
              if (prepared.acceptTotalMinor !== q.totalMinor)
                throw new Error('Quote total changed; request a new version');
              const site = String(import.meta.env.VITE_CONVEX_URL || '').replace(
                '.convex.cloud',
                '.convex.site'
              );
              const response = await fetch(`${site}/v2/checkout`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                },
                body: JSON.stringify({
                  ...prepared,
                  idempotencyKey: `manual-${prepared.estimateId}`,
                }),
              });
              const result = await response.json();
              if (response.ok && result.url) window.location.href = result.url;
              else setMessage(result.error || 'This quote needs review before payment.');
            } catch (e) {
              setMessage(customerMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Continue to payment for {money(q.totalMinor)}
        </button>
      )}
      <p role="status">{message}</p>
      <p>Requests and acceptance do not reserve stock or charge you.</p>
    </section>
  );
}

class QuoteBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
function QuoteRecovery({ id }: { id: Id<'dlvQuoteRequests'> }) {
  const recover = useMutation(api.dlvOperations.recoverQuote),
    [message, setMessage] = useState('');
  return (
    <div>
      <p>
        This private quote could not be opened. Use its original unexpired private link, or sign
        into a verified account with the email used for the request.
      </p>
      <button
        onClick={async () => {
          try {
            await recover({ id });
            window.location.reload();
          } catch (e) {
            setMessage(customerMessage(e));
          }
        }}
      >
        Recover quote with my verified account
      </button>
      <p role="status">{message}</p>
    </div>
  );
}
/** Tokens stay in the fragment, never query strings, server logs or referrer headers. */
export function DeliveryQuoteAccess() {
  const [request] = useState<QuoteAccess | null>(() => {
    const url = new URL(window.location.href),
      id = url.searchParams.get('deliveryQuote');
    if (!id) return null;
    const token = new URLSearchParams(url.hash.slice(1)).get('delivery-access');
    return { id: id as Id<'dlvQuoteRequests'>, ...(token ? { guestCapability: token } : {}) };
  });
  if (!request) return null;
  return (
    <aside className="p-6 bg-white text-earth border" aria-label="Requested delivery quote">
      <QuoteBoundary fallback={<QuoteRecovery id={request.id} />}>
        <DeliveryQuoteStatus request={request} />
      </QuoteBoundary>
    </aside>
  );
}
