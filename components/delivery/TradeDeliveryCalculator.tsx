import { useDeliveryRequest } from './useDeliveryRequest';
import DeliveryBoundary from './DeliveryBoundary';
import React, { useEffect, useState } from 'react';
import { usePaginatedQuery, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { DeliveryCheckout } from './CheckoutV2';
import DeliveryQuoteRequest from './DeliveryQuoteRequest';
import { customerMessage } from '../../lib/errors';
const money = (n: number | null) => (n === null ? 'Unavailable' : `$${(n / 100).toFixed(2)}`);
export default function TradeDeliveryCalculator() {
  const settings = useQuery(api.dlvTradeCalculator.settings, {});
  if (!settings) return <p>Loading calculator…</p>;
  if (!settings.enabled)
    return (
      <p>Build a project in your tray to request confirmed merchandise and delivery pricing.</p>
    );
  if (!settings.approvedTrade)
    return (
      <p>
        Build a project after trade approval to see savings from actual approved product prices.
        Trade savings and retail-referral earnings are separate benefits.
      </p>
    );
  return (
    <DeliveryBoundary>
      <ApprovedCalculator />
    </DeliveryBoundary>
  );
}
function ApprovedCalculator() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.dlvTradeCalculator.catalog,
    {},
    { initialNumItems: 20 }
  );
  const [lines, setLines] = useState<{ productId: string; variantId: string; packs: number }[]>([]),
    [zip, setZip] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const quantitiesValid = lines.every((l) => {
    const v = results.find((p) => p.id === l.productId)?.variants.find((v) => v.id === l.variantId);
    return (
      v &&
      Number.isSafeInteger(l.packs) &&
      l.packs >= v.minimum &&
      (l.packs - v.minimum) % v.increment === 0 &&
      l.packs <= 10000
    );
  });
  const result = useQuery(
    api.dlvTradeCalculator.calculate,
    lines.length && quantitiesValid ? { lines } : 'skip'
  );
  const estimate = useDeliveryRequest('estimate');
  const [delivery, setDelivery] = useState<{
    key: string;
    status: string;
    charge: number | null;
    expires: number;
  } | null>(null);
  const key = JSON.stringify({ lines, zip });
  useEffect(() => {
    if (!delivery) return;
    const timer = setTimeout(() => setDelivery(null), Math.max(0, delivery.expires - Date.now()));
    return () => clearTimeout(timer);
  }, [delivery]);
  return (
    <section className="space-y-3 text-sm" aria-label="Trade project delivery and savings">
      <h3>Calculate your project</h3>
      <select
        aria-label="Add project product"
        value=""
        onChange={(e) => {
          const [productId, variantId] = e.target.value.split('|');
          if (productId && variantId)
            setLines((x) =>
              x.some((l) => l.variantId === variantId)
                ? x
                : [
                    ...x,
                    {
                      productId,
                      variantId,
                      packs:
                        results
                          .find((p) => p.id === productId)
                          ?.variants.find((v) => v.id === variantId)?.minimum ?? 1,
                    },
                  ]
            );
        }}
      >
        <option value="">Choose an approved product</option>
        {results.flatMap((p) =>
          p.variants.map((v) => (
            <option key={`${p.id}:${v.id}`} value={`${p.id}|${v.id}`}>
              {p.name} — {v.name}
            </option>
          ))
        )}
      </select>
      {status === 'CanLoadMore' && (
        <button type="button" onClick={() => loadMore(20)}>
          Load more products
        </button>
      )}
      {lines.map((l) => (
        <div key={l.variantId} className="flex gap-2">
          <span>
            {result?.lines.find((x) => x.variantId === l.variantId)?.name ?? 'Selected product'}
          </span>
          <input
            type="number"
            aria-label="Packs"
            min={
              results.find((p) => p.id === l.productId)?.variants.find((v) => v.id === l.variantId)
                ?.minimum ?? 1
            }
            step={
              results.find((p) => p.id === l.productId)?.variants.find((v) => v.id === l.variantId)
                ?.increment ?? 1
            }
            value={l.packs}
            onChange={(e) =>
              setLines((xs) =>
                xs.map((x) =>
                  x.variantId === l.variantId ? { ...x, packs: Number(e.target.value) } : x
                )
              )
            }
          />
          <button
            type="button"
            onClick={() => setLines((xs) => xs.filter((x) => x.variantId !== l.variantId))}
          >
            Remove
          </button>
        </div>
      ))}
      {result && (
        <div aria-live="polite">
          <p>Retail comparison: {money(result.retailComparisonMinor)}</p>
          <p>Approved trade merchandise: {money(result.tradeSubtotalMinor)}</p>
          <p>Additional project savings: {money(result.projectSavingsMinor)}</p>
          <p>Final project merchandise: {money(result.finalMerchandiseMinor)}</p>
          <p>Total merchandise savings: {money(result.totalMerchandiseSavingsMinor)}</p>
          {!result.comparisonComplete && (
            <p>
              Retail comparison available for {result.comparableLines} of {lines.length} lines.
            </p>
          )}
          {!result.projectPolicyApproved && <p>Project pricing requires review.</p>}
          <p>{result.note}</p>
          <p>
            Separate scenario — estimated earnings if your client purchases eligible items at Louie
            Mae retail: {money(result.referralEstimateMinor)}
          </p>
        </div>
      )}
      {!quantitiesValid && (
        <p role="alert">
          Enter each item's minimum pack quantity and order increment before calculating.
        </p>
      )}
      <p>
        Only currently cost-verified products appear here. Request a project quote for other items.
      </p>
      <label>
        Delivery ZIP
        <input
          value={zip}
          onChange={(e) => setZip(e.target.value)}
          maxLength={10}
          inputMode="numeric"
        />
      </label>
      <button
        type="button"
        disabled={!lines.length || !quantitiesValid || busy}
        onClick={async () => {
          setBusy(true);
          setMessage('');
          const requestKey = key;
          try {
            const r = await estimate({
              lines,
              channel: 'trade',
              zip,
              visitorKey: 'approved-trade-calculator',
            });
            setDelivery({
              key: requestKey,
              status: r.status,
              charge: r.deliveryChargeMinor,
              expires: r.expiresAt,
            });
          } catch (e) {
            setMessage(customerMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Estimating…' : 'Estimate project delivery'}
      </button>
      {delivery && delivery.key === key && delivery.expires > Date.now() && (
        <p>
          Delivery: {delivery.status === 'ok' ? money(delivery.charge) : 'Quote required'} —
          recalculated with your full address before payment.
        </p>
      )}
      {lines.length > 0 && (
        <details>
          <summary>Review delivery and checkout for this basket</summary>
          <DeliveryCheckout lines={lines} channel="trade" />
        </details>
      )}
      <p aria-live="polite">{message}</p>
      <DeliveryQuoteRequest lines={lines} postalCode={zip} channel="trade" />
    </section>
  );
}
