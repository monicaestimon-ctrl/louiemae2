import React, { useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Doc } from '../../convex/_generated/dataModel';
import { getUserFacingErrorMessage } from '../../lib/errorMessages';

const KINDS = [
  ['media', 'Product images'], ['map', 'Minimum advertised prices'], ['trade', 'Trade discounts'],
  ['coupon', 'Coupons'], ['private_label', 'Private label'], ['returns', 'Returns'],
  ['promotion_stacking', 'Combined promotions'], ['store_credit', 'Store credit'],
] as const;
type Policy = Doc<'catSupplierPolicies'>;
const lines = (value: string) => [...new Set(value.split(/\r?\n/).map(s => s.trim()).filter(Boolean))];
const inputClass = 'block w-full border border-earth/30 rounded p-2';

export default function SupplierPolicies({ canApprove }: { canApprove: boolean }) {
  const [supplierCode, setSupplier] = useState('zuo');
  const records = useQuery(api.catPolicies.policies, { supplierCode });
  const save = useMutation(api.catPolicies.savePolicy);
  const [kind, setKind] = useState<Policy['kind']>('media');
  const [status, setStatus] = useState<Policy['status']>('unverified');
  const [all, setAll] = useState(false);
  const [skus, setSkus] = useState('');
  const [summary, setSummary] = useState('');
  const [refs, setRefs] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const reset = () => { setKind('media'); setStatus('unverified'); setAll(false); setSkus(''); setSummary(''); setRefs(''); setMessage(null); };
  const edit = (row: Policy) => {
    setKind(row.kind); setStatus(row.status); setAll(row.scope.all === true);
    setSkus((row.scope.skus ?? []).join('\n')); setSummary(row.summary); setRefs(row.evidenceRefs.join('\n')); setMessage(null);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canApprove || busy.current) return;
    const evidenceRefs = lines(refs);
    const scope = all ? { all: true } : { skus: lines(skus) };
    if (!summary.trim() || (!all && !scope.skus?.length) || (status === 'documented' && !evidenceRefs.length)) {
      setMessage({ error: true, text: 'Enter a summary, select the product scope, and include source references for a documented policy.' }); return;
    }
    busy.current = true; setSaving(true); setMessage(null);
    try {
      await save({ supplierCode, kind, status, summary: summary.trim(), evidenceRefs, scope });
      setMessage({ error: false, text: 'Supplier policy saved.' });
    } catch (error) { setMessage({ error: true, text: getUserFacingErrorMessage(error, 'The policy could not be saved. Please try again.') }); }
    finally { busy.current = false; setSaving(false); }
  };
  return <section className="bg-white border border-earth/10 rounded-lg p-4 space-y-3 text-sm text-earth" aria-labelledby="supplier-policy-title">
    <h3 id="supplier-policy-title" className="font-serif text-lg">Supplier policies & evidence</h3>
    <label className="block">Supplier<select className={inputClass} value={supplierCode} disabled={saving}
      onChange={e => { setSupplier(e.target.value); reset(); }}><option value="zuo">Zuo</option><option value="ashcroft">Ashcroft</option></select></label>
    {records === undefined ? <p role="status">Loading supplier policies…</p> : records.length === 0 ? <p>No current policies recorded for this supplier.</p>
      : <ul className="space-y-3">{records.map(row => <li key={row._id} className="border-b border-earth/10 pb-2">
        <strong>{KINDS.find(([key]) => key === row.kind)?.[1] ?? row.kind}</strong> · {row.status}
        <p>{row.scope.all ? 'All supplier products' : `Supplier SKUs: ${(row.scope.skus ?? []).join(', ')}`}</p>
        <p>{row.summary}</p><ul>{row.evidenceRefs.map((ref, i) => <li key={`${i}:${ref}`} className="break-words">{ref}</li>)}</ul>
        <p className="text-xs">Recorded {new Date(row.createdAt).toLocaleDateString()} by {row.createdBy}</p>
        {canApprove && <button type="button" className="underline" disabled={saving} onClick={() => edit(row)}>Revise {KINDS.find(([key]) => key === row.kind)?.[1] ?? row.kind} policy</button>}
      </li>)}</ul>}
    {canApprove ? <form onSubmit={submit}>
      <fieldset disabled={saving} className="space-y-3">
        <legend className="font-medium">Record a supplier policy</legend>
        <label className="block">Policy type<select className={inputClass} value={kind} onChange={e => setKind(e.target.value as Policy['kind'])}>{KINDS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="block">Evidence status<select className={inputClass} value={status} onChange={e => setStatus(e.target.value as Policy['status'])}><option value="unverified">Unverified</option><option value="documented">Documented permission</option><option value="denied">Denied by supplier</option></select></label>
        <label className="block"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> Applies to all supplier products</label>
        {!all && <label className="block">Supplier SKUs (one per line)<textarea className={inputClass} value={skus} onChange={e => setSkus(e.target.value)} required /></label>}
        <label className="block">Policy summary<textarea className={inputClass} value={summary} onChange={e => setSummary(e.target.value)} required /></label>
        <label className="block">Source references (one per line)<textarea className={inputClass} value={refs} onChange={e => setRefs(e.target.value)} required={status === 'documented'} /></label>
        <p className="text-xs">Use the supplier’s written policy and identify the document, date, and relevant section. Saving replaces the current policy of the same type and product scope; prior versions remain in history. Policy changes can affect permitted discounts and media use.</p>
        <button type="submit" className="px-3 py-2 border border-earth/30 rounded">{saving ? 'Saving policy…' : 'Save supplier policy'}</button>
      </fieldset>
    </form> : <p>Policy changes require an approver.</p>}
    {message && <p role={message.error ? 'alert' : 'status'}>{message.text}</p>}
  </section>;
}
