import DeliveryMonitoring from './DeliveryMonitoring';
import CatalogCostEvidence from './CatalogCostEvidence';
import React, { useState } from 'react';
import { useConvex, useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { customerMessage } from '../../lib/errors';

export default function DeliveryDiagnostics() {
  const [costVariant, setCostVariant] = useState<Id<'catVariants'> | null>(null);
  const calibration = useQuery(api.dlvAdmin.calibration, {});
  const coverage = useQuery(api.dlvAdmin.coverage, {}),
    client = useConvex(),
    simulate = useMutation(api.dlvAdmin.scenarios);
  const { results, status, loadMore } = usePaginatedQuery(
    api.dlvAdmin.records,
    {},
    { initialNumItems: 20 }
  );
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [estimateId, setEstimateId] = useState(''),
    [details, setDetails] = useState<unknown>(null);
  const [lines, setLines] = useState('[]'),
    [zips, setZips] = useState('95206,85001,10001,99501,96813'),
    [channel, setChannel] = useState<'retail' | 'trade'>('retail');
  const [previewProposed, setPreviewProposed] = useState(false),
    [service, setService] = useState('curbside');
  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (e) {
      setMessage(customerMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 border p-4 text-sm">
      <h3>Readiness, coverage and scenario records</h3>
      <DeliveryMonitoring />
      <p>
        Carrier evidence: {coverage?.carrierEvidence ?? 'Not configured'} ·{' '}
        {coverage?.carrierCurrent ? 'Current' : 'Review required'} · Address-tax policy:{' '}
        {coverage?.taxApproved ? 'Approved' : 'Awaiting approval'}
      </p>
      <p>{coverage?.note}</p>
      <p>Alaska and Hawaii: confirmed quote required.</p>
      <details>
        <summary>50-state coverage scope</summary>
        <div className="grid sm:grid-cols-2 gap-1">
          {coverage?.states.map((s) => (
            <p key={s.state}>
              {s.state}: {s.status}
            </p>
          ))}
        </div>
      </details>
      <details>
        <summary>Invoice calibration sample</summary>
        <pre className="text-xs overflow-auto max-h-96">{JSON.stringify(calibration, null, 2)}</pre>
      </details>
      <details>
        <summary>Configured delivery tiers and ZIP lanes</summary>
        <p>
          {coverage?.ladder?.tiersMinor.map((n) => `$${(n / 100).toFixed(2)}`).join(' · ') ??
            'No approved ladder'}
        </p>
        <table>
          <thead>
            <tr>
              <th>ZIP prefix</th>
              <th>Zone</th>
              <th>Enabled</th>
            </tr>
          </thead>
          <tbody>
            {coverage?.lanes.map((l) => (
              <tr key={l.prefix}>
                <td>{l.prefix}</td>
                <td>{l.zone}</td>
                <td>{l.enabled ? 'Pilot lane' : 'Quote only'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <h4>Variant readiness ({results.length} loaded)</h4>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th>SKU / name</th>
              <th>Retail / trade per pack</th>
              <th>Pieces / cartons</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.variantId}>
                <td>
                  <button
                    className="underline text-left"
                    onClick={() =>
                      setLines(
                        JSON.stringify(
                          [
                            {
                              productId: r.productId,
                              variantId: r.variantId,
                              packs: r.minimumPacks,
                            },
                          ],
                          null,
                          2
                        )
                      )
                    }
                  >
                    {r.sku} · {r.louieMaeName}
                  </button>
                </td>
                <td>
                  {r.retailPackMinor === null
                    ? 'Unknown'
                    : `$${(r.retailPackMinor / 100).toFixed(2)}`}{' '}
                  /{' '}
                  {r.tradePackMinor === null
                    ? 'Unknown'
                    : `$${(r.tradePackMinor / 100).toFixed(2)}`}
                </td>
                <td>
                  {r.piecesPerPack} / {r.cartons.reduce((n, c) => n + c.cartonsPerPack, 0)}
                </td>
                <td>
                  {r.holds.join(', ') || r.availability}
                  <button className="block underline" onClick={() => setCostVariant(r.variantId)}>
                    Review cost evidence
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {status === 'CanLoadMore' && <button onClick={() => loadMore(20)}>Load next variants</button>}
      {costVariant && <CatalogCostEvidence key={costVariant} variantId={costVariant} />}
      <button
        disabled={busy}
        onClick={() =>
          action(async () => {
            let cursor: string | null = null;
            const rows = [];
            for (;;) {
              const page = await client.query(api.dlvAdmin.records, {
                paginationOpts: { cursor, numItems: 20 },
              });
              rows.push(...page.page);
              setMessage(`Exporting ${rows.length} variants…`);
              if (page.isDone) break;
              cursor = page.continueCursor;
            }
            const url = URL.createObjectURL(
              new Blob(
                [
                  JSON.stringify(
                    { exportedAt: new Date().toISOString(), internal: true, rows },
                    null,
                    2
                  ),
                ],
                { type: 'application/json' }
              )
            );
            const a = document.createElement('a');
            a.href = url;
            a.download = `delivery-pricing-records-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
            setMessage(`Exported ${rows.length} internal records.`);
          })
        }
      >
        Export all internal pricing/source records
      </button>
      <details>
        <summary>Compare an actual basket across ZIPs</summary>
        <p>
          Select a variant above to start. These are nonpayable simulations using approved settings;
          tax is finalized only with an address.
        </p>
        <label>
          Basket (variant IDs and pack quantities)
          <textarea
            className="block border p-2 w-full font-mono"
            value={lines}
            onChange={(e) => setLines(e.target.value)}
          />
        </label>
        <label>
          ZIPs, separated by commas
          <input
            className="block border p-2 w-full"
            value={zips}
            onChange={(e) => setZips(e.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={previewProposed}
            onChange={(e) => setPreviewProposed(e.target.checked)}
          />
          Preview proposed freight, ladder and lane controls where available (never payable)
        </label>
        <label>
          Service
          <input
            className="block border p-2"
            value={service}
            onChange={(e) => setService(e.target.value)}
          />
        </label>
        <select
          aria-label="Pricing channel"
          value={channel}
          onChange={(e) => setChannel(e.target.value as 'retail' | 'trade')}
        >
          <option value="retail">Retail</option>
          <option value="trade">Trade</option>
        </select>
        <button
          disabled={busy}
          onClick={() =>
            action(async () =>
              setDetails(
                await simulate({
                  lines: JSON.parse(lines),
                  channel,
                  zips: zips.split(',').map((s) => s.trim()),
                  service,
                  previewProposed,
                })
              )
            )
          }
        >
          Compare scenarios
        </button>
      </details>
      <label>
        Stored estimate ID
        <input
          className="block border p-2 w-full"
          value={estimateId}
          onChange={(e) => setEstimateId(e.target.value)}
        />
      </label>
      <button
        disabled={busy || !estimateId.trim()}
        onClick={() =>
          action(async () =>
            setDetails(
              await client.query(api.dlvOperations.explain, {
                estimateId: estimateId.trim() as Id<'dlvEstimates'>,
              })
            )
          )
        }
      >
        Inspect estimate and source versions
      </button>
      {details !== null && (
        <pre className="text-xs overflow-auto max-h-96">{JSON.stringify(details, null, 2)}</pre>
      )}
      <p role="status">{message}</p>
    </section>
  );
}

export function DeliveryTaxCertificates() {
  const rows = useQuery(api.dlvTaxExemptions.list, {}),
    verify = useMutation(api.dlvTaxExemptions.verify),
    revoke = useMutation(api.dlvTaxExemptions.revoke);
  const [org, setOrg] = useState(''),
    [states, setStates] = useState(''),
    [evidence, setEvidence] = useState(''),
    [until, setUntil] = useState(''),
    [message, setMessage] = useState('');
  return (
    <details className="border p-4">
      <summary>Verified trade tax exemptions</summary>
      <p>
        Use the verified organization ID, reviewed certificate evidence, authorized destination
        states and certificate expiry. Customer checkboxes do not grant exemption.
      </p>
      <label>
        Organization ID
        <input className="block border p-2" value={org} onChange={(e) => setOrg(e.target.value)} />
      </label>
      <label>
        State codes, comma-separated
        <input
          className="block border p-2"
          value={states}
          onChange={(e) => setStates(e.target.value.toUpperCase())}
        />
      </label>
      <label>
        Certificate evidence
        <input
          className="block border p-2"
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
        />
      </label>
      <label>
        Expires at (local time)
        <input
          className="block border p-2"
          type="datetime-local"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
        />
      </label>
      <button
        onClick={async () => {
          try {
            await verify({
              organizationId: org.trim() as Id<'prgOrganizations'>,
              states: states.split(',').map((s) => s.trim()),
              evidence,
              validFrom: Date.now(),
              validUntil: new Date(until).getTime(),
            });
            setMessage('Verified exemption recorded.');
          } catch (e) {
            setMessage(customerMessage(e));
          }
        }}
      >
        Record reviewed certificate
      </button>
      {rows?.map((r) => (
        <p key={r._id}>
          {r.organizationId} · {r.states.join(', ')} · {r.status} · until{' '}
          {new Date(r.validUntil).toLocaleDateString()}{' '}
          {r.status === 'verified' && (
            <button
              disabled={!evidence.trim()}
              onClick={() =>
                revoke({ id: r._id, reason: evidence }).then(
                  () => setMessage('Revoked.'),
                  (e) => setMessage(customerMessage(e))
                )
              }
            >
              Revoke using evidence note
            </button>
          )}
        </p>
      ))}
      <p role="status">{message}</p>
    </details>
  );
}

export function DeliveryTaxReporting() {
  const queue = useQuery(api.dlvTax.reportingQueue, {}),
    record = useMutation(api.dlvTax.recordAdjustment);
  const [orderId, setOrder] = useState(''),
    [kind, setKind] = useState<'sale' | 'refund'>('refund'),
    [reference, setReference] = useState(''),
    [refund, setRefund] = useState('0'),
    [tax, setTax] = useState('0'),
    [evidence, setEvidence] = useState(''),
    [message, setMessage] = useState('');
  return (
    <details className="border p-4 space-y-2">
      <summary>Tax reporting and refund reconciliation</summary>
      <p>
        Complete the tax transaction or reversal with the provider using the original address and
        refunded lines. Record its evidence here. This action does not issue a payment, refund or
        tax API call. Amounts below are integer cents; refund and tax amounts are cumulative for the
        order.
      </p>
      <pre className="text-xs overflow-auto max-h-64">{JSON.stringify(queue, null, 2)}</pre>
      <label>
        Paid order ID
        <input
          className="block border p-2"
          value={orderId}
          onChange={(e) => setOrder(e.target.value)}
        />
      </label>
      <label>
        Record type
        <select value={kind} onChange={(e) => setKind(e.target.value as 'sale' | 'refund')}>
          <option value="refund">Refund reversal</option>
          <option value="sale">Sale reporting</option>
        </select>
      </label>
      <label>
        Provider tax transaction reference
        <input
          className="block border p-2"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
      </label>
      <label>
        Cumulative verified cash refund (cents; zero for a sale)
        <input
          type="number"
          min="0"
          step="1"
          className="block border p-2"
          value={refund}
          onChange={(e) => setRefund(e.target.value)}
        />
      </label>
      <label>
        Cumulative tax reversed / sale tax (cents)
        <input
          type="number"
          min="0"
          step="1"
          className="block border p-2"
          value={tax}
          onChange={(e) => setTax(e.target.value)}
        />
      </label>
      <label>
        Reviewed provider evidence
        <input
          className="block border p-2"
          maxLength={2000}
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
        />
      </label>
      <button
        onClick={async () => {
          try {
            await record({
              orderId: orderId.trim() as Id<'ordOrders'>,
              kind,
              providerRef: reference.trim(),
              cumulativeRefundMinor: Number(refund),
              taxMinor: Number(tax),
              evidence,
            });
            setMessage('Tax evidence recorded. No customer payment was changed.');
          } catch (e) {
            setMessage(customerMessage(e));
          }
        }}
      >
        Record completed tax reconciliation
      </button>
      <p role="status">{message}</p>
    </details>
  );
}
