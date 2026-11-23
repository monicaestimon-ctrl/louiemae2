import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import type { Id } from '../../convex/_generated/dataModel';
import { api } from '../../convex/_generated/api';
import { commerceErrorData, customerMessage } from '../../lib/errors';
import { dollarsToMinor } from '../../lib/decimal';

type Detail = FunctionReturnType<typeof api.catPricing.review>;
const tiers = ['base', 'active', 'top', 'elite'] as const;
const money = (minor: number | null | undefined) =>
  minor == null ? 'Not approved' : `$${(minor / 100).toFixed(2)}`;
const button = 'min-h-11 border border-earth/30 px-3 py-2 disabled:opacity-40';
const field = 'block border border-earth/30 p-2 w-full min-h-11';
export default function CatalogPricingReview({ variantId }: { variantId: Id<'catVariants'> }) {
  const [refreshKey, setRefreshKey] = useState(() => Date.now());
  const data = useQuery(api.catPricing.review, { variantId, refreshKey });
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (!data || data.variant._id !== variantId) return;
    const timer = window.setTimeout(
      () => setRefreshKey((n) => n + 1),
      Math.max(
        1_000,
        Math.min(60_000, (data.nextRefreshAt ?? Date.now() + 60_000) - Date.now() + 1)
      )
    );
    return () => window.clearTimeout(timer);
  }, [data, variantId, refreshKey]);
  if (!data || data.variant._id !== variantId) return <p role="status">Loading pricing review…</p>;
  return (
    <PricingForm
      key={`${variantId}:${generation}`}
      initial={data}
      latest={data}
      reload={() => {
        setRefreshKey((n) => n + 1);
        setGeneration((n) => n + 1);
      }}
    />
  );
}
function PricingForm({
  initial,
  latest,
  reload,
}: {
  initial: Detail;
  latest: Detail;
  reload: () => void;
}) {
  const [base] = useState(initial);
  const approve = useMutation(api.catPricing.approvePrice);
  const assign = useMutation(api.catPricing.assignPolicy);
  const eligibility = useMutation(api.prgLinks.setReferralEligibility);
  const exception = useMutation(api.prgLinks.createException);
  const [reason, setReason] = useState('');
  const [policy, setPolicy] = useState(base.variant.marginPolicyKey ?? '');
  const [documentRef, setDocumentRef] = useState(base.variant.marginPolicyDocumentRef ?? '');
  const [channel, setChannel] = useState<'retail' | 'trade'>('retail');
  const [amount, setAmount] = useState('');
  const [visibleNote, setVisibleNote] = useState('');
  const [effective, setEffective] = useState('');
  const [rates, setRates] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      tiers.map((t) => [
        t,
        base.commission.ok
          ? String((base.commission.rates.find((r) => r.tierKey === t)?.rateBps ?? 0) / 100)
          : '',
      ])
    )
  );
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [failed, setFailed] = useState(false);
  const stale = base.reviewHash !== latest.reviewHash;
  const canWrite = base.canApprove && latest.canApprove && !stale && !busy;
  const noted = reason.trim().length >= 10;
  const scope = { variantId: base.variant._id, expectedReviewHash: base.reviewHash };
  const unit = base.supplierCode === 'ashcroft' ? 'selling unit' : 'pack';
  const economics = base.economics.ok ? base.economics.result : null;
  async function run(work: () => Promise<unknown>, success: string) {
    setBusy(true);
    setFailed(false);
    setMessage('Checking current evidence…');
    try {
      await work();
      setMessage(success);
    } catch (error) {
      setFailed(true);
      setMessage(commerceErrorData(error)?.detail ?? customerMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="border border-earth/20 p-4 space-y-4"
      aria-label="SKU pricing and referral approval"
    >
      <h3 className="font-serif text-xl">Pricing &amp; referrals — {base.name}</h3>
      <p>
        {base.supplierCode} · {base.variant.supplierSku} · {unit} · {base.category}
      </p>
      <p>
        Contribution includes the configured expenses and delivery funding. It is not a guarantee of
        operating profit or actual freight cost.
      </p>
      <p>
        Current policy: {base.variant.marginPolicyKey ?? 'Unassigned'}. Referral eligibility:{' '}
        {base.variant.referralEligible === undefined
          ? 'Unreviewed'
          : base.variant.referralEligible
            ? 'Enabled, subject to current qualification'
            : 'Disabled'}
        .
      </p>
      <p>Catalog holds: {base.variant.holds?.join(', ') || 'None'}.</p>
      <p>
        Wholesale: {money(base.cost?.wholesaleMinor)} per{' '}
        {base.cost?.wholesaleUnitBasis === 'selling_unit' ? 'selling unit' : 'piece'}. MAP:{' '}
        {base.cost?.mapApplicability === 'not_applicable'
          ? 'Confirmed not applicable'
          : base.cost?.mapApplicability === 'applies'
            ? `${money(base.cost.mapMinor)} per ${base.supplierCode === 'ashcroft' ? 'selling unit' : base.cost.mapUnitBasis}`
            : 'Unresolved'}
        .
      </p>
      <p>
        Approved retail: {money(base.prices.retail?.packPriceMinor)}. Approved trade:{' '}
        {money(base.prices.trade?.packPriceMinor)} per {unit}.
      </p>
      {base.prices.retail && base.prices.trade && (
        <p>
          Trade savings versus approved retail:{' '}
          {(
            (1 - base.prices.trade.packPriceMinor / base.prices.retail.packPriceMinor) *
            100
          ).toFixed(2)}
          %. Trade purchases do not earn referral commissions.
        </p>
      )}
      {base.published.map((p) => (
        <p key={p.channel}>
          {p.channel === 'house' ? 'HOLM' : 'Louie Mae'} listing:{' '}
          {p.published
            ? `${money(p.amountMinor)} (${p.pricingMode === 'legacy' ? 'legacy base; not a final v2 price' : 'final approved snapshot'})`
            : 'Not published'}
          .
        </p>
      ))}
      <p>
        Saving an approval does not publish a price or activate checkout. Republish qualified
        listings through Product review and publication.
      </p>
      {!base.freshness.ok ? (
        <p role="status">Evidence: {base.freshness.error}</p>
      ) : (
        <p>
          Current inventory: {base.freshness.result.availability.replaceAll('_', ' ')}. Evidence
          holds: {base.freshness.result.holds.join(', ') || 'None'}.
        </p>
      )}
      {!base.economics.ok ? (
        <p role="status">Calculation unavailable: {base.economics.error}</p>
      ) : (
        <>
          <p>
            Required retail minimum: {money(economics!.minimumRetailMinor)}. Required trade minimum:{' '}
            {money(economics!.minimumBaseTradeMinor)} per {unit}.
          </p>
          <ul>
            {economics!.scenarios.map((s) => (
              <li key={s.name}>
                {s.name.replaceAll('_', ' ')}: merchandise {money(s.priceMinor)}, contribution{' '}
                {money(s.contributionMinor)} ({(s.contributionBps / 100).toFixed(2)}%) —{' '}
                {s.passes ? 'Meets policy' : 'Below policy'}
              </li>
            ))}
          </ul>
        </>
      )}
      {base.commission.ok ? (
        <p>
          Current visible referral rates:{' '}
          {base.commission.rates.map((r) => `${r.tierKey} ${r.rateBps / 100}%`).join(' · ')}.
          Protected previous referrals may require a higher reserve.
        </p>
      ) : (
        <p>Referral schedule unavailable: {base.commission.error}</p>
      )}
      {!latest.canApprove && (
        <p>Finance access is read-only. An approver must save pricing or referral decisions.</p>
      )}
      {stale && (
        <p role="alert">
          The evidence or terms changed while this review was open. Refresh before approving.
        </p>
      )}
      <button type="button" className={button} disabled={busy} onClick={reload}>
        Refresh pricing review
      </button>
      <fieldset disabled={!canWrite} className="space-y-3">
        <legend>Approval reason</legend>
        <label className="block">
          Reason and evidence references (at least 10 characters)
          <textarea
            className={field}
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <label className="block">
          Approved margin policy
          <select className={field} value={policy} onChange={(e) => setPolicy(e.target.value)}>
            <option value="">Choose a policy</option>
            {base.policies.map((p) => (
              <option key={p.key} value={p.key} disabled={!p.eligible}>
                {p.key} — {p.targetBps == null ? 'Review required' : `${p.targetBps / 100}%`}
                {!p.eligible ? ' (not eligible)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          Margin exception approval document
          <input
            className={field}
            value={documentRef}
            maxLength={1000}
            onChange={(e) => setDocumentRef(e.target.value)}
          />
        </label>
        <button
          className={button}
          disabled={
            !noted ||
            !base.policies.some(
              (p) =>
                p.key === policy && p.eligible && (!p.requiresDocumentRef || documentRef.trim())
            )
          }
          onClick={() =>
            run(
              () =>
                assign({
                  ...scope,
                  policyKey: policy,
                  documentRef: documentRef.trim() || undefined,
                  reason,
                }),
              'Policy saved. Refresh to review current calculations before approving prices.'
            )
          }
        >
          Assign reviewed policy
        </button>
        <label className="block">
          Price channel
          <select
            className={field}
            value={channel}
            onChange={(e) => setChannel(e.target.value as 'retail' | 'trade')}
          >
            <option value="retail">Louie Mae retail</option>
            <option value="trade">HOLM trade</option>
          </select>
        </label>
        <label className="block">
          Final merchandise price per {unit} in USD
          <input
            className={field}
            inputMode="decimal"
            value={amount}
            maxLength={15}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <button
          className={button}
          disabled={!noted || !economics || !/^\d+(\.\d{1,2})?$/.test(amount)}
          onClick={() =>
            run(
              () =>
                approve({
                  ...scope,
                  channel,
                  packPriceMinor: dollarsToMinor(amount, 'half_up'),
                  reason,
                }),
              'Price approved. Refresh and republish the qualified channel to make the new price live.'
            )
          }
        >
          Approve final price
        </button>
        <div className="flex flex-wrap gap-2">
          <button
            className={button}
            disabled={!noted || !economics}
            onClick={() =>
              run(
                () => eligibility({ ...scope, eligible: true, reason }),
                'Referral eligibility approved against current funded retail pricing. Publication and program activation still apply.'
              )
            }
          >
            Enable qualified referrals
          </button>
          <button
            className={button}
            disabled={!noted}
            onClick={() =>
              run(
                () => eligibility({ ...scope, eligible: false, reason }),
                'New referrals disabled. Existing earned commissions remain unchanged.'
              )
            }
          >
            Disable new referrals
          </button>
        </div>
      </fieldset>
      <details>
        <summary>Product-wide visible commission exception</summary>
        <p>
          Applies to all variants of this product. Existing protected referrals and earned
          commissions retain their recorded terms. Offers must still fund the applicable reserve.
        </p>
        {base.exceptions.map((e) => (
          <p key={e.id}>
            Version {e.version}, starts {new Date(e.effectiveFrom).toLocaleString()}
            {e.effectiveTo ? `, ends ${new Date(e.effectiveTo).toLocaleString()}` : ''}:{' '}
            {e.rates.map((r) => `${r.tierKey} ${r.rateBps / 100}%`).join(' · ')} — {e.visibleNote}
          </p>
        ))}
        {base.exceptionHistoryTruncated && (
          <p>
            Showing the latest 10 exception versions. Earlier versions remain in the audit history.
          </p>
        )}
        <fieldset disabled={!canWrite} className="space-y-3">
          <legend>New visible exception</legend>
          {tiers.map((t) => (
            <label key={t} className="block">
              {t} commission percent
              <input
                className={field}
                inputMode="decimal"
                value={rates[t]}
                onChange={(e) => setRates((old) => ({ ...old, [t]: e.target.value }))}
              />
            </label>
          ))}
          <label className="block">
            Note shown to partners
            <textarea
              className={field}
              maxLength={1000}
              value={visibleNote}
              onChange={(e) => setVisibleNote(e.target.value)}
            />
          </label>
          <label className="block">
            Effective time (local time; leave empty for now)
            <input
              type="datetime-local"
              className={field}
              value={effective}
              onChange={(e) => setEffective(e.target.value)}
            />
          </label>
          <button
            className={button}
            disabled={
              !visibleNote.trim() || !tiers.every((t) => /^\d+(\.\d{1,2})?$/.test(rates[t]))
            }
            onClick={() =>
              run(
                () =>
                  exception({
                    productId: base.variant.productId,
                    reviewVariantId: base.variant._id,
                    expectedReviewHash: base.reviewHash,
                    rates: tiers.map((tierKey) => ({
                      tierKey,
                      rateBps: dollarsToMinor(rates[tierKey], 'half_up'),
                    })),
                    visibleNote,
                    ...(effective ? { effectiveFrom: new Date(effective).getTime() } : {}),
                  }),
                'Exception saved. Refresh and review the funded economics before sharing products.'
              )
            }
          >
            Save visible exception
          </button>
        </fieldset>
      </details>
      <p role={failed ? 'alert' : 'status'} aria-live="polite">
        {message}
      </p>
    </section>
  );
}
