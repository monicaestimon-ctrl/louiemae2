import './forms.css';
import { useDeliveryRequest } from './useDeliveryRequest';
import React, { useEffect, useId, useRef, useState } from 'react';
import DeliveryQuoteStatus from './DeliveryQuoteStatus';
import type { Id } from '../../convex/_generated/dataModel';
import { customerMessage } from '../../lib/errors';
import type { AddressIn } from '../../lib/delivery/destination';
import { useFormValidation } from '../forms/useFormValidation';
import { ValidationSummary } from '../forms/ValidationSummary';

type Props = {
  lines: { productId: string; variantId: string; packs: number }[];
  postalCode: string;
  channel?: 'retail' | 'trade';
  address?: AddressIn;
  initialEmail?: string;
};
export default function DeliveryQuoteRequest({
  lines,
  postalCode,
  channel = 'retail',
  address,
  initialEmail,
}: Props) {
  const retry = useRef<{ payload: string; key: string } | null>(null);
  const request = useDeliveryRequest('quote');
  const id = useId();
  const feedback = useFormValidation<'name' | 'email' | 'consent' | 'zip' | '_form'>();
  const savedRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const [name, setName] = useState(address?.recipientName ?? ''),
    [email, setEmail] = useState(initialEmail ?? ''),
    [phone, setPhone] = useState(address?.phone ?? ''),
    [notes, setNotes] = useState(''),
    [consent, setConsent] = useState(false);
  const [saved, setSaved] = useState<{
    id: Id<'dlvQuoteRequests'>;
    guestCapability?: string;
  } | null>(null);
  useEffect(() => {
    if (saved) savedRef.current?.focus();
  }, [saved]);
  const validZip = /^\d{5}(-\d{4})?$/.test(postalCode.trim());
  const disabledReason = !validZip
    ? 'Enter a destination ZIP above before sending.'
    : !name.trim() || !email.trim() || !consent
      ? 'Enter your name and email, then allow us to contact you about this request.'
      : '';
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const errors: Partial<Record<'name' | 'email' | 'consent' | 'zip', string>> = {};
    if (!name.trim()) errors.name = 'Enter your name.';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = 'Enter a valid email address.';
    if (!consent) errors.consent = 'Allow us to contact you about this delivery request.';
    if (!validZip) errors.zip = 'Enter a valid destination ZIP above.';
    if (Object.keys(errors).length) {
      feedback.report(errors);
      return;
    }
    feedback.reset();
    setBusy(true);
    try {
      const payload = JSON.stringify({
        lines,
        channel,
        postalCode,
        address,
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
          address,
          name,
          email,
          phone,
          notes,
          service:
            address?.access?.requestedService && address.access.requestedService !== 'standard'
              ? address.access.requestedService
              : 'curbside',
          consent,
        })
      );
    } catch (error) {
      feedback.report({ _form: customerMessage(error) });
    } finally {
      setBusy(false);
    }
  };
  if (saved)
    return (
      <div
        className="delivery-ui"
        ref={savedRef}
        tabIndex={-1}
        role="region"
        aria-label="Delivery request saved"
      >
        <DeliveryQuoteStatus request={saved} />
      </div>
    );
  return (
    <section className="delivery-ui delivery-stack">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={`${id}-form`}
        className="underline"
      >
        Request a delivery quote
      </button>
      {open && (
        <form
          id={`${id}-form`}
          onSubmit={submit}
          noValidate
          className="delivery-stack"
          aria-label="Delivery quote request"
        >
          <ValidationSummary
            summaryRef={feedback.summaryRef}
            entries={[
              { fieldId: `${id}-name`, label: 'Name', message: feedback.errors.name },
              { fieldId: `${id}-email`, label: 'Email', message: feedback.errors.email },
              {
                fieldId: `${id}-consent`,
                label: 'Contact permission',
                message: feedback.errors.consent,
              },
              { message: feedback.errors.zip },
              { message: feedback.errors._form },
            ]}
          />
          <div className="delivery-field">
            <label htmlFor={`${id}-name`}>Name</label>
            <input
              id={`${id}-name`}
              aria-label="Quote contact name"
              autoComplete="name"
              required
              value={name}
              maxLength={150}
              aria-invalid={Boolean(feedback.errors.name)}
              aria-describedby={feedback.errors.name ? `${id}-name-error` : undefined}
              onChange={(e) => {
                setName(e.target.value);
                feedback.clear('name');
                feedback.clear('_form');
              }}
            />
            {feedback.errors.name && (
              <p id={`${id}-name-error`} className="delivery-error">
                {feedback.errors.name}
              </p>
            )}
          </div>
          <div className="delivery-field">
            <label htmlFor={`${id}-email`}>Email</label>
            <input
              id={`${id}-email`}
              aria-label="Quote contact email"
              type="email"
              autoComplete="email"
              required
              value={email}
              maxLength={254}
              aria-invalid={Boolean(feedback.errors.email)}
              aria-describedby={feedback.errors.email ? `${id}-email-error` : undefined}
              onChange={(e) => {
                setEmail(e.target.value);
                feedback.clear('email');
                feedback.clear('_form');
              }}
            />
            {feedback.errors.email && (
              <p id={`${id}-email-error`} className="delivery-error">
                {feedback.errors.email}
              </p>
            )}
          </div>
          <label className="delivery-field">
            Phone (optional)
            <input
              type="tel"
              autoComplete="tel"
              value={phone}
              maxLength={50}
              onChange={(e) => {
                setPhone(e.target.value);
                feedback.clear('_form');
              }}
            />
          </label>
          <label className="delivery-field">
            Delivery access or special requests
            <textarea
              value={notes}
              maxLength={4000}
              onChange={(e) => {
                setNotes(e.target.value);
                feedback.clear('_form');
              }}
            />
          </label>
          <p>Destination ZIP: {postalCode || 'Enter a ZIP above'}</p>
          <label className="delivery-check">
            <input
              id={`${id}-consent`}
              type="checkbox"
              required
              checked={consent}
              aria-invalid={Boolean(feedback.errors.consent)}
              aria-describedby={feedback.errors.consent ? `${id}-consent-error` : undefined}
              onChange={(e) => {
                setConsent(e.target.checked);
                feedback.clear('consent');
                feedback.clear('_form');
              }}
            />
            Contact me about this delivery request.
          </label>
          {feedback.errors.consent && (
            <p id={`${id}-consent-error`} className="delivery-error">
              {feedback.errors.consent}
            </p>
          )}
          {disabledReason && (
            <p id={`${id}-submit-help`} className="delivery-note">
              {disabledReason}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || Boolean(disabledReason)}
            aria-describedby={disabledReason ? `${id}-submit-help` : undefined}
            className="delivery-action"
          >
            {busy ? 'Sending…' : 'Send delivery request'}
          </button>
        </form>
      )}
    </section>
  );
}
