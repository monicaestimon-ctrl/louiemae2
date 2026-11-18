import { useState } from 'react';
import { api } from '../../convex/_generated/api';
import { useRecoverableQuery } from '../../contexts/useRecoverableQuery';
import { FIELD_ROUTES, FIELD_MIN_SAMPLES, type FieldRoute } from '../../lib/quality/fieldPolicy';
export default function FieldPerformance() {
  const [route, setRoute] = useState<FieldRoute>('retail-home');
  const [device, setDevice] = useState<'mobile' | 'desktop'>('mobile');
  const [release, setRelease] = useState(
    () => document.querySelector('meta[name="lm-build-commit"]')?.getAttribute('content') || ''
  );
  const valid = /^[a-f0-9]{40}$/.test(release);
  const request = useRecoverableQuery(
    api.qualityTelemetry.summary,
    valid ? { route, device, release } : 'skip'
  );
  const report = request.data;
  return (
    <section className="space-y-4 text-earth" aria-labelledby="field-performance-title">
      <h3 id="field-performance-title" className="font-serif text-2xl">
        Field performance
      </h3>
      <p>
        Optional visitor measurements over the previous 28 days. These are field observations,
        separate from Lighthouse scores. Release labels are reported by the browser and are not
        deployment verification.
      </p>
      <div className="flex flex-wrap gap-4">
        <label>
          Page type
          <select
            className="block border p-2"
            value={route}
            onChange={(event) => setRoute(event.target.value as FieldRoute)}
          >
            {FIELD_ROUTES.map((value) => (
              <option key={value} value={value}>
                {value.replaceAll('-', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Device
          <select
            className="block border p-2"
            value={device}
            onChange={(event) => setDevice(event.target.value as 'mobile' | 'desktop')}
          >
            <option value="mobile">Mobile</option>
            <option value="desktop">Desktop</option>
          </select>
        </label>
        <label className="min-w-0">
          Release commit
          <input
            className="block border p-2 w-full"
            value={release}
            spellCheck={false}
            onChange={(event) => setRelease(event.target.value.trim())}
            aria-invalid={!valid}
            aria-describedby="field-release-help"
          />
        </label>
      </div>
      <p id="field-release-help">
        Enter the full 40-character lowercase commit hash. Changing a filter loads its own
        measurements.
      </p>
      {!valid && <p role="status">Enter a valid release commit to load measurements.</p>}
      {request.status === 'loading' && <p role="status">Loading field measurements…</p>}
      {request.status === 'unavailable' && (
        <div role="alert">
          <p>Field measurements are unavailable. No healthy status can be established.</p>
          <button type="button" className="border p-2" onClick={request.retry}>
            Retry measurements
          </button>
        </div>
      )}
      {report && (
        <>
          <p role="status">
            Collection is {report.enabled ? 'enabled' : 'disabled'}. {report.visits} observed page
            visits. At least {FIELD_MIN_SAMPLES} observations per metric are required for a target
            assessment.
          </p>
          <p>
            Window: {new Date(report.since).toISOString()} through{' '}
            {new Date(report.through).toISOString()}.
          </p>
          {report.retentionBacklog && (
            <p role="alert">
              Expired observations are awaiting cleanup. Engineering should check the hourly
              retention job.
            </p>
          )}
          {report.truncated && (
            <p role="alert">
              The report reached its row limit. It cannot establish a complete-window result.
            </p>
          )}
          {report.collectionLimited && (
            <p role="alert">
              Collection reached a daily limit on {report.limitedDays} days. These observations may
              not represent all opted-in traffic.
            </p>
          )}
          {report.metrics.some((metric) => metric.status === 'above-target') && (
            <p role="alert">
              Field performance exceeds its target:{' '}
              {report.metrics
                .filter((metric) => metric.status === 'above-target')
                .map((metric) => metric.name)
                .join(', ')}
              . Investigate the selected release and device before declaring recovery.
            </p>
          )}
          <div
            className="overflow-x-auto"
            role="region"
            aria-label="Field performance measurements"
            tabIndex={0}
          >
            <table className="w-full text-left">
              <caption>
                75th percentile by metric; absent interaction measurements are not zero.
              </caption>
              <thead>
                <tr>
                  {[
                    'Metric',
                    'Observations',
                    '75th percentile',
                    'Target maximum',
                    'Assessment',
                  ].map((name) => (
                    <th key={name} scope="col" className="p-2">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.metrics.map((metric) => (
                  <tr key={metric.name}>
                    <th scope="row" className="p-2">
                      {metric.name}
                    </th>
                    <td className="p-2">{metric.count}</td>
                    <td className="p-2">
                      {metric.p75 === null
                        ? 'Not measured'
                        : metric.name === 'CLS'
                          ? String(metric.p75)
                          : `${metric.p75} ms`}
                    </td>
                    <td className="p-2">
                      {metric.threshold}
                      {metric.name === 'CLS' ? '' : ' ms'}
                    </td>
                    <td className="p-2">{metric.status.replaceAll('-', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Today: {report.dailyBudget.requests} of {report.dailyBudget.maxRequests} validated
            requests; {report.dailyBudget.visits} of {report.dailyBudget.maxVisits} new visits.
          </p>
          <p>
            Engineering owns investigation of above-target results, collection limits and
            unavailable reports. This screen does not change prices, checkout, inventory or
            deployments.
          </p>
        </>
      )}
    </section>
  );
}
