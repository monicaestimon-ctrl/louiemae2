import React from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';

export default function DeliveryMonitoring() {
  const report = useQuery(api.dlvTelemetry.report, {});
  if (!report) return <p>Loading delivery observations…</p>;
  return (
    <section className="space-y-2 border p-3">
      <h4>Delivery monitoring · last {report.windowMinutes} minutes</h4>
      <p>
        {report.summary.attempts} observed requests · {report.summary.successes} successful ·{' '}
        {report.summary.quotes} expected quotes · {report.summary.blocked} blocked ·{' '}
        {report.summary.errors} operational errors · {report.summary.taxUnavailable} awaiting tax
        confirmation
      </p>
      <p>
        Latest sample:{' '}
        {report.latestSampleAt === null
          ? 'No observations yet'
          : new Date(report.latestSampleAt).toLocaleString()}
        . Checked {new Date(report.checkedAt).toLocaleString()}.
      </p>
      <p>
        {report.alertsEnabled
          ? `Alerts enabled · approved policy v${report.policyVersion}`
          : 'Automated delivery alerts are not enabled. Approve monitoring settings and enable background monitoring before pilot activation.'}
      </p>
      {(report.truncated || report.breakdownTruncated) && (
        <p role="status">
          This report reached its sample or breakdown limit. It does not represent the full traffic
          window.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr>
              <th>Calculation path</th>
              <th>Requests</th>
              <th>p95 latency</th>
              <th>Error rate</th>
            </tr>
          </thead>
          <tbody>
            {report.paths.map((p) => (
              <tr key={p.path}>
                <td>
                  {p.path === 'matrix_tax'
                    ? 'Matrix + tax provider'
                    : 'Matrix / existing tax result'}
                </td>
                <td>{p.attempts}</td>
                <td>{p.p95Ms === null ? 'No samples' : `${p.p95Ms} ms`}</td>
                <td>
                  {p.errorRateBps === null ? 'No samples' : `${(p.errorRateBps / 100).toFixed(2)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs">{report.note}</p>
      <details>
        <summary>Supplier, origin, zone, mode and service</summary>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th>Supplier / origin</th>
                <th>Zone / mode / service</th>
                <th>Requests</th>
                <th>p95</th>
              </tr>
            </thead>
            <tbody>
              {report.breakdown.map((r) => (
                <tr key={JSON.stringify([r.supplier, r.origin, r.zone, r.mode, r.service])}>
                  <td>
                    {r.supplier} / {r.origin}
                  </td>
                  <td>
                    {r.zone} / {r.mode} / {r.service}
                  </td>
                  <td>{r.attempts}</td>
                  <td>{r.p95Ms ?? 'No sample'} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <details>
        <summary>Blocked requests and staff follow-up</summary>
        {report.blocks.map((b) => (
          <p key={b.code}>
            {b.code}: {b.count}
          </p>
        ))}
        {report.overdue.map((r) => (
          <p key={r.status}>
            {r.status.replaceAll('_', ' ')}: {r.count}
            {r.capped ? '+' : ''} overdue
          </p>
        ))}
        {!report.policy && <p>Quote response target is awaiting approval.</p>}
      </details>
    </section>
  );
}
