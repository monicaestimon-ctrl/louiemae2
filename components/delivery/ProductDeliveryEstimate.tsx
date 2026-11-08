import { useDeliveryRequest } from './useDeliveryRequest';
import React, { useState, useRef, useEffect } from 'react';
import DeliveryQuoteRequest from './DeliveryQuoteRequest';
import { useQuery } from 'convex/react';
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
}: {
  productId: string;
  variantId?: string;
  piecesPerPack?: number;
  minimumPacks?: number;
  incrementPacks?: number;
  channel?: 'retail' | 'trade';
}) {
  const enabled = useQuery(api.dlvEstimates.enabled);
  const profile = useQuery(
    api.dlvEstimates.productProfile,
    enabled && variantId ? { productId, variantId, channel } : 'skip'
  );
  piecesPerPack = profile?.piecesPerPack ?? piecesPerPack;
  minimumPacks = profile?.minimumPacks ?? minimumPacks;
  incrementPacks = profile?.incrementPacks ?? incrementPacks;
  if (!enabled || !variantId) return null;
  if (!profile) return <p className="text-sm">Checking delivery availability…</p>;
  return (
    <DeliveryForm
      key={`${productId}:${variantId}:${piecesPerPack}:${minimumPacks}:${incrementPacks}:${channel}`}
      {...{ productId, variantId, piecesPerPack, minimumPacks, incrementPacks, channel }}
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
}: {
  productId: string;
  variantId: string;
  piecesPerPack: number;
  minimumPacks: number;
  incrementPacks: number;
  channel: 'retail' | 'trade';
}) {
  const estimate = useDeliveryRequest('estimate');
  const [zip, setZip] = useState('');
  const [qty, setQty] = useState(minimumPacks);
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
    if (!/^\d{5}$/.test(zip))
      return setState({ status: 'error', text: 'Enter a 5-digit ZIP code.' });
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
      setState({ status: 'error', text: customerMessage(err) });
    }
  };
  return (
    <form onSubmit={run} className="mt-3 text-sm text-earth/70" aria-label="Estimate delivery">
      <div className="flex flex-wrap gap-2 items-end">
        <label className="flex flex-col text-[10px] uppercase tracking-widest">
          ZIP code
          <input
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={5}
            value={zip}
            onChange={(e) => {
              sequence.current++;
              setState({ status: 'idle' });
              setZip(e.target.value.replace(/\D/g, ''));
            }}
            className="mt-1 border border-earth/20 px-2 py-1 w-24 text-sm normal-case tracking-normal"
          />
        </label>
        <label className="flex flex-col text-[10px] uppercase tracking-widest">
          Packs{piecesPerPack > 1 ? ` (${piecesPerPack} pieces each)` : ''}
          <input
            type="number"
            min={minimumPacks}
            step={incrementPacks}
            value={qty}
            onChange={(e) => {
              sequence.current++;
              setState({ status: 'idle' });
              setQty(Number(e.target.value));
            }}
            className="mt-1 border border-earth/20 px-2 py-1 w-16 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={state.status === 'loading'}
          className="border border-earth/30 px-3 py-1 text-[10px] uppercase tracking-widest hover:bg-earth hover:text-cream focus-visible:outline focus-visible:outline-2"
        >
          {state.status === 'loading' ? 'Estimating…' : 'Estimate delivery'}
        </button>
      </div>
      <p aria-live="polite" className="mt-2">
        {state.status === 'done' && (
          <>
            <span className="text-earth">{state.text}</span>
            {state.details?.map((detail) => (
              <span className="block text-xs" key={detail}>
                {detail}
              </span>
            ))}
            {state.caveat && (
              <span className="block text-xs text-earth/50">
                {state.caveat} {ZIP_ESTIMATE_NOTE}
              </span>
            )}
            {state.quote && (
              <span className="block text-xs text-earth/50">
                We'll confirm delivery for this address before you pay.
              </span>
            )}
          </>
        )}
        {state.status === 'error' && <span className="text-red-700">{state.text}</span>}
      </p>
      {state.quote && (
        <DeliveryQuoteRequest
          lines={[{ productId, variantId, packs: qty }]}
          postalCode={zip}
          channel={channel}
        />
      )}
    </form>
  );
}
