import './forms.css';
import { useFormValidation } from '../forms/useFormValidation';
import { ValidationSummary } from '../forms/ValidationSummary';
import { useDeliveryRequest } from './useDeliveryRequest';
import React, { useState, useRef, useEffect, useId } from 'react';
import DeliveryQuoteRequest from './DeliveryQuoteRequest';
import { useRecoverableQuery } from '../../contexts/useRecoverableQuery';
import { api } from '../../convex/_generated/api';
import { visitorId } from '../../lib/partnerLink';
import { customerMessage } from '../../lib/errors';
import { QUOTE_CTA, ZIP_ESTIMATE_NOTE } from '../../lib/customerCopy';

const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;

/**
 * Product-page delivery estimate (spec S18, v2 §9): ZIP and quantity, then one estimated charge or
 * "Request a delivery quote", the service name and a short timing caveat. No supplier costs,
 * allowance formulas or margin information are ever shown.
 */
export default function ProductDeliveryEstimate({
  productId,
  variantId,
  piecesPerPack = 1,
  minimumPacks = 1,
  incrementPacks = 1,
  channel = 'retail',
  selectedPacks,
  disabledMessage,
}: {
  productId: string;
  variantId?: string;
  piecesPerPack?: number;
  minimumPacks?: number;
  incrementPacks?: number;
  channel?: 'retail' | 'trade';
  selectedPacks?: number;
  disabledMessage?: string;
}) {
  const availability = useRecoverableQuery(api.dlvEstimates.enabled, variantId ? {} : 'skip');
  const enabled = availability.data;
  const profileQuery = useRecoverableQuery(
    api.dlvEstimates.productProfile,
    enabled && variantId ? { productId, variantId, channel } : 'skip'
  );
  const profile = profileQuery.data;
  piecesPerPack = profile?.piecesPerPack ?? piecesPerPack;
  minimumPacks = profile?.minimumPacks ?? minimumPacks;
  incrementPacks = profile?.incrementPacks ?? incrementPacks;
  if (variantId && (availability.status === 'unavailable' || profileQuery.status === 'unavailable'))
    return (
      <div role="status" className="text-sm text-earth">
        <p>Delivery availability could not be verified. Please try again.</p>
        <button
          type="button"
          className="min-h-11 underline"
          onClick={() => {
            availability.retry();
            profileQuery.retry();
          }}
        >
          Retry delivery availability
        </button>
      </div>
    );
  if (availability.status === 'loading')
    return (
      <p role="status" className="text-sm">
        Checking delivery availability…
      </p>
    );
  if (!enabled || !variantId) return disabledMessage ? <p>{disabledMessage}</p> : null;
  if (profile === undefined) return <p className="text-sm">Checking delivery availability…</p>;
  if (profile === null)
    return <p className="text-sm">This item is currently unavailable for delivery estimates.</p>;
  if ('requiresProjectQuote' in profile && profile.requiresProjectQuote)
    return (
      <p className="text-sm">
        Add this item to your project to request confirmed delivery pricing.
      </p>
    );
  return (
    <DeliveryForm
      key={`${productId}:${variantId}:${piecesPerPack}:${minimumPacks}:${incrementPacks}:${channel}:${selectedPacks ?? 'editable'}`}
      {...{
        productId,
        variantId,
        piecesPerPack,
        minimumPacks,
        incrementPacks,
        channel,
        selectedPacks,
      }}
    />
  );
}
function DeliveryForm({
  productId,
  variantId,
  piecesPerPack,
  minimumPacks,
  incrementPacks,
  channel,
  selectedPacks,
}: {
  productId: string;
  variantId: string;
  piecesPerPack: number;
  minimumPacks: number;
  incrementPacks: number;
  channel: 'retail' | 'trade';
  selectedPacks?: number;
}) {
  const estimate = useDeliveryRequest('estimate');
  const id = useId();
  const feedback = useFormValidation<'zip' | 'qty' | '_form'>();
  const [zip, setZip] = useState('');
  const [qty, setQty] = useState(selectedPacks ?? minimumPacks);
  const sequence = useRef(0);
  const [state, setState] = useState<{
    status: 'idle' | 'loading' | 'done' | 'error';
    text?: string;
    quote?: boolean;
    caveat?: string;
    details?: string[];
    expiresAt?: number;
  }>({ status: 'idle' });
  useEffect(() => {
    if (!state.expiresAt) return;
    const timer = setTimeout(
      () => setState({ status: 'error', text: 'This estimate expired. Check delivery again.' }),
      Math.max(0, state.expiresAt - Date.now())
    );
    return () => clearTimeout(timer);
  }, [state.expiresAt]);
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: { zip?: string; qty?: string } = {};
    if (!/^\d{5}$/.test(zip)) errors.zip = 'Enter a 5-digit ZIP code.';
    if (
      !Number.isSafeInteger(qty) ||
      qty < minimumPacks ||
      (qty - minimumPacks) % incrementPacks !== 0
    )
      errors.qty = `Choose at least ${minimumPacks} packs, in increments of ${incrementPacks}.`;
    if (Object.keys(errors).length) {
      feedback.report(errors);
      return;
    }
    feedback.reset();
    setState({ status: 'loading' });
    const requestId = ++sequence.current;
    try {
      const r = await estimate({
        lines: [{ productId, variantId, packs: qty }],
        channel,
        zip,
        visitorKey: visitorId(),
      });
      if (requestId !== sequence.current) return;
      setState(
        r.status === 'ok' && r.deliveryChargeMinor !== null
          ? {
              status: 'done',
              text: `${r.serviceName}: ${money(r.deliveryChargeMinor)}`,
              caveat: r.timingCaveat,
              details: r.serviceDetails,
              expiresAt: r.expiresAt,
            }
          : { status: 'done', quote: true, text: QUOTE_CTA }
      );
    } catch (err) {
      if (requestId !== sequence.current) return;
      setState({ status: 'idle' });
      feedback.report({ _form: customerMessage(err) });
    }
  };
  return (
    <div className="delivery-ui">
      <form onSubmit={run} noValidate aria-label="Estimate delivery" className="delivery-stack">
        <ValidationSummary
          summaryRef={feedback.summaryRef}
          entries={[
            { fieldId: `${id}-zip`, label: 'ZIP code', message: feedback.errors.zip },
            { fieldId: `${id}-qty`, label: 'Packs', message: feedback.errors.qty },
            { message: feedback.errors._form },
          ]}
        />
        <div className="delivery-row">
          <div className="delivery-field">
            <label htmlFor={`${id}-zip`}>ZIP code</label>
            <input
              id={`${id}-zip`}
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={5}
              required
              value={zip}
              aria-invalid={Boolean(feedback.errors.zip)}
              aria-describedby={`${id}-zip-help${feedback.errors.zip ? ` ${id}-zip-error` : ''}`}
              onChange={(e) => {
                sequence.current++;
                setState({ status: 'idle' });
                feedback.clear('zip');
                feedback.clear('_form');
                setZip(e.target.value.replace(/\D/g, ''));
              }}
            />
            <p id={`${id}-zip-help`} className="delivery-note">
              Five-digit U.S. ZIP code.
            </p>
            {feedback.errors.zip && (
              <p id={`${id}-zip-error`} className="delivery-error">
                {feedback.errors.zip}
              </p>
            )}
          </div>
          <div className="delivery-field">
            <label htmlFor={`${id}-qty`}>
              Packs{piecesPerPack > 1 ? ` (${piecesPerPack} pieces each)` : ''}
            </label>
            <input
              id={`${id}-qty`}
              type="number"
              min={minimumPacks}
              step={incrementPacks}
              required
              value={qty}
              readOnly={selectedPacks !== undefined}
              aria-invalid={Boolean(feedback.errors.qty)}
              aria-describedby={`${id}-qty-help${feedback.errors.qty ? ` ${id}-qty-error` : ''}`}
              onChange={(e) => {
                sequence.current++;
                setState({ status: 'idle' });
                feedback.clear('qty');
                feedback.clear('_form');
                setQty(Number(e.target.value));
              }}
            />
            <p id={`${id}-qty-help`} className="delivery-note">
              Minimum {minimumPacks}; increments of {incrementPacks}.
            </p>
            {feedback.errors.qty && (
              <p id={`${id}-qty-error`} className="delivery-error">
                {feedback.errors.qty}
              </p>
            )}
          </div>
          <button type="submit" disabled={state.status === 'loading'} className="delivery-action">
            {state.status === 'loading' ? 'Estimating…' : 'Estimate delivery'}
          </button>
        </div>
        <div aria-live="polite" aria-atomic="true">
          {state.status === 'done' && (
            <>
              <p>{state.text}</p>
              {state.details?.map((detail) => (
                <p className="delivery-note" key={detail}>
                  {detail}
                </p>
              ))}
              {state.caveat && (
                <p className="delivery-note">
                  {state.caveat} {ZIP_ESTIMATE_NOTE}
                </p>
              )}
              {state.quote && (
                <p className="delivery-note">
                  We'll confirm delivery for this address before you pay.
                </p>
              )}
            </>
          )}
          {state.status === 'error' && <p className="delivery-error">{state.text}</p>}
        </div>
      </form>
      {state.quote && (
        <DeliveryQuoteRequest
          lines={[{ productId, variantId, packs: qty }]}
          postalCode={zip}
          channel={channel}
        />
      )}
    </div>
  );
}
