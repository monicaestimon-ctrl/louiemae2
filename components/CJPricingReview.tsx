import React, { useState } from 'react';
import { useAction, useMutation, useQuery, usePaginatedQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import {
  cjListingUrl,
  cjPricingBlocks,
  pricingSelections,
  quoteComplete,
  quoteLanded,
  quoteRetail,
} from '../lib/cjPricingReview';
import type { Id } from '../convex/_generated/dataModel';

const money = (n?: number) => (n === undefined ? 'Unavailable' : `$${n.toFixed(2)}`);
export function CJPricingReview() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.cjPricingReview.listApproved,
    {},
    { initialNumItems: 20 }
  );
  const refresh = useAction(api.cjPricingReview.refresh);
  const alerts = useQuery(api.cjPricingReview.alerts);
  const acknowledge = useMutation(api.cjPricingReview.acknowledge);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const run = async (ids: Id<'products'>[]) => {
    setBusy(true);
    let complete = 0;
    const errors: string[] = [];
    try {
      for (const [index, productId] of ids.entries()) {
        setMessage(`Checking product ${index + 1} of ${ids.length}…`);
        try {
          if ((await refresh({ productId })).complete) complete++;
        } catch (error) {
          errors.push(
            `${results.find((p) => p._id === productId)?.name}: ${error instanceof Error ? error.message : 'Price check failed'}`
          );
        }
      }
      setMessage(`${complete} of ${ids.length} products have complete quotes. ${errors.join(' ')}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="mt-12 rounded-2xl border border-white/10 bg-black/30 p-6 text-cream"
      aria-label="CJ pricing review"
    >
      <h2 className="font-serif text-2xl">CJ prices & margins</h2>
      <p className="my-3 text-sm">
        Automatic checks run about daily, with up to 10 due products processed every 15 minutes.
        Price changes and failed checks appear here until acknowledged. Background checks preserve
        retail prices.
      </p>
      {!!alerts?.length && (
        <aside aria-label="CJ price alerts" className="my-4 rounded border border-amber-300/40 p-4">
          <h3 className="font-semibold">
            Pricing alerts ({alerts.length}
            {alerts.length === 50 ? '+' : ''})
          </h3>
          {alerts.map((item) => (
            <div key={item.id} className="my-3 text-sm">
              <strong>{item.name}</strong>
              <p>{item.alert.message}</p>
              <p className="text-xs">{new Date(item.alert.at).toLocaleString()}</p>
              {item.cjProductId && (
                <a
                  className="mr-4 underline"
                  target="_blank"
                  rel="noreferrer"
                  href={cjListingUrl(item.cjProductId)}
                >
                  CJ listing
                </a>
              )}
              <button
                className="underline"
                onClick={() =>
                  void acknowledge({ productId: item.id, at: item.alert.at }).catch((error) =>
                    setMessage(String(error))
                  )
                }
              >
                Acknowledge
              </button>
            </div>
          ))}
        </aside>
      )}
      <p className="my-3 text-sm text-cream/65">
        Quotes cover one unit shipped to the U.S.; customer-address shipping can differ. Refresh
        calculates retail as 2× CJ item cost + shipping + returned fees, rounded to .99, for
        unlocked unpublished products. Live or locked prices stay unchanged.
      </p>
      <p className="mb-4 text-xs text-cream/60">
        Margins exclude payment processing, advertising, returns, and fees CJ has not quoted. Review
        materials on the CJ listing separately.
      </p>
      <button
        className="rounded border px-3 py-2 disabled:opacity-40"
        disabled={busy || !results.length}
        onClick={() => void run(results.map((p) => p._id))}
      >
        Refresh {results.length} loaded products
      </button>
      <p role="status" className="my-3 text-sm">
        {message}
      </p>
      {results.map((product) => {
        const review = product.cjPricingReview;
        const blocks = cjPricingBlocks(product);
        return (
          <details key={product._id} className="my-3 rounded border border-white/15 p-4">
            <summary className="cursor-pointer">
              {product.name} · {blocks.length ? 'Pricing review required' : 'Pricing checked'} ·
              Retail {money(product.price)}
            </summary>
            <div className="my-3 flex flex-wrap gap-4 text-sm">
              {product.cjProductId && (
                <a
                  className="underline"
                  href={cjListingUrl(product.cjProductId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open CJ product listing
                </a>
              )}
              {product.sourceUrl && (
                <a className="underline" href={product.sourceUrl} target="_blank" rel="noreferrer">
                  Original source listing
                </a>
              )}
              <button
                disabled={busy || !product.cjProductId}
                className="underline disabled:opacity-40"
                onClick={() => void run([product._id])}
              >
                Refresh CJ prices & shipping
              </button>
            </div>
            <p className="text-xs text-cream/60">
              {review
                ? `Checked ${new Date(review.checkedAt).toLocaleString()} · ${review.quantity} unit · ${review.destination}`
                : 'No verified pricing review yet.'}
              {product.adminPriceLocked ? ' · Retail price is locked.' : ''}
            </p>
            <div className="overflow-x-auto">
              <table className="my-3 w-full text-left text-sm">
                <thead>
                  <tr>
                    {[
                      'Variant',
                      'CJ item',
                      'Shipping',
                      'Quoted fees',
                      'Landed estimate',
                      'Current retail',
                      'Suggested retail',
                      'Margin',
                    ].map((h) => (
                      <th className="p-2" key={h}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pricingSelections(product).map((variant) => {
                    const quote = review?.quotes.find(
                      (q) => q.vid === variant.cjVariantId && q.sku === variant.cjSku
                    );
                    const complete = quote && quoteComplete(quote);
                    const landed = complete ? quoteLanded(quote) : undefined;
                    return (
                      <tr key={variant.id} className="border-t border-white/10">
                        <td className="p-2">
                          {variant.name}
                          <small className="block text-cream/60">
                            {quote?.error ??
                              (quote
                                ? `${quote.origin ?? '?'} → US · ${quote.logisticsName ?? 'No shipping quote'}`
                                : 'Not checked')}
                          </small>
                        </td>
                        <td className="p-2">{money(quote?.itemCost)}</td>
                        <td className="p-2">{money(quote?.shippingCost)}</td>
                        <td className="p-2">
                          {money(
                            complete ? (quote.taxesFee ?? 0) + (quote.clearanceFee ?? 0) : undefined
                          )}
                        </td>
                        <td className="p-2">{money(landed)}</td>
                        <td className="p-2">{money(variant.retail)}</td>
                        <td className="p-2">{money(complete ? quoteRetail(quote) : undefined)}</td>
                        <td className="p-2">
                          {landed !== undefined && variant.retail > 0
                            ? `${(((variant.retail - landed) / variant.retail) * 100).toFixed(1)}% (${money(variant.retail - landed)})`
                            : 'Unavailable'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {blocks.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-amber-200">
                {blocks.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          </details>
        );
      })}
      {status === 'LoadingFirstPage' && <p>Loading approved products…</p>}
      {status === 'Exhausted' && !results.length && <p>No approved products yet.</p>}
      {status === 'CanLoadMore' && (
        <button className="mt-3 underline" disabled={busy} onClick={() => loadMore(20)}>
          Load more approved products
        </button>
      )}
    </section>
  );
}
