import React, { useEffect, useState } from 'react';
import { useMutation, usePaginatedQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import type { Channel } from '../lib/commerce';
import './commerce.css';
const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100);
type Selection = {
  productId: Id<'commerceProducts'>;
  variantId: string;
  quantity: number;
  name: string;
  minimum: number;
  increment: number;
  price: number;
};
export function CommerceCatalog({ channel }: { channel: Channel }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.commerce.catalog,
    { channel, customerView: true },
    { initialNumItems: 24 }
  );
  // Convex pagination cursors track raw rows; readiness filtering can empty a page.
  // Continue through those pages automatically until a visible item or exhaustion.
  useEffect(() => {
    if (!results.length && status === 'CanLoadMore') loadMore(24);
  }, [results.length, status, loadMore]);
  const submit = useMutation(api.commerceProjects.submit);
  const [items, setItems] = useState<Selection[]>([]);
  const [token, setToken] = useState(() => window.crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (!results.length && status === 'Exhausted') return null;
  return (
    <section className="commerce-studio commerce-catalog" aria-label="Made for your space">
      <h2>{channel === 'house' ? 'Selected for your project' : 'Made for your space'}</h2>
      <p>
        Explore the collection and request a personal quote. Estimates exclude delivery and tax; we
        confirm availability, timing, and your final price before payment.
      </p>
      {!results.length && status !== 'Exhausted' && <p role="status">Gathering the collection…</p>}
      <div className="commerce-product-grid">
        {results.map((p) => (
          <article key={p.id}>
            <img className="commerce-product-hero" src={p.images[0]} alt={p.name} loading="lazy" />
            <h3>{p.name}</h3>
            <p>{p.description}</p>
            <details>
              <summary>Details & views</summary>
              <p style={{ whiteSpace: 'pre-line' }}>{p.facts}</p>
              <div className="commerce-gallery">
                {p.images.slice(1).map((src, i) => (
                  <a key={src} href={src} target="_blank" rel="noreferrer">
                    <img src={src} alt={`${p.name}, view ${i + 2}`} loading="lazy" />
                  </a>
                ))}
              </div>
            </details>
            {p.variants.map((v) => (
              <div key={v.id}>
                {v.image && (
                  <img
                    className="commerce-variant-image"
                    src={v.image}
                    alt={v.name}
                    loading="lazy"
                  />
                )}
                <p>
                  {v.name} · Estimated {money(v.price)} each
                  {v.minimum > 1 ? ` · Minimum ${v.minimum}` : ''}
                </p>
                <button
                  disabled={items.some((l) => l.productId === p.id && l.variantId === v.id)}
                  onClick={() =>
                    setItems((old) => [
                      ...old,
                      {
                        productId: p.id,
                        variantId: v.id,
                        quantity: v.minimum,
                        name: `${p.name} — ${v.name}`,
                        minimum: v.minimum,
                        increment: v.increment,
                        price: v.price,
                      },
                    ])
                  }
                >
                  Add to quote
                </button>
              </div>
            ))}
          </article>
        ))}
      </div>
      {results.length > 0 && status === 'CanLoadMore' && <button onClick={() => loadMore(24)}>Explore more</button>}
      {message && <p role="status">{message}</p>}
      {!!items.length && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = new FormData(form);
            const value = (key: string) => String(data.get(key) || '').trim();
            setBusy(true);
            setMessage('');
            try {
              await submit({
                token,
                channel,
                name: value('name'),
                email: value('email'),
                phone: value('phone'),
                business: value('business'),
                notes: value('notes'),
                website: value('website'),
                address: {
                  line1: value('line1'),
                  city: value('city'),
                  state: value('state'),
                  postalCode: value('postalCode'),
                  country: value('country').toUpperCase(),
                },
                items: items.map(({ productId, variantId, quantity }) => ({
                  productId,
                  variantId,
                  quantity,
                })),
              });
              setItems([]);
              setToken(window.crypto.randomUUID());
              setMessage(
                'Your request is saved. We’ll review your selection and contact you with a confirmed quote.'
              );
            } catch (e) {
              setMessage(e instanceof Error ? e.message : 'Please try again.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3>Your selection</h3>
          {items.map((l, i) => (
            <fieldset key={`${l.productId}:${l.variantId}`}>
              <legend>{l.name}</legend>
              <label>
                Quantity
                <input
                  type="number"
                  required
                  min={l.minimum}
                  step={l.increment}
                  value={l.quantity}
                  onChange={(e) =>
                    setItems((old) =>
                      old.map((x, n) => (n === i ? { ...x, quantity: Number(e.target.value) } : x))
                    )
                  }
                />
              </label>
              <p>Estimated {money(l.price * l.quantity)}</p>
              <button
                type="button"
                onClick={() => setItems((old) => old.filter((_, n) => n !== i))}
              >
                Remove
              </button>
            </fieldset>
          ))}
          <div className="commerce-fields">
            {[
              'name',
              'email',
              'phone',
              'business',
              'line1',
              'city',
              'state',
              'postalCode',
              'country',
            ].map((key) => (
              <label key={key}>
                {
                  (
                    {
                      name: 'Your name',
                      email: 'Email',
                      phone: 'Phone',
                      business: 'Company (optional)',
                      line1: 'Delivery address',
                      city: 'City',
                      state: 'State / province',
                      postalCode: 'Postal code',
                      country: 'Country code (e.g. US)',
                    } as Record<string, string>
                  )[key]
                }
                <input
                  name={key}
                  type={key === 'email' ? 'email' : 'text'}
                  required={key !== 'business' && key !== 'state'}
                  maxLength={key === 'country' ? 2 : 200}
                  defaultValue={key === 'country' ? 'US' : ''}
                />
              </label>
            ))}
          </div>
          <label>
            Timing, quantities, and project details
            <textarea name="notes" maxLength={3000} />
          </label>
          <div hidden aria-hidden="true">
            <label>
              Website
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          <button disabled={busy}>{busy ? 'Saving…' : 'Request my quote'}</button>
        </form>
      )}
    </section>
  );
}
