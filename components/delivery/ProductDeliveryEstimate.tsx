import React, { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
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
export default function ProductDeliveryEstimate({ productId, variantId }: { productId: string; variantId?: string }) {
  const enabled = useQuery(api.dlvEstimates.enabled);
  const estimate = useMutation(api.dlvEstimates.estimate);
  const [zip, setZip] = useState('');
  const [qty, setQty] = useState(1);
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'done' | 'error'; text?: string; quote?: boolean; caveat?: string }>({ status: 'idle' });
  if (!enabled || !variantId) return null;
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{5}$/.test(zip)) return setState({ status: 'error', text: 'Enter a 5-digit ZIP code.' });
    setState({ status: 'loading' });
    try {
      const r = await estimate({ lines: [{ productId, variantId, packs: qty }], channel: 'retail', zip, visitorKey: visitorId() });
      setState(r.status === 'ok' && r.deliveryChargeMinor !== null ? { status: 'done', text: `${r.serviceName}: ${money(r.deliveryChargeMinor)}`, caveat: r.timingCaveat } : { status: 'done', quote: true, text: QUOTE_CTA });
    } catch (err) {
      setState({ status: 'error', text: customerMessage(err) });
    }
  };
  return (
    <form onSubmit={run} className="mt-3 text-sm text-earth/70" aria-label="Estimate delivery">
      <div className="flex gap-2 items-end">
        <label className="flex flex-col text-[10px] uppercase tracking-widest">
          ZIP code
          <input inputMode="numeric" autoComplete="postal-code" maxLength={5} value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, ''))} className="mt-1 border border-earth/20 px-2 py-1 w-24 text-sm normal-case tracking-normal" />
        </label>
        <label className="flex flex-col text-[10px] uppercase tracking-widest">
          Quantity
          <input type="number" min={1} max={20} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className="mt-1 border border-earth/20 px-2 py-1 w-16 text-sm" />
        </label>
        <button type="submit" className="border border-earth/30 px-3 py-1 text-[10px] uppercase tracking-widest hover:bg-earth hover:text-cream focus-visible:outline focus-visible:outline-2">
          {state.status === 'loading' ? 'Estimating…' : 'Estimate delivery'}
        </button>
      </div>
      <p aria-live="polite" className="mt-2">
        {state.status === 'done' && (
          <>
            <span className="text-earth">{state.text}</span>
            {state.caveat && <span className="block text-xs text-earth/50">{state.caveat} {ZIP_ESTIMATE_NOTE}</span>}
            {state.quote && <span className="block text-xs text-earth/50">We'll confirm delivery for this address before you pay.</span>}
          </>
        )}
        {state.status === 'error' && <span className="text-red-700">{state.text}</span>}
      </p>
    </form>
  );
}
