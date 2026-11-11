import React, { useEffect, useRef, useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { CredentialsForm } from './account/CredentialsForm';
import { Copy, Download, Check, ArrowUpRight } from 'lucide-react';
import { api } from '../convex/_generated/api';
import { partnerCopy, rateRows, TIER_NAMES, type HolmTier } from '../lib/holmPartners';
import { activeRef, partnerPageUrl, shareOrigin } from '../lib/partnerLink';
import ProgramHubV2 from './partner/ProgramHubV2';

// The Creator Hub on louiemae.com: the same partner program as /trade, without the trade tools.
const PAGES: [string, string][] = [
  ['', 'Louie Mae home'],
  ['#shop', 'Shop'],
  ['#new-arrivals', 'New arrivals'],
  ['#collection/furniture', 'Furniture'],
  ['#collection/decor', 'Home décor'],
  ['#collection/fashion', "Women's"],
  ['#collection/kids', 'Kids'],
  ['#story', 'Our story'],
  ['custom', 'Another page (paste its address)'],
];
const CHANNELS: [string, string][] = [
  ['story', 'Instagram Story'],
  ['pin', 'Pinterest'],
  ['post', 'Social post'],
  ['link', 'Link in bio or blog'],
  ['share', 'Message or email'],
  ['qr', 'QR code'],
];
const TERMS_URL = '/trade#partner-terms';
const money = (cents: number) => `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const errText = (e: unknown) => String((e as Error)?.message || e).replace(/^.*Uncaught Error:\s*/s, '').split('\n')[0];

function QrCode({ text, label }: { text: string; label: string }) {
  const ref = useRef<React.ElementRef<"canvas">>(null);
  useEffect(() => {
    let live = true;
    void import('qrcode-generator').then(({ default: qrcode }) => {
      const c = ref.current;
      if (!live || !c) return;
      const q = qrcode(0, 'M');
      q.addData(text);
      q.make();
      const size = 480, n = q.getModuleCount(), pad = 32, cell = (size - 2 * pad) / n;
      c.width = c.height = size;
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, size, size);
      g.fillStyle = '#2a1a0f';
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect(pad + k * cell, pad + r * cell, Math.ceil(cell), Math.ceil(cell));
    });
    return () => { live = false; };
  }, [text]);
  const download = () => {
    const a = document.createElement('a');
    a.href = ref.current!.toDataURL('image/png');
    a.download = 'louie-mae-qr.png';
    a.click();
  };
  return (
    <div className="flex items-center gap-4">
      <canvas ref={ref} className="w-32 h-32 rounded-lg border border-sand bg-white" aria-label={label} />
      <button onClick={download} className="inline-flex items-center gap-2 text-sm text-bronze hover:text-earth"><Download className="w-4 h-4" /> Download QR code</button>
    </div>
  );
}

function RateTable({ tier }: { tier?: HolmTier | null }) {
  const rows = rateRows();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <caption className="sr-only">Commission rates by tier and product type</caption>
        <thead className="text-xs sm:uppercase sm:tracking-[0.15em] text-earth/60">
          <tr><th className="py-2 pr-2 font-medium">Tier</th>{rows[0].rates.map((r) => <th key={r.type} className="py-2 px-2 sm:px-3 font-medium">{r.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.tier} className={`border-t border-sand ${tier === r.tier ? 'bg-cream-dark font-medium' : ''}`}>
              <td className="py-2 pr-2"><span className="text-earth">{r.name}</span> <span className="block sm:inline text-xs sm:text-sm text-earth/60">{r.sales}</span></td>
              {r.rates.map((x) => <td key={x.type} className="py-2 px-2 sm:px-3 tabular-nums">{x.rate}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-earth/60 mt-2">Tiers are set by attributed sales over the last 12 months.</p>
    </div>
  );
}

/** Use shared credential validation while respecting the server-enabled sign-in providers. */
function SignIn() {
  const opts = useQuery(api.holm.signInOptions);
  return <CredentialsForm site="creator" googleEnabled={opts?.google} />;
}

function Join() {
  const join = useMutation(api.holmPartners.join);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div className="grid gap-4 max-w-xl">
      <h3 className="font-serif text-2xl text-earth">Join as a creator</h3>
      <label className="flex gap-3 items-start text-sm text-earth/80">
        <input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>I agree to the <a href={TERMS_URL} target="_blank" rel="noopener" className="underline">partner terms</a>, and I'll label posts that include my link, for example "#ad" or "I earn a commission".</span>
      </label>
      {err && <p className="text-sm text-red-700" role="alert">{err}</p>}
      <button disabled={!agree || busy} onClick={async () => { setBusy(true); setErr(''); try { await join({ acceptTerms: true }); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } }}
        className="justify-self-start bg-earth text-cream rounded-full px-8 py-3 text-sm tracking-wide disabled:opacity-50">Join the program</button>
    </div>
  );
}

/** Store credit: apply it to the next order automatically, or save it up. */
function CreditSetting({ balanceCents }: { balanceCents: number }) {
  const c = useQuery(api.holmCredit.myCredit);
  const set = useMutation(api.holmCredit.setCreditAutoApply);
  if (!c) return null;
  return (
    <label className="flex items-start justify-between gap-4 rounded-xl border border-sand bg-white/70 p-4">
      <span className="text-sm text-earth">
        Store credit <b className="font-medium">{money(balanceCents)}</b>
        <span className="block text-earth/60">{c.autoApply ? 'Applied to your next order.' : 'Saved for later.'} It comes off merchandise only, never delivery or tax, and is never paid out as cash.</span>
      </span>
      <span className="flex items-center gap-2 text-sm text-earth/80 whitespace-nowrap">
        <input type="checkbox" checked={c.autoApply} onChange={(e) => void set({ on: e.target.checked })} />
        Apply to my next order
      </span>
    </label>
  );
}

type Hub = NonNullable<ReturnType<typeof useHub>>;

/** Payouts: monthly on the 15th through Stripe once set up; by hand until automatic payouts are on. */
function PayoutSetup({ hub }: { hub: Hub }) {
  const start = useAction(api.holmConnect.startPayoutSetup);
  const refresh = useAction(api.holmConnect.refreshPayoutStatus);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const s = hub.payoutSetup;
  const min = money(hub.payoutMinCents);
  useEffect(() => {
    if (s.enabled && s.connected && !s.ready) refresh().catch(() => {});
  }, [s.enabled, s.connected, s.ready, refresh]);
  const go = async () => {
    setBusy(true);
    setErr('');
    try {
      window.location.href = await start({ returnTo: 'creators' });
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };
  return (
    <div className="rounded-xl border border-sand bg-white/70 p-4 grid gap-2 text-sm text-earth">
      <b className="font-medium">Payouts</b>
      {!s.enabled ? (
        <span className="text-earth/70">Commission is paid monthly once your cleared balance is {min} or more. Until automatic payouts open, we pay by hand once we have your tax details.</span>
      ) : s.ready ? (
        <span className="text-earth/70">Payouts ready. Paid on the 15th to your bank through Stripe when your cleared balance is {min} or more; smaller balances carry over.</span>
      ) : (
        <>
          <span className="text-earth/70">
            {s.connected
              ? s.due
                ? 'Stripe needs a few more details before it can pay you.'
                : 'Finishing setup with Stripe.'
              : 'Connect a bank account through Stripe to be paid automatically on the 15th. Stripe collects your tax details; we never see your bank information.'}
          </span>
          <button onClick={go} disabled={busy} className="justify-self-start bg-earth text-cream rounded-full px-6 py-2 text-sm disabled:opacity-60">
            {s.connected ? 'Continue with Stripe' : 'Set up payouts'}
          </button>
          {err && <span className="text-red-700" role="alert">{err}</span>}
        </>
      )}
    </div>
  );
}
function useHub(signedIn: boolean) {
  return useQuery(api.holmPartners.hub, signedIn ? {} : 'skip');
}

function Dashboard({ hub }: { hub: Hub }) {
  const [page, setPage] = useState('');
  const [custom, setCustom] = useState('');
  const [ch, setCh] = useState('link');
  const [copied, setCopied] = useState(false);
  const tier = hub.tier as HolmTier;
  const link = partnerPageUrl(shareOrigin(), page === 'custom' ? custom : page, hub.refCode, ch);
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* the link is on screen to copy by hand */ }
  };
  const statusLabel = (c: Hub['commissions'][number]) =>
    ({ pending: `Pending · clears ${new Date(c.clearsAt).toLocaleDateString()}`, cleared: 'Cleared', paid: 'Paid', void: 'Void' })[c.status];
  return (
    <div className="grid gap-10">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-bronze">{TIER_NAMES[tier]} tier · code {hub.refCode}</p>
        <h2 className="font-serif text-4xl text-earth mt-2">Your Creator Hub</h2>
        <p className="text-earth/80 mt-2">{partnerCopy(tier).ratesLine}.</p>
        {hub.tierProgress && <p className="text-sm text-bronze mt-1">{hub.tierProgress}.</p>}
        <p className="text-sm text-earth/60 mt-1">{partnerCopy().typesNote} Commission on an item never takes more than {partnerCopy().profitCap} of our profit on it.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {([['Link visits · 30 days', String(hub.clicks30)], ['Orders', String(hub.orders)], ['Pending', money(hub.pendingCents)], ['Cleared', money(hub.clearedCents)], ['Paid', money(hub.paidCents)]] as const).map(([l, v]) => (
          <div key={l} className="rounded-xl border border-sand bg-white/70 p-4"><p className="text-[11px] uppercase tracking-[0.15em] text-earth/60">{l}</p><p className="font-serif text-2xl text-earth mt-1 tabular-nums">{v}</p></div>
        ))}
      </div>

      <section className="grid gap-4 rounded-2xl border border-sand bg-white/70 p-6">
        <h3 className="font-serif text-2xl text-earth">Make a link</h3>
        <div className="grid md:grid-cols-2 gap-3">
          <label className="grid gap-1 text-xs uppercase tracking-[0.15em] text-earth/60">Page
            <select value={page} onChange={(e) => setPage(e.target.value)} className="border border-sand rounded-lg px-3 py-3 bg-white text-sm normal-case tracking-normal text-earth">{PAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label className="grid gap-1 text-xs uppercase tracking-[0.15em] text-earth/60">Where you'll share it
            <select value={ch} onChange={(e) => setCh(e.target.value)} className="border border-sand rounded-lg px-3 py-3 bg-white text-sm normal-case tracking-normal text-earth">{CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
        </div>
        {page === 'custom' && (
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="https://www.louiemae.com/#collection/…" aria-label="Page address on louiemae.com" className="border border-sand rounded-lg px-4 py-3 bg-white text-sm" />
        )}
        {link ? (
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <code className="flex-1 min-w-0 break-all rounded-lg bg-cream-dark px-4 py-3 text-xs text-earth">{link}</code>
            <button onClick={copy} className="inline-flex justify-center items-center gap-2 bg-earth text-cream rounded-full px-6 py-3 text-sm">{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied ? 'Copied' : 'Copy'}</button>
          </div>
        ) : (
          <p className="text-sm text-red-700">Paste an address on louiemae.com.</p>
        )}
        {link && ch === 'qr' && <QrCode text={link} label="QR code for your link" />}
        <p className="text-sm text-earth/60">Visits through your link count for {partnerCopy().attributionDays} days. Label posts with "#ad" or "I earn a commission". Orders you place yourself don't earn commission.</p>
      </section>

      <section className="grid gap-3">
        <h3 className="font-serif text-2xl text-earth">Orders through your links</h3>
        {hub.commissions.length ? (
          <div className="overflow-x-auto rounded-2xl border border-sand bg-white/70">
            <table className="w-full text-sm text-left">
              <thead className="text-xs uppercase tracking-[0.15em] text-earth/60"><tr><th className="p-3 font-medium">Date</th><th className="p-3 font-medium">Items</th><th className="p-3 font-medium">Order</th><th className="p-3 font-medium">You earn</th><th className="p-3 font-medium">Status</th></tr></thead>
              <tbody>
                {hub.commissions.map((c, i) => (
                  <tr key={i} className="border-t border-sand align-top">
                    <td className="p-3 whitespace-nowrap">{new Date(c.createdAt).toLocaleDateString()}</td>
                    <td className="p-3 text-earth/70">{c.source === 'adjustment' ? 'Adjustment: ' : ''}{c.lines.length ? c.lines.map((l) => `${l.type === 'decor' ? 'Décor' : l.type[0].toUpperCase() + l.type.slice(1)} ${l.rateBps / 100}%${l.capped ? ' (capped)' : ''}`).join(' · ') : c.note || '—'}</td>
                    <td className="p-3 tabular-nums">{c.baseCents ? money(c.baseCents) : ''}</td>
                    <td className="p-3 tabular-nums">{money(c.amountCents)}</td>
                    <td className="p-3">{statusLabel(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-earth/60">Orders people place through your links show up here, with what you earned on each. We never show buyers' names.</p>
        )}
        <p className="text-sm text-earth/60">Commission is pending for {partnerCopy().clearingDays} days after payment, then clears.</p>
        <CreditSetting balanceCents={hub.creditCents} />
        <PayoutSetup hub={hub} />
      </section>

      <p className="text-sm text-earth/70 flex flex-wrap gap-x-6 gap-y-2">
        <a href="/trade#hub" className="inline-flex items-center gap-1 underline">Trade tools, boards and payouts on House of Louie Mae <ArrowUpRight className="w-3.5 h-3.5" /></a>
        <a href={TERMS_URL} className="underline">Partner terms</a>
      </p>
    </div>
  );
}

export default function CreatorHub() {
  const me = useQuery(api.holm.me);
  const ensureProfile = useMutation(api.holm.ensureProfile);
  const signedIn = !!me?.signedIn;
  const hub = useHub(signedIn);
  useEffect(() => {
    if (signedIn) ensureProfile({ ref: activeRef()?.code }).catch(() => {});
  }, [signedIn, ensureProfile]);
  const c = partnerCopy();
  // v2 (S33): with v2 enrollment on, signed-in members use the v2 program hub (versioned terms,
  // retail links, ledger, credit, payouts). Signed-out visitors still see the sign-in page below.
  const flags = useQuery(api.v2Admin.publicFlags);
  if (signedIn && flags?.creatorEnrollment)
    return (
      <main className="min-h-screen bg-cream pt-32 pb-24">
        <div className="container mx-auto px-4 sm:px-6 max-w-3xl grid gap-8">
          <h1 className="font-serif text-4xl text-earth">Creator Hub</h1>
          <h2 className="font-serif text-2xl text-earth">Your membership &amp; earnings</h2>
          <ProgramHubV2 site="creators" />
        </div>
      </main>
    );
  return (
    <main className="min-h-screen bg-cream pt-32 pb-24">
      <div className="container mx-auto px-4 sm:px-6 max-w-5xl grid gap-12">
        {!(signedIn && hub) && (
          <header className="grid gap-4">
            <p className="text-xs uppercase tracking-[0.25em] text-bronze">Louie Mae creators</p>
            <h1 className="font-serif text-5xl md:text-6xl text-earth leading-tight">Share what you love. Earn when it sells.</h1>
            <p className="text-lg text-earth/80 max-w-2xl">{c.ratesLine}, on orders placed through your links within {c.attributionDays} days. Your rate rises with your sales.</p>
            <p className="text-sm text-earth/60 max-w-2xl">{c.typesNote}</p>
          </header>
        )}
        {me === undefined || (signedIn && hub === undefined) ? (
          <p className="text-earth/60">Loading…</p>
        ) : !signedIn ? (
          <SignIn />
        ) : hub ? (
          <Dashboard hub={hub} />
        ) : (
          <Join />
        )}
        <section className="grid gap-3">
          <h3 className="font-serif text-2xl text-earth">Rates</h3>
          <RateTable tier={hub ? (hub.tier as HolmTier) : null} />
          <p className="text-sm text-earth/60">Commission on any item never takes more than {c.profitCap} of our profit on it, so a few low-margin items earn a little less. <a href={TERMS_URL} className="underline">Read the partner terms</a>.</p>
        </section>
      </div>
    </main>
  );
}
