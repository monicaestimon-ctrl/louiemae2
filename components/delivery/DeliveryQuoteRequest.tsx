import React, { useRef, useState } from 'react';
import { useMutation } from 'convex/react';
import DeliveryQuoteStatus from './DeliveryQuoteStatus';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { customerMessage } from '../../lib/errors';

type Props = {
  lines: { productId: string; variantId: string; packs: number }[];
  postalCode: string;
  channel?: 'retail' | 'trade';
};
export default function DeliveryQuoteRequest({ lines, postalCode, channel = 'retail' }: Props) {
  const retry = useRef<{ payload: string; key: string } | null>(null);
  const request = useMutation(api.dlvOperations.requestQuote);

  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [phone, setPhone] = useState(''),
    [notes, setNotes] = useState(''),
    [consent, setConsent] = useState(false);
  const [saved, setSaved] = useState<{
    id: Id<'dlvQuoteRequests'>;
    guestCapability?: string;
  } | null>(null);
  if (saved) return <DeliveryQuoteStatus request={saved} />;
  return (
    <section className="space-y-2 text-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="underline"
      >
        Request a delivery quote
      </button>
      {open && (
        <div className="grid gap-2" role="group" aria-label="Delivery quote request">
          <label>
            Name
            <input
              aria-label="Quote contact name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={150}
              className="block border p-2 w-full"
            />
          </label>
          <label>
            Email
            <input
              aria-label="Quote contact email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
              className="block border p-2 w-full"
            />
          </label>
          <label>
            Phone (optional)
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={50}
              className="block border p-2 w-full"
            />
          </label>
          <label>
            Delivery access or special requests
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={4000}
              className="block border p-2 w-full"
            />
          </label>
          <p>Destination ZIP: {postalCode || 'Enter a ZIP above'}</p>
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />{' '}
            Contact me about this delivery request.
          </label>
          <button
            type="button"
            disabled={busy || !consent || !name.trim() || !email.trim()}
            className="border p-2 disabled:opacity-50"
            onClick={async () => {
              setBusy(true);
              setMessage('');
              try {
                const payload = JSON.stringify({
                  lines,
                  channel,
                  postalCode,
                  name,
                  email,
                  phone,
                  notes,
                  consent,
                });
                if (retry.current?.payload !== payload)
                  retry.current = {
                    payload,
                    key: Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), (b) =>
                      b.toString(16).padStart(2, '0')
                    ).join(''),
                  };
                setSaved(
                  await request({
                    requestKey: retry.current.key,
                    lines,
                    channel,
                    postalCode,
                    name,
                    email,
                    phone,
                    notes,
                    service: 'curbside',
                    consent,
                  })
                );
              } catch (e) {
                setMessage(customerMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Sending…' : 'Send delivery request'}
          </button>
          <p aria-live="polite">{message}</p>
        </div>
      )}
    </section>
  );
}
