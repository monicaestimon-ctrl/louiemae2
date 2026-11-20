export type Observation = {
  durationMs: number;
  path: 'matrix' | 'matrix_tax';
  outcome: 'ok' | 'quote' | 'blocked' | 'error' | 'tax_error' | 'tax_unavailable';
};
export function summarizeObservations(rows: readonly Observation[]) {
  const times = rows.map((r) => r.durationMs).sort((a, b) => a - b);
  const count = (kind: Observation['outcome']) => rows.filter((r) => r.outcome === kind).length;
  const errors = count('error') + count('tax_error');
  return {
    attempts: rows.length,
    successes: count('ok'),
    quotes: count('quote'),
    blocked: count('blocked'),
    errors,
    taxErrors: count('tax_error'),
    taxUnavailable: count('tax_unavailable'),
    errorRateBps: rows.length ? Math.round((errors * 10000) / rows.length) : null,
    p95Ms: times.length ? times[Math.ceil(times.length * 0.95) - 1] : null,
  };
}
