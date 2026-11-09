import React, { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { customerMessage, commerceErrorData } from '../../lib/errors';
import { normalizePackage, parseCsv, parseJsonPackage } from '../../lib/zuoImport';
import { KNOWN_METADATA_CORRECTIONS } from '../../lib/zuoImportNotes';
import { dollarsToMinor } from '../../lib/decimal';
import DeliveryOperations from './DeliveryOperations';
import PaidExceptionReview from './PaidExceptionReview';
import FulfillmentShipments from './FulfillmentShipments';
import CatalogMediaReview from './CatalogMediaReview';
import './commerce-v2-admin.css';

// Commerce v2 operations console (spec S35, v2 §20, §26). Admin-only: every query behind it
// requires the admin allowlist on the server.

type Section = 'decisions' | 'health' | 'reviews' | 'catalog' | 'fulfillment' | 'partners' | 'delivery' | 'integrations';
const SECTIONS: [Section, string][] = [
  ['decisions', 'Decisions & flags'],
  ['health', 'Health & alerts'],
  ['reviews', 'Review queue'],
  ['catalog', 'Catalog & import'],
  ['fulfillment', 'Dealer orders'],
  ['delivery', 'Delivery & freight'],
  ['partners', 'Partners & payouts'],
  ['integrations', 'Integration readiness'],
];
const money = (m: number) => `$${(m / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const card = 'bg-white border border-earth/10 rounded-lg p-4 space-y-2 text-sm text-earth';
const btn = 'px-3 py-1.5 border border-earth/30 text-[11px] uppercase tracking-widest hover:bg-earth hover:text-cream disabled:opacity-40';
const errText = (e: unknown) => commerceErrorData(e)?.detail ?? customerMessage(e);

function Decisions({ canApprove }: { canApprove: boolean }) {
  const data = useQuery(api.sysConfig.list, {});
  const approve = useMutation(api.sysConfig.approve);
  const reject = useMutation(api.sysConfig.reject);
  const [msg, setMsg] = useState<string | null>(null);
  if (!data) return <p>Loading…</p>;
  const proposed = data.records.filter((r) => r.status === 'proposed');
  const approved = data.records.filter((r) => r.status === 'approved');
  return (
    <div className="space-y-4">
      <div className={card}>
        <h3 className="font-serif text-lg">Feature flags (Convex environment variables)</h3>
        <ul className="grid sm:grid-cols-2 gap-1">
          {Object.entries(data.flags).map(([k, on]) => (
            <li key={k}>
              <span className={on ? 'text-green-700' : 'text-earth/50'}>{on ? '● on' : '○ off'}</span> {k}
            </li>
          ))}
        </ul>
        <p className="text-xs text-earth/60">Flags are changed in the Convex dashboard, in the order in docs/production-v2/05 §3, after the matching release gate is signed.</p>
      </div>
      <div className={card}>
        <h3 className="font-serif text-lg">Awaiting your decision ({proposed.length})</h3>
        {proposed.map((r) => (
          <div key={r._id} className="border-t border-earth/10 pt-2">
            <p>
              <b>{r.decision ?? '—'}</b> · {r.kind}/{r.key} v{r.version}
            </p>
            <p className="text-xs text-earth/70">{r.note}</p>
            <pre className="text-[11px] bg-cream/50 p-2 overflow-auto max-h-40">{JSON.stringify(r.value, null, 2)}</pre>
            <div className="flex gap-2">
              <button className={btn} disabled={!canApprove} onClick={() => approve({ id: r._id }).then(() => setMsg(`Approved ${r.key}`), (e) => setMsg(errText(e)))}>
                Approve
              </button>
              <button className={btn} disabled={!canApprove} onClick={() => reject({ id: r._id, note: 'Rejected in the decision register' }).then(() => setMsg(`Rejected ${r.key}`), (e) => setMsg(errText(e)))}>
                Reject
              </button>
            </div>
          </div>
        ))}
        <p aria-live="polite">{msg}</p>
      </div>
      <ProposeForm />
      <div className={card}>
        <h3 className="font-serif text-lg">In force ({approved.length})</h3>
        <ul className="text-xs space-y-1">
          {approved.map((r) => (
            <li key={r._id}>
              {r.kind}/{r.key} v{r.version} — approved by {r.approvedBy}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ProposeForm() {
  const propose = useMutation(api.sysConfig.propose);
  const [kind, setKind] = useState('operatorDetails');
  const [key, setKey] = useState('operator');
  const [value, setValue] = useState('{\n  "legalName": "",\n  "supportEmail": "",\n  "supportAddress": "",\n  "jurisdiction": "",\n  "privacyUrl": "",\n  "effectiveDate": ""\n}');
  const [note, setNote] = useState('');
  const [decision, setDecision] = useState('D-14');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className={card}
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await propose({ kind, key, value: JSON.parse(value), note, decision });
          setMsg('Proposed. Approve it above when ready.');
        } catch (err) {
          setMsg(err instanceof SyntaxError ? 'The value is not valid JSON.' : errText(err));
        }
      }}
    >
      <h3 className="font-serif text-lg">Propose a new version</h3>
      <p className="text-xs">For example operator details for the terms (D-14), carrier zones and rates (D-03), return policies (D-08) or a revised schedule. Nothing changes until it is approved.</p>
      <div className="grid sm:grid-cols-3 gap-2">
        <label className="text-xs">Kind<input className="border border-earth/20 px-2 py-1 w-full" value={kind} onChange={(e) => setKind(e.target.value)} /></label>
        <label className="text-xs">Key<input className="border border-earth/20 px-2 py-1 w-full" value={key} onChange={(e) => setKey(e.target.value)} /></label>
        <label className="text-xs">Decision<input className="border border-earth/20 px-2 py-1 w-full" value={decision} onChange={(e) => setDecision(e.target.value)} /></label>
      </div>
      <label className="text-xs block">Value (JSON)<textarea className="border border-earth/20 px-2 py-1 w-full font-mono h-40" value={value} onChange={(e) => setValue(e.target.value)} /></label>
      <label className="text-xs block">Note<input className="border border-earth/20 px-2 py-1 w-full" value={note} onChange={(e) => setNote(e.target.value)} required /></label>
      <button className={btn} type="submit">Propose</button>
      <p aria-live="polite">{msg}</p>
    </form>
  );
}

function Health() {
  const h = useQuery(api.sysAlerts.health);
  if (!h) return <p>Loading…</p>;
  return (
    <div className="space-y-4">
      <div className={card}>
        <h3 className="font-serif text-lg">Alerts</h3>
        {h.alerts.length === 0 ? <p>No alerts.</p> : h.alerts.map((a) => <p key={a.key}>⚠ {a.title} — {a.detail}</p>)}
        <p className="text-xs">Payout route: {h.payoutRoute}. Failed notifications: {h.failedNotifications}.</p>
      </div>
      <div className={card}>
        <h3 className="font-serif text-lg">Last 24 hours</h3>
        <table className="w-full text-xs">
          <tbody>
            {Object.entries(h.metrics).map(([k, v]) => (
              <tr key={k}>
                <th scope="row" className="text-left font-normal">{k}</th>
                <td className="text-right">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Reviews() {
  const rows = useQuery(api.v2Admin.reviewQueue, {});
  const resolve = useMutation(api.v2Admin.resolveReview);
  const confirmAdj = useMutation(api.ldgCommissions.confirmAdjustment);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  if (!rows) return <p>Loading…</p>;
  return (
    <div className={card}>
      <h3 className="font-serif text-lg">Open review items ({rows.length})</h3>
      <label className="block text-xs">
        Resolution note
        <input className="border border-earth/20 px-2 py-1 w-full" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {rows.map((r) => (
        <div key={r._id} className="border-t border-earth/10 pt-2">
          <p>
            <b>{r.kind}</b> · {r.entityTable} {r.entityId}
          </p>
          <p className="text-xs whitespace-pre-wrap">{r.detail}</p>
          {r.kind === 'ledger_adjustment_pending' ? (
            <button className={btn} onClick={() => confirmAdj({ reviewId: r._id }).then(() => setMsg('Adjustment confirmed'), (e) => setMsg(errText(e)))}>
              Confirm adjustment (second person)
            </button>
          ) : (
            <button className={btn} disabled={note.trim().length < 5} onClick={() => resolve({ id: r._id, resolution: note }).then(() => setMsg('Resolved'), (e) => setMsg(errText(e)))}>
              Resolve
            </button>
          )}
        </div>
      ))}
      <p aria-live="polite">{msg}</p>
    </div>
  );
}

async function sha256(text: string) {
  const d = await globalThis.crypto.subtle.digest('SHA-256', new globalThis.TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

function ZuoImport() {
  const begin = useMutation(api.zuoImport.begin);
  const stage = useMutation(api.zuoImport.stage);
  const finish = useMutation(api.zuoImport.finish);
  const batches = useQuery(api.zuoImport.batches);
  const [file, setFile] = useState<File | null>(null);
  const [expectCounts, setExpectCounts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const run = async (mode: 'dry_run' | 'commit') => {
    if (!file) return;
    setBusy(true);
    setLog([]);
    try {
      const text = await file.text();
      const rows = file.name.toLowerCase().endsWith('.csv') ? parseCsv(text) : parseJsonPackage(text);
      // Keep fallback observation metadata identical between dry run and commit.
      // A file timestamp is not supplier verification or permission to release a hold.
      const { records, rejected } = normalizePackage(rows, file.name, file.lastModified);
      const hash = await sha256(text);
      const res = await begin({ mode, sourceKey: hash, files: [{ name: file.name, sha256: hash, rows: rows.length }], codeRevision: 'admin-ui', expectedRecords: records.length, rejected });
      if (res.alreadyCommitted) {
        setLog(['This exact package is already committed. Nothing was changed.']);
        return;
      }
      for (let i = 0; i < records.length; i += 25) {
        await stage({ batchId: res.batchId, records: records.slice(i, i + 25) });
        setLog((l) => [...l.slice(-3), `Staged ${Math.min(i + 25, records.length)} of ${records.length}`]);
      }
      const done = await finish({ batchId: res.batchId, expectPackageCounts: expectCounts, metadataCorrections: KNOWN_METADATA_CORRECTIONS });
      setLog((l) => [...l, `${mode === 'commit' ? 'Commit' : 'Dry run'} ${done.status}. ${rejected.length} rejected rows.`, ...done.mismatches]);
    } catch (e) {
      setLog((l) => [...l, errText(e)]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={card}>
      <h3 className="font-serif text-lg">Zuo package import</h3>
      <p className="text-xs">Upload Zuo-Draft-Import.json or .csv. Run a dry run first and review it; a commit is refused until this exact file has a completed dry run. Every product starts as a draft with retail, trade and referrals off.</p>
      <input type="file" accept=".json,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Zuo package file" />
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={expectCounts} onChange={(e) => setExpectCounts(e.target.checked)} />
        Require the reconciled package counts (865 / 803 / 306 / 135 / 296 / 66 / 62 / 226 / 639)
      </label>
      <div className="flex gap-2">
        <button className={btn} disabled={!file || busy} onClick={() => run('dry_run')}>
          Dry run
        </button>
        <button className={btn} disabled={!file || busy} onClick={() => run('commit')}>
          Commit
        </button>
      </div>
      <div aria-live="polite" className="text-xs space-y-1">
        {log.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
      <h4 className="font-medium pt-2">Recent batches</h4>
      <ul className="text-xs space-y-1">
        {(batches ?? []).map((b) => (
          <li key={b._id}>
            {new Date(b.startedAt).toLocaleString()} · {b.mode} · {b.status} · create {b.summary?.create ?? 0}, update {b.summary?.update ?? 0}, unchanged {b.summary?.unchanged ?? 0}, rejected {b.summary?.reject ?? 0}
            {b.error ? ` · ${b.error}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Catalog() {
  const holds = useQuery(api.v2Admin.openHolds, {});
  const pipeline = useQuery(api.v2Admin.pipeline);
  const resolveHold = useMutation(api.v2Admin.resolveHoldAdmin);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <ZuoImport />
      <CatalogMediaReview />
      <div className={card}>
        <h3 className="font-serif text-lg">Publication pipeline</h3>
        {pipeline ? (
          <ul className="text-xs">
            {Object.entries(pipeline).map(([stage, v]) => (
              <li key={stage}>
                {stage}: {v.count}
              </li>
            ))}
          </ul>
        ) : (
          <p>Loading…</p>
        )}
        <p className="text-xs text-earth/60">Products move one stage at a time; each stage checks its gate on the server (docs/production-v2/03 S15).</p>
      </div>
      <div className={card}>
        <h3 className="font-serif text-lg">Cost & policy queue ({holds?.length ?? '…'})</h3>
        <label className="block text-xs">
          Resolution note
          <input className="border border-earth/20 px-2 py-1 w-full" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <ul className="text-xs space-y-1 max-h-96 overflow-auto">
          {(holds ?? []).map((h) => (
            <li key={h._id} className="flex justify-between gap-2">
              <span>
                <b>{h.reason}</b> · {h.product} ({h.sku}/{h.packId}) — {h.detail}
              </span>
              <button className={btn} disabled={note.trim().length < 5} onClick={() => resolveHold({ variantId: h.variantId, reason: h.reason, resolution: note }).then(() => setMsg('Hold resolved'), (e) => setMsg(errText(e)))}>
                Resolve
              </button>
            </li>
          ))}
        </ul>
        <p aria-live="polite">{msg}</p>
      </div>
    </div>
  );
}

function DealerQueue({ route }: { route: 'manual_dealer_zuo' | 'manual_dealer_ashcroft' }) {
  const [selected, setSelected] = useState<Id<'ordSupplierOrders'> | null>(null);
  const rows = useQuery(api.ordFulfillment.dealerQueue, { route });
  const submit = useMutation(api.ordFulfillment.markSubmitted);
  const [po, setPo] = useState<Record<string, string>>({});
  const [cost, setCost] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className={card}>
      <h3 className="font-serif text-lg">{route === 'manual_dealer_zuo' ? 'Zuo' : 'Ashcroft'} dealer orders</h3>
      {(rows ?? []).length === 0 && <p>Nothing queued.</p>}
      {(rows ?? []).map((c) => (
        <div key={c._id} className="border-t border-earth/10 pt-2">
          <p>
            {c.orderNumber} · {c.status} · ship to {c.shippingAddress?.city}, {c.shippingAddress?.state}
          </p>
          <ul className="text-xs">
            {c.items.map((it) => (
              <li key={it.allocationId}>
                {it.supplierSku} × {it.packs} pack(s), {it.pieces} piece(s) — {it.status}
              </li>
            ))}
          </ul>
          <button className={btn} onClick={() => setSelected(selected === c._id ? null : c._id)}>{selected === c._id ? 'Close shipment details' : 'Manage shipments'}</button>
          {selected === c._id && <FulfillmentShipments key={c._id} supplierOrderId={c._id} />}
          {c.status === 'queued' && (
            <div className="flex gap-2">
              <input className="border border-earth/20 px-2 py-1 text-xs" placeholder="Supplier PO" aria-label="Supplier PO" value={po[c._id] ?? ''} onChange={(e) => setPo({ ...po, [c._id]: e.target.value })} />
              <input className="border border-earth/20 px-2 py-1 text-xs w-28" placeholder="Accepted cost $" aria-label="Accepted supplier cost in dollars" inputMode="decimal" value={cost[c._id] ?? ''} onChange={(e) => setCost({ ...cost, [c._id]: e.target.value })} />
              <button className={btn} disabled={!po[c._id] || !/^\d+(\.\d{1,2})?$/.test(cost[c._id] ?? '')} onClick={() => submit({ supplierOrderId: c._id, supplierPo: po[c._id], acceptedCostMinor: dollarsToMinor(cost[c._id], 'half_up') }).then(() => setMsg('Marked as ordered'), (e) => setMsg(errText(e)))}>
                Ordered with supplier
              </button>
            </div>
          )}
        </div>
      ))}
      <p aria-live="polite">{msg}</p>
    </div>
  );
}

function Fulfillment({ finance }: { finance: boolean }) {
  return <div className="space-y-4">
    <DealerQueue route="manual_dealer_zuo" />
    <DealerQueue route="manual_dealer_ashcroft" />
    {finance && <PaidExceptionReview />}
  </div>;
}

function TermsPublisher() {
  const view = useQuery(api.v2Admin.programTermsView);
  const publish = useMutation(api.prgMemberships.publishTerms);
  const [msg, setMsg] = useState<string | null>(null);
  if (!view) return null;
  return (
    <div className={card}>
      <h3 className="font-serif text-lg">Program terms</h3>
      {'missing' in view ? (
        <p className="text-xs">Terms can be published once these are approved in the decision register: {view.missing.join(', ')}.</p>
      ) : (
        <>
          <p className="text-xs">Publishing records a new version (by the hash of the exact text shown on /trade#partner-terms). Members accept the new version on their next enrollment step.</p>
          <div className="flex flex-wrap gap-2">
            {(['creator', 'referral', 'trade', 'privacy'] as const).map((program) => (
              <button
                key={program}
                className={btn}
                onClick={async () => {
                  try {
                    const body = JSON.stringify(view.sections);
                    await publish({ program, title: `${program} terms`, bodyHash: await sha256(body) });
                    setMsg(`Published ${program} terms`);
                  } catch (e) {
                    setMsg(errText(e));
                  }
                }}
              >
                Publish {program} terms
              </button>
            ))}
          </div>
        </>
      )}
      <p aria-live="polite">{msg}</p>
    </div>
  );
}

function Partners() {
  const reviews = useQuery(api.v2Admin.creatorReviews);
  const review = useMutation(api.prgMemberships.reviewCreator);
  const bens = useQuery(api.v2Admin.beneficiaries);
  const runs = useQuery(api.ldgPayouts.adminRuns);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <TermsPublisher />
      <div className={card}>
        <h3 className="font-serif text-lg">Creators awaiting review ({reviews?.length ?? '…'})</h3>
        {(reviews ?? []).map((r) => (
          <div key={r.userId} className="border-t border-earth/10 pt-2 text-xs">
            <p>
              {r.email} · {r.profile?.displayName} · {r.profile?.urls.join(', ')}
            </p>
            <p>Flags: {r.reasons.join('; ')}</p>
            <div className="flex gap-2">
              <button className={btn} onClick={() => review({ userId: r.userId as Id<'users'>, approve: true, note: 'Approved after review' }).then(() => setMsg('Approved'), (e) => setMsg(errText(e)))}>
                Approve
              </button>
              <button className={btn} onClick={() => review({ userId: r.userId as Id<'users'>, approve: false, note: 'Declined after review' }).then(() => setMsg('Declined'), (e) => setMsg(errText(e)))}>
                Decline
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className={card}>
        <h3 className="font-serif text-lg">Partners ({bens?.length ?? '…'})</h3>
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left">Name</th>
              <th>Tier</th>
              <th>Payouts</th>
              <th>Tax</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(bens ?? []).map((b) => (
              <tr key={b.id}>
                <td>{b.name}</td>
                <td className="text-center">{b.tier}</td>
                <td className="text-center">{b.payoutReadiness}</td>
                <td className="text-center">{b.taxReadiness}</td>
                <td className="text-center">{b.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={card}>
        <h3 className="font-serif text-lg">Payout runs</h3>
        {(runs?.runs ?? []).map((r) => (
          <p key={r._id} className="text-xs">
            {r.period} · {r.kind} · {r.status} · eligible {money(r.totals.eligibleMinor)}, reserved {money(r.totals.reservedMinor)}, transferred {money(r.totals.transferredMinor)}, failed {money(r.totals.failedMinor)}, carried {money(r.totals.carriedMinor)}
            {r.abortReason ? ` · ${r.abortReason}` : ''}
          </p>
        ))}
        <h4 className="font-medium pt-2">Bank payouts (observed)</h4>
        {(runs?.bank ?? []).map((b) => (
          <p key={b._id} className="text-xs">
            {b.accountId} · {money(b.amountMinor)} · {b.status}
            {b.failureCode ? ` · ${b.failureCode}` : ''}
          </p>
        ))}
      </div>
      <p aria-live="polite">{msg}</p>
    </div>
  );
}

function IntegrationReadiness() {
  const data = useQuery(api.dlvAccess.integrations, {});
  if (!data) return <p role="status">Loading integration readiness…</p>;
  return <section className={card}>
    <h3 className="font-serif text-lg">Integration readiness</h3>
    <p>Configuration presence does not verify a working connection. Deployments and credential changes use the authorized deployment consoles and release runbook.</p>
    <ul><li>Request gateway: {data.gatewayConfigured ? 'Configured' : 'Missing configuration'}</li>
    <li>Tax provider: {data.taxProviderConfigured ? 'Configured' : 'Missing configuration'}</li>
    <li>Notifications: {data.notificationProviderConfigured ? 'Configured' : 'Missing configuration'}</li></ul>
    <ul>{Object.entries(data.flags).map(([key, enabled]) => <li key={key}>{key}: {enabled ? 'on' : 'off'}</li>)}</ul>
  </section>;
}
export default function CommerceV2Admin() {
  const permissions = useQuery(api.dlvAccess.permissions, {});
  const [selected, setSection] = useState<Section>('delivery');
  if (!permissions) return <p role="status">Checking staff permissions…</p>;
  const sections = SECTIONS.filter(([id]) => permissions.owner ||
    (id === 'delivery' && permissions.support) ||
    ((id === 'decisions' || id === 'fulfillment') && permissions.operations) ||
    (id === 'health' && permissions.finance) ||
    (id === 'integrations' && permissions.engineering));
  if (!sections.length) return <p role="alert">No staff permissions are assigned to this account.</p>;
  const section = sections.some(([id]) => id === selected) ? selected : sections[0][0];
  return (
    <div className="commerce-v2-admin space-y-6">
      <h2 className="font-serif text-3xl text-earth">Commerce operations</h2>
      <nav aria-label="Commerce v2 sections" className="flex flex-wrap gap-2">
        {sections.map(([id, label]) => (
          <button key={id} className={`${btn} ${section === id ? 'bg-earth text-cream' : ''}`} aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>{label}</button>
        ))}
      </nav>
      {section === 'decisions' && <Decisions canApprove={permissions.approver} />}
      {section === 'health' && <Health />}
      {section === 'reviews' && <Reviews />}
      {section === 'catalog' && <Catalog />}
      {section === 'fulfillment' && <Fulfillment finance={permissions.finance} />}
      {section === 'delivery' && <DeliveryOperations />}
      {section === 'partners' && <Partners />}
      {section === 'integrations' && <IntegrationReadiness />}
    </div>
  );
}
