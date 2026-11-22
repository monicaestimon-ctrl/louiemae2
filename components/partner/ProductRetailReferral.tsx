import React, { useEffect, useRef, useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { useRecoverableQuery } from '../../contexts/useRecoverableQuery';
import { customerMessage } from '../../lib/errors';

type Props = { productId: string; variantId: string; viewerKey: string; onAccount: () => void };

/** Identity changes discard pending commands and copied URLs as well as query state. */
export default function ProductRetailReferral(props: Props) {
  return <Referral key={JSON.stringify([props.productId, props.variantId, props.viewerKey])} {...props} />;
}

function Referral({ productId, variantId, onAccount }: Props) {
  const [refreshToken, setRefreshToken] = useState(() => Date.now());
  const result = useRecoverableQuery(api.prgLinks.preview, { productId: productId as Id<'commerceProducts'>, variantId, refreshToken });
  const create = useMutation(api.prgLinks.create);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const [link, setLink] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    mounted.current = true;
    const timer = window.setInterval(() => setRefreshToken(value => Math.max(Date.now(), value + 1)), 30_000);
    return () => { mounted.current = false; window.clearInterval(timer); };
  }, []);
  const preview = result.data;
  const copy = async () => {
    if (pending.current || preview?.status !== 'eligible') return;
    pending.current = true;
    setBusy(true); setLink(''); setMessage('');
    try {
      // Always revalidate on the server, even when the preview was eligible.
      const created = await create({ productId: productId as Id<'commerceProducts'>, variantId, channelTag: 'share' });
      if (!mounted.current) return;
      setLink(created.url);
      try {
        await navigator.clipboard.writeText(created.url);
        if (mounted.current) setMessage('Retail referral link copied. Include the disclosure when you share it.');
      } catch {
        if (mounted.current) setMessage('Your link is ready. Select and copy it below.');
      }
    } catch (error) {
      if (mounted.current) { setMessage(customerMessage(error)); result.retry(); }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return <section className="pp-block" aria-label="Retail referrals">
    <h2 className="pp-lbl">Share with retail customers</h2>
    <p className="help">Retail referral links send your audience to Louie Mae. Trade purchases do not earn referral commissions.</p>
    {result.status === 'loading' && <p role="status">Checking referral availability…</p>}
    {result.status === 'unavailable' && <div role="alert"><p>Referral details could not load.</p><button type="button" className="btn btn-line btn-sm" onClick={result.retry}>Try again</button></div>}
    {preview && preview.status !== 'eligible' && <>
      <p role="status">{preview.message}</p>
      {(preview.status === 'sign_in' || preview.status === 'membership_required') && <button type="button" className="btn btn-line btn-sm" onClick={onAccount}>{preview.status === 'sign_in' ? 'Sign in' : 'Referrals & earnings'}</button>}
    </>}
    {preview?.status === 'eligible' && <>
      <p><strong>{preview.category === 'decor' ? 'Décor, including lighting' : preview.category === 'clothing' ? 'Clothing' : 'Furniture'}</strong> · {preview.applicableRateBps / 100}% of eligible merchandise paid</p>
      {preview.exceptionNote && <p>{preview.exceptionNote}</p>}
      <a href={preview.destinationUrl} target="_blank" rel="noopener noreferrer">View {preview.productName} on Louie Mae (opens a new tab)</a>
      <p className="help">{preview.disclosureExample}</p>
      <button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={copy}>{busy ? 'Creating retail link…' : 'Copy retail referral link'}</button>
      {link && <label style={{ display: 'block', marginTop: 12 }}>Retail referral link<input aria-label="Retail referral link" className="field" style={{ width: '100%', minWidth: 0 }} readOnly value={link} onFocus={event => event.currentTarget.select()} /></label>}
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
