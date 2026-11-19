import React, { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import type { Product, ProductVariant } from '../types';
import { Modal } from './Modal';

export function TrendsiRequestButton({
  product,
  option,
}: {
  product: Product;
  option?: ProductVariant;
}) {
  const enabled = useQuery(api.trendsiManual.enabled, {});
  const submit = useMutation(api.trendsiManual.submit);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const [token] = useState(() => window.crypto.randomUUID());
  const [error, setError] = useState(''),
    [number, setNumber] = useState('');
  if (!enabled)
    return (
      <button disabled className="w-full py-4 border border-earth/20 text-earth/60">
        Coming Soon
      </button>
    );
  return (
    <>
      <button
        disabled={!option}
        onClick={() => setOpen(true)}
        className="w-full py-4 bg-earth text-cream disabled:opacity-50"
      >
        {option ? 'Request availability' : 'Select a size and color'}
      </button>
      <p className="text-sm text-earth/70 mt-2">
        We’ll confirm availability and delivery before you pay.
      </p>
      <Modal
        open={open}
        label="Request availability"
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        className="bg-cream text-earth p-6 sm:p-8 rounded-xl w-full max-w-lg"
      >
        <button onClick={() => setOpen(false)} disabled={busy} className="float-right underline">
          Close
        </button>
        <h2 className="font-serif text-2xl mb-4">Request availability</h2>
        {number ? (
          <div role="status">
            <p>
              Request received: <strong>{number}</strong>
            </p>
            <p className="mt-3">
              We’ll review your selection and contact you with availability, delivery, and a payment
              link. No payment has been taken.
            </p>
          </div>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!option || busy) return;
              const f = new FormData(e.currentTarget),
                value = (key: string) => String(f.get(key) ?? '').trim();
              setBusy(true);
              setError('');
              try {
                const result = await submit({
                  token,
                  name: value('name'),
                  email: value('email'),
                  phone: value('phone'),
                  notes: value('notes'),
                  website: value('website'),
                  address: {
                    line1: value('line1'),
                    line2: value('line2'),
                    city: value('city'),
                    state: value('state').toUpperCase(),
                    postalCode: value('postalCode'),
                    country: 'US',
                  },
                  items: [
                    {
                      productId: product.id as Id<'products'>,
                      variantId: option.id,
                      quantity: Number(value('quantity')),
                    },
                  ],
                });
                setNumber(result.number);
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : 'We could not save your request. Please try again.'
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              {product.name} · {option?.name} · $
              {(product.price + (option?.priceAdjustment ?? 0)).toFixed(2)} each
            </p>
            <p className="text-sm">
              Delivery and applicable tax are confirmed separately. Availability remains subject to
              supplier stock when we place your order.
            </p>
            {[
              ['name', 'Full name', 'text', 'name'],
              ['email', 'Email', 'email', 'email'],
              ['phone', 'Phone (optional)', 'tel', 'tel'],
              ['line1', 'Delivery street address', 'text', 'shipping address-line1'],
              ['line2', 'Apartment / suite (optional)', 'text', 'shipping address-line2'],
              ['city', 'City', 'text', 'shipping address-level2'],
              ['state', 'State (two-letter code)', 'text', 'shipping address-level1'],
              ['postalCode', 'ZIP code', 'text', 'shipping postal-code'],
            ].map(([name, label, type, autoComplete]) => (
              <label key={name} className="grid gap-1 text-sm">
                {label}
                <input
                  name={name}
                  type={type}
                  autoComplete={autoComplete}
                  required={!['phone', 'line2'].includes(name)}
                  maxLength={name === 'state' ? 2 : name === 'postalCode' ? 10 : 150}
                  className="border border-earth/20 rounded bg-white p-2"
                />
              </label>
            ))}
            <p className="text-sm">United States delivery</p>
            <label className="grid gap-1 text-sm">
              Quantity
              <input
                name="quantity"
                type="number"
                min="1"
                max="20"
                step="1"
                defaultValue="1"
                required
                className="border border-earth/20 rounded bg-white p-2"
              />
            </label>
            <label className="grid gap-1 text-sm">
              Notes (optional)
              <textarea
                name="notes"
                maxLength={2000}
                className="border border-earth/20 rounded bg-white p-2"
              />
            </label>
            <input
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="hidden"
            />
            {error && (
              <p role="alert" className="text-red-800">
                {error}
              </p>
            )}
            <button disabled={busy} className="bg-earth text-cream p-3 disabled:opacity-50">
              {busy ? 'Saving request…' : 'Send request · no payment yet'}
            </button>
          </form>
        )}
      </Modal>
    </>
  );
}
