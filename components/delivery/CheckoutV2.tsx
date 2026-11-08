import React, { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Loader2 } from 'lucide-react';
import { api } from '../../convex/_generated/api';
import { useCart } from '../../contexts/CartContext';
import { visitorId } from '../../lib/partnerLink';
import { customerMessage } from '../../lib/errors';
import { QUOTE_CTA, SPLIT_MAY, SPLIT_WILL } from '../../lib/customerCopy';

const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;
const STATES = 'AL AZ AR CA CO CT DE DC FL GA ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');

type Est = { estimateId: string; status: string; deliveryChargeMinor: number | null; merchandiseMinor: number; creditMinor?: number; taxMinor: number | null; totalMinor: number | null; splitKnown: boolean; timingCaveat: string };

/**
 * v2 checkout (spec S18–S19, S21): confirm the full address, then show merchandise, delivery,
 * tax and total — plus the split-shipment disclosure — before payment. Any change requires a new
 * estimate; a changed total must be accepted before paying.
 */
export default function CheckoutV2() {
  const { items } = useCart();
  const estimate = useMutation(api.dlvEstimates.estimate);
  const [address, setAddress] = useState({ line1: '', line2: '', city: '', state: 'CA', postalCode: '', country: 'US' });
  const [email, setEmail] = useState('');
  // Store credit (v2): comes off merchandise only, never delivery or tax.
  const credit = useQuery(api.ldgCredits.myCreditV2);
  const [useCredit, setUseCredit] = useState(false);
  const [est, setEst] = useState<Est | null>(null);
  const [accepted, setAccepted] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const lines = useMemo(() => items.map((i) => ({ productId: i.product.id, variantId: i.selectedVariant?.id ?? i.product.variants?.[0]?.id ?? '', packs: i.quantity })), [items]);
  const key = useMemo(() => JSON.stringify({ lines, address, useCredit }), [lines, address, useCredit]);
  const [estKey, setEstKey] = useState('');
  const stale = !!est && estKey !== key;

  const review = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const addr = { ...address, line2: address.line2 || undefined };
      const r = (await estimate({ lines, channel: 'retail', zip: address.postalCode.slice(0, 5), address: addr, visitorKey: visitorId(), useCredit })) as Est;
      setEst(r);
      setEstKey(key);
      setAccepted(r.totalMinor);
    } catch (err) {
      setMsg(customerMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    if (!est || stale || est.totalMinor === null) return;
    setBusy(true);
    setMsg(null);
    try {
      const site = String(import.meta.env.VITE_CONVEX_URL || '').replace('.convex.cloud', '.convex.site');
      const res = await fetch(`${site}/v2/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: `${est.estimateId}-${accepted}`.replace(/[^\w-]/g, ''), estimateId: est.estimateId, lines, address: { ...address, line2: address.line2 || undefined }, service: 'curbside', acceptTotalMinor: accepted, email, visitorKey: visitorId(), useCredit }),
      });
      const body = await res.json();
      if (res.ok && body.url) {
        window.location.href = body.url;
        return;
      }
      if (body.code === 'PRICE_CHANGED') {
        setEst({ ...est, deliveryChargeMinor: body.deliveryMinor, taxMinor: body.taxMinor, totalMinor: body.totalMinor });
        setAccepted(null);
        setMsg('Your total changed. Please review the new total, then confirm to pay.');
      } else setMsg(body.error || 'Checkout could not start.');
    } catch {
      setMsg('Checkout could not start. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const field = (k: keyof typeof address, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="flex flex-col text-[10px] uppercase tracking-widest text-earth/60">
      {label}
      <input required={k !== 'line2'} value={address[k]} onChange={(e) => setAddress({ ...address, [k]: e.target.value })} className="mt-1 border border-earth/20 px-2 py-1 text-sm normal-case tracking-normal text-earth" {...props} />
    </label>
  );

  return (
    <div className="space-y-3">
      <form onSubmit={review} className="grid grid-cols-2 gap-2" aria-label="Delivery address">
        <div className="col-span-2">{field('line1', 'Street address', { autoComplete: 'address-line1' })}</div>
        <div className="col-span-2">{field('line2', 'Apartment, suite (optional)', { autoComplete: 'address-line2' })}</div>
        {field('city', 'City', { autoComplete: 'address-level2' })}
        <label className="flex flex-col text-[10px] uppercase tracking-widest text-earth/60">
          State
          <select value={address.state} onChange={(e) => setAddress({ ...address, state: e.target.value })} className="mt-1 border border-earth/20 px-2 py-1 text-sm">
            {STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        {field('postalCode', 'ZIP code', { inputMode: 'numeric', autoComplete: 'postal-code', pattern: '\\d{5}' })}
        <label className="flex flex-col text-[10px] uppercase tracking-widest text-earth/60">
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="mt-1 border border-earth/20 px-2 py-1 text-sm normal-case tracking-normal" />
        </label>
        {credit && credit.availableMinor > 0 && (
          <label className="col-span-2 flex items-center gap-2 text-xs text-earth">
            <input type="checkbox" checked={useCredit} onChange={(e) => setUseCredit(e.target.checked)} />
            Use my {money(credit.availableMinor)} store credit (merchandise only, not delivery or tax)
          </label>
        )}
        <button type="submit" disabled={busy} className="col-span-2 border border-earth/30 py-2 text-[10px] uppercase tracking-widest hover:bg-earth hover:text-cream">
          {busy && !est ? 'Checking delivery…' : 'Review delivery and total'}
        </button>
      </form>

      <div aria-live="polite">
        {est && !stale && est.status === 'ok' && est.totalMinor !== null && (
          <div className="text-xs text-earth space-y-1 border-t border-earth/10 pt-3">
            <div className="flex justify-between"><span>Merchandise</span><span>{money(est.merchandiseMinor)}</span></div>
            {!!est.creditMinor && <div className="flex justify-between"><span>Store credit</span><span>−{money(est.creditMinor)}</span></div>}
            <div className="flex justify-between"><span>Curbside delivery</span><span>{money(est.deliveryChargeMinor ?? 0)}</span></div>
            <div className="flex justify-between"><span>Estimated tax</span><span>{money(est.taxMinor ?? 0)}</span></div>
            <div className="flex justify-between font-serif text-base"><span>Total</span><span>{money(est.totalMinor)}</span></div>
            <p className="text-[11px] text-earth/60 pt-2">{est.splitKnown ? SPLIT_WILL : SPLIT_MAY}</p>
            <p className="text-[11px] text-earth/50">{est.timingCaveat}</p>
          </div>
        )}
        {est && !stale && est.status !== 'ok' && <p className="text-xs text-earth">{QUOTE_CTA}: this address or item needs a delivery quote before you can pay. Contact us and we'll confirm it.</p>}
        {stale && <p className="text-xs text-earth/60">Your cart or address changed. Review delivery and total again.</p>}
        {msg && <p className="text-xs text-red-700">{msg}</p>}
      </div>

      {est && !stale && est.status === 'ok' && est.totalMinor !== null && (
        <button
          onClick={accepted === null ? () => setAccepted(est.totalMinor) : pay}
          disabled={busy}
          className="w-full bg-earth text-cream py-4 text-[10px] uppercase tracking-[0.2em] hover:bg-bronze transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : accepted === null ? `Accept new total ${money(est.totalMinor)}` : `Pay ${money(est.totalMinor)}`}
        </button>
      )}
    </div>
  );
}
