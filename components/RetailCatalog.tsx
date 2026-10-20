import React, { useEffect } from 'react';
import { usePaginatedQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import { useCart } from '../contexts/CartContext';
import { SafeImage } from './SafeImage';

const money = (cents: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
export function RetailCatalog() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.retailLaunch.catalog,
    {},
    { initialNumItems: 24 }
  );
  const { addToCart } = useCart();
  useEffect(() => {
    if (!results.length && status === 'CanLoadMore') loadMore(24);
  }, [results.length, status, loadMore]);
  return (
    <section id="shop-furniture" className="max-w-7xl mx-auto px-6 py-16">
      <div className="text-center mb-10">
        <p className="text-xs uppercase tracking-[.25em] text-bronze">The furniture collection</p>
        <h2 className="font-serif text-4xl text-earth mt-3">Make yourself at home.</h2>
        <p className="text-earth/70 mt-4">
          Shop our Ashcroft collection. Delivery is shown with each piece and added per item at
          checkout.
        </p>
        <p className="text-earth/60 text-sm mt-2">
          Clothing and our other furniture collections are coming soon.
        </p>
      </div>
      {status === 'LoadingFirstPage' && <p role="status">Gathering the collection…</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
        {results.map((p) => (
          <article
            key={p.id}
            className="rounded-2xl border border-earth/10 bg-white/60 overflow-hidden"
          >
            <SafeImage
              src={p.images[0]}
              alt={p.name}
              className="w-full aspect-square object-cover"
            />
            <div className="p-6">
              <h3 className="font-serif text-xl text-earth">{p.name}</h3>
              <p className="text-sm text-earth/70 mt-3 whitespace-pre-line">{p.description}</p>
              <details className="mt-4 text-sm text-earth/70">
                <summary className="cursor-pointer">Details &amp; views</summary>
                <p className="whitespace-pre-line mt-3">{p.facts}</p>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {p.images.slice(1).map((src) => (
                    <a href={src} key={src} target="_blank" rel="noreferrer">
                      <SafeImage src={src} alt={p.name} className="w-full rounded-lg" />
                    </a>
                  ))}
                </div>
              </details>
              {p.variants.map((v) => (
                <div key={v.id} className="mt-5 border-t border-earth/10 pt-4">
                  {v.name !== 'Default Title' && <p className="text-sm">{v.name}</p>}
                  <p className="font-serif text-xl text-earth">{money(v.price)}</p>
                  {v.purchasable && (
                    <p className="text-sm text-earth/70 mt-1">
                      {money((p.deliveryFee ?? 0) * 100)} Economy delivery per item
                    </p>
                  )}
                  <button
                    disabled={!v.purchasable}
                    className="mt-3 w-full rounded-lg bg-earth text-cream py-3 disabled:opacity-50"
                    onClick={() =>
                      addToCart(
                        {
                          id: p.id,
                          name: p.name,
                          description: p.description,
                          category: p.category,
                          collection: 'furniture',
                          images: p.images,
                          price: v.price / 100,
                          inStock: true,
                          fulfillmentProvider: 'ashcroft',
                          deliveryFee: p.deliveryFee ?? 0,
                        },
                        v.minimum,
                        {
                          id: v.id,
                          name: v.name,
                          image: v.image,
                          priceAdjustment: 0,
                          inStock: true,
                        }
                      )
                    }
                  >
                    {v.purchasable ? 'Add to Cart' : 'Coming Soon'}
                  </button>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
      {status === 'CanLoadMore' && (
        <button
          className="block mx-auto mt-10 px-8 py-3 border border-earth/30 rounded-lg"
          onClick={() => loadMore(24)}
        >
          Explore more furniture
        </button>
      )}
      {status === 'LoadingMore' && <p role="status">Loading more pieces…</p>}
    </section>
  );
}
