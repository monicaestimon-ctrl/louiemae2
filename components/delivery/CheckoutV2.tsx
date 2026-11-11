import './forms.css';
import { useFormValidation } from '../forms/useFormValidation';
import { ValidationSummary } from '../forms/ValidationSummary';
import { useDeliveryRequest } from './useDeliveryRequest';
import React, { useMemo, useState, useRef, useEffect, useId } from 'react';
import { useAuthToken } from '@convex-dev/auth/react';
import { useQuery } from 'convex/react';
import { Loader2 } from 'lucide-react';
import { api } from '../../convex/_generated/api';
import { useCart } from '../../contexts/CartContext';
import { visitorId } from '../../lib/partnerLink';
import { customerMessage } from '../../lib/errors';
import { QUOTE_CTA, SPLIT_MAY, SPLIT_WILL } from '../../lib/customerCopy';
import { STANDARD_ACCESS } from '../../lib/delivery/destination';
import { rememberCheckout } from '../../lib/delivery/checkoutReturn';
import DeliveryAccessFields from './DeliveryAccessFields';
import DeliveryQuoteRequest from './DeliveryQuoteRequest';

const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;
const STATES =
  'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(
    ' '
  );

type Est = {
  estimateId: string;
  guestCapability?: string;
  expiresAt: number;
  status: string;
  deliveryChargeMinor: number | null;
  merchandiseMinor: number;
  creditMinor?: number;
  taxMinor: number | null;
  totalMinor: number | null;
  splitKnown: boolean;
  timingCaveat: string;
  serviceName: string;
  serviceDetails: string[];
};

/**
 * v2 checkout (spec S18–S19, S21): confirm the full address, then show merchandise, delivery,
 * tax and total — plus the split-shipment disclosure — before payment. Any change requires a new
 * estimate; a changed total must be accepted before paying.
 */
type CheckoutLine = { productId: string; variantId: string; packs: number };
export default function CheckoutV2() {
  const { items } = useCart();
  const lines = useMemo(
    () =>
      items.map((i) => ({
        productId: i.product.id,
        variantId: i.selectedVariant?.id ?? i.product.variants?.[0]?.id ?? '',
        packs: i.quantity,
      })),
    [items]
  );
  return <DeliveryCheckout lines={lines} />;
}
export function DeliveryCheckout({
  lines,
  channel = 'retail',
}: {
  lines: CheckoutLine[];
  channel?: 'retail' | 'trade';
}) {
  const authToken = useAuthToken();
  const formId = useId();
  const feedback = useFormValidation<
    | 'recipientName'
    | 'phone'
    | 'line1'
    | 'line2'
    | 'city'
    | 'state'
    | 'postalCode'
    | 'country'
    | 'email'
    | '_form'
  >();
  const paymentMessageRef = useRef<globalThis.HTMLParagraphElement>(null);
  const requestSequence = useRef(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const estimate = useDeliveryRequest('estimate');
  const [address, setAddress] = useState({
    recipientName: '',
    phone: '',
    line1: '',
    line2: '',
    city: '',
    state: 'CA',
    postalCode: '',
    country: 'US',
  });
  const [access, setAccess] = useState(STANDARD_ACCESS);
  const [email, setEmail] = useState('');
  // Store credit (v2): comes off merchandise only, never delivery or tax.
  const credit = useQuery(api.ldgCredits.myCreditV2);
  const [useCredit, setUseCredit] = useState(false);
  const [est, setEst] = useState<Est | null>(null);
  const [accepted, setAccepted] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (msg) paymentMessageRef.current?.focus();
  }, [msg]);

  const key = useMemo(
    () =>
      JSON.stringify({
        lines,
        channel,
        address,
        access,
        useCredit,
        email,
        authenticated: !!authToken,
      }),
    [lines, channel, address, access, useCredit, email, authToken]
  );
  const [estKey, setEstKey] = useState('');
  const stale = !!est && (estKey !== key || est.expiresAt <= now);
  useEffect(() => {
    requestSequence.current++;
    setBusy(false);
  }, [key]);

  const review = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Partial<
      Record<
        'recipientName' | 'phone' | 'line1' | 'city' | 'state' | 'postalCode' | 'email',
        string
      >
    > = {};
    for (const key of ['recipientName', 'phone', 'line1', 'city'] as const) {
      if (!address[key].trim()) errors[key] = 'This field is required.';
    }
    if (!STATES.includes(address.state)) errors.state = 'Choose a U.S. state.';
    if (!/^\d{5}(-\d{4})?$/.test(address.postalCode))
      errors.postalCode = 'Enter a five-digit ZIP or ZIP+4.';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = 'Enter a valid email address.';
    if (Object.keys(errors).length) {
      feedback.report(errors);
      return;
    }
    feedback.reset();
    setBusy(true);
    setMsg(null);
    const seq = ++requestSequence.current;
    try {
      const addr = { ...address, access, line2: address.line2 || undefined };
      const r = (await estimate({
        lines,
        channel,
        zip: address.postalCode.slice(0, 5),
        address: addr,
        visitorKey: visitorId(),
        useCredit,
      })) as Est;
      if (seq !== requestSequence.current) return;
      setEst(r);
      setEstKey(key);
      setAccepted(r.totalMinor);
    } catch (err) {
      if (seq === requestSequence.current) feedback.report({ _form: customerMessage(err) });
    } finally {
      if (seq === requestSequence.current) setBusy(false);
    }
  };

  const pay = async () => {
    if (!est || stale || est.totalMinor === null) return;
    setBusy(true);
    setMsg(null);
    try {
      const site = String(import.meta.env.VITE_CONVEX_URL || '').replace(
        '.convex.cloud',
        '.convex.site'
      );
      const res = await fetch(`${site}/v2/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          idempotencyKey: `${est.estimateId}-${accepted}`.replace(/[^\w-]/g, ''),
          estimateId: est.estimateId,
          guestCapability: est.guestCapability,
          lines,
          address: { ...address, access, line2: address.line2 || undefined },
          service: 'curbside',
          acceptTotalMinor: accepted,
          email,
          visitorKey: visitorId(),
          useCredit,
        }),
      });
      const body = await res.json();
      if (res.ok && body.url) {
        if (body.sessionId)
          rememberCheckout(
            body.sessionId,
            est.guestCapability,
            channel === 'retail' ? lines : undefined
          );
        window.location.href = body.url;
        return;
      }
      if (body.code === 'PRICE_CHANGED') {
        setEst(null);
        setAccepted(null);
        setMsg(
          'Your prices or delivery details changed. Review delivery and total again before paying.'
        );
      } else setMsg(body.error || 'Checkout could not start.');
    } catch {
      setMsg('Checkout could not start. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const fieldLabels = {
    recipientName: 'Recipient name',
    phone: 'Delivery contact phone',
    line1: 'Street address',
    line2: 'Apartment, suite',
    city: 'City',
    state: 'State',
    postalCode: 'ZIP code',
    country: 'Country',
    email: 'Email',
  };
  const field = (
    k: keyof typeof address,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {}
  ) => (
    <div className="delivery-field">
      <label htmlFor={`${formId}-${k}`}>{label}</label>
      <input
        id={`${formId}-${k}`}
        required={k !== 'line2'}
        value={address[k]}
        aria-invalid={Boolean(feedback.errors[k])}
        aria-describedby={feedback.errors[k] ? `${formId}-${k}-error` : undefined}
        onChange={(e) => {
          setAddress({ ...address, [k]: e.target.value });
          feedback.clear(k);
          feedback.clear('_form');
        }}
        {...props}
      />
      {feedback.errors[k] && (
        <p id={`${formId}-${k}-error`} className="delivery-error">
          {feedback.errors[k]}
        </p>
      )}
    </div>
  );

  return (
    <div className="delivery-ui delivery-stack">
      <form
        onSubmit={review}
        noValidate
        className="delivery-address-grid"
        aria-label="Delivery address"
        aria-busy={busy}
      >
        <div className="delivery-span">
          <ValidationSummary
            summaryRef={feedback.summaryRef}
            entries={Object.entries(feedback.errors).map(([key, message]) =>
              key === '_form'
                ? { message }
                : {
                    fieldId: `${formId}-${key}`,
                    label: fieldLabels[key as keyof typeof fieldLabels],
                    message,
                  }
            )}
          />
        </div>
        <div className="delivery-span">
          {field('recipientName', 'Recipient name', { autoComplete: 'name', maxLength: 150 })}
        </div>
        <DeliveryAccessFields value={access} onChange={setAccess} />
        <div className="delivery-span">
          {field('line1', 'Street address', { autoComplete: 'address-line1' })}
        </div>
        <div className="delivery-span">
          {field('line2', 'Apartment, suite (optional)', { autoComplete: 'address-line2' })}
        </div>
        {field('city', 'City', { autoComplete: 'address-level2' })}
        <div className="delivery-field">
          <label htmlFor={`${formId}-state`}>State</label>
          <select
            id={`${formId}-state`}
            required
            aria-invalid={Boolean(feedback.errors.state)}
            aria-describedby={feedback.errors.state ? `${formId}-state-error` : undefined}
            value={address.state}
            onChange={(e) => {
              setAddress({ ...address, state: e.target.value });
              feedback.clear('state');
              feedback.clear('_form');
            }}
            className="mt-1 border border-earth/20 px-2 py-1 text-sm"
          >
            {STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          {feedback.errors.state && (
            <span id={`${formId}-state-error`} className="delivery-error">
              {feedback.errors.state}
            </span>
          )}
        </div>
        {field('phone', 'Delivery contact phone', {
          type: 'tel',
          autoComplete: 'tel',
          maxLength: 25,
        })}
        {field('postalCode', 'ZIP code', {
          inputMode: 'numeric',
          autoComplete: 'postal-code',
          pattern: '\\d{5}(-\\d{4})?',
          maxLength: 10,
        })}
        <div className="delivery-field">
          <label htmlFor={`${formId}-email`}>Email</label>
          <input
            id={`${formId}-email`}
            aria-invalid={Boolean(feedback.errors.email)}
            aria-describedby={feedback.errors.email ? `${formId}-email-error` : undefined}
            type="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              feedback.clear('email');
              feedback.clear('_form');
            }}
            autoComplete="email"
            className="mt-1 border border-earth/20 px-2 py-1 text-sm normal-case tracking-normal"
          />
          {feedback.errors.email && (
            <span id={`${formId}-email-error`} className="delivery-error">
              {feedback.errors.email}
            </span>
          )}
        </div>
        {credit && credit.availableMinor > 0 && (
          <label className="delivery-span delivery-check">
            <input
              type="checkbox"
              checked={useCredit}
              onChange={(e) => setUseCredit(e.target.checked)}
            />
            Use my {money(credit.availableMinor)} store credit (merchandise only, not delivery or
            tax)
          </label>
        )}
        <button type="submit" disabled={busy} className="delivery-span delivery-action">
          {busy && !est ? 'Checking delivery…' : 'Review delivery and total'}
        </button>
      </form>

      <div aria-live="polite">
        {est && !stale && est.status === 'ok' && est.totalMinor !== null && (
          <div className="text-xs text-earth space-y-1 border-t border-earth/10 pt-3">
            <div className="delivery-total-row">
              <span>Merchandise</span>
              <span>{money(est.merchandiseMinor)}</span>
            </div>
            {!!est.creditMinor && (
              <div className="delivery-total-row">
                <span>Store credit</span>
                <span>−{money(est.creditMinor)}</span>
              </div>
            )}
            <div className="delivery-total-row">
              <span>{est.serviceName}</span>
              <span>{money(est.deliveryChargeMinor ?? 0)}</span>
            </div>
            <div className="delivery-total-row">
              <span>Estimated tax</span>
              <span>{money(est.taxMinor ?? 0)}</span>
            </div>
            <div className="delivery-total-row font-serif text-base">
              <span>Total</span>
              <span>{money(est.totalMinor)}</span>
            </div>
            <p className="delivery-note">{est.splitKnown ? SPLIT_WILL : SPLIT_MAY}</p>
            <ul>
              {est.serviceDetails.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
            <p className="delivery-note">{est.timingCaveat}</p>
          </div>
        )}
        {est && !stale && est.status !== 'ok' && (
          <p className="text-xs text-earth">
            {QUOTE_CTA}: this address or item needs a delivery quote before you can pay. Contact us
            and we'll confirm it.
          </p>
        )}
        {est && !stale && (est.status !== 'ok' || est.totalMinor === null) && (
          <>
            <p>We need to confirm delivery and tax before payment.</p>
            <DeliveryQuoteRequest
              key={estKey}
              lines={lines}
              postalCode={address.postalCode}
              channel={channel}
              address={{ ...address, access }}
              initialEmail={email}
            />
          </>
        )}
        {stale && (
          <p className="delivery-note">
            Your cart or address changed. Review delivery and total again.
          </p>
        )}
        {msg && (
          <p ref={paymentMessageRef} tabIndex={-1} role="alert" className="delivery-error-summary">
            {msg}
          </p>
        )}
      </div>

      {est && !stale && est.status === 'ok' && est.totalMinor !== null && (
        <button
          aria-label={busy ? 'Starting checkout…' : undefined}
          aria-busy={busy}
          onClick={accepted === null ? () => setAccepted(est.totalMinor) : pay}
          disabled={busy}
          className="delivery-action"
        >
          {busy ? (
            <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
          ) : accepted === null ? (
            `Accept new total ${money(est.totalMinor)}`
          ) : (
            `Pay ${money(est.totalMinor)}`
          )}
        </button>
      )}
    </div>
  );
}
