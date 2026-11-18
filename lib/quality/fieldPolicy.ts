/** Document-scoped, opt-in performance samples. No URLs, account IDs or attribution data. */
export const FIELD_ROUTES = [
  'retail-home',
  'retail-shop',
  'retail-story',
  'retail-journal',
  'retail-article',
  'retail-collection',
  'retail-product',
  'holm-home',
] as const;
export type FieldRoute = (typeof FIELD_ROUTES)[number];
export type FieldMetric = 'LCP' | 'CLS' | 'INP';
export type FieldSample = { name: FieldMetric; value: number; revision: number };
export type FieldBatch = {
  version: 1;
  documentToken: string;
  release: string;
  route: FieldRoute;
  device: 'mobile' | 'desktop';
  samples: FieldSample[];
};
export const FIELD_MIN_SAMPLES = 50;
export const FIELD_MAX_BATCH_BYTES = 2048;
export const FIELD_RETENTION_DAYS = 28;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
const metric = (value: unknown): value is FieldMetric =>
  value === 'LCP' || value === 'CLS' || value === 'INP';
export function validMetricValue(name: FieldMetric, value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= (name === 'CLS' ? 100 : 600_000)
  );
}

/** Only path patterns are inspected; never send the path or its identifying suffix. */
export function fieldRoute(pathname: string, hash = ''): FieldRoute | null {
  // Hash-based account/project screens are not public page samples. Never transmit the hash.
  if (hash && hash !== '#') return null;
  if (pathname === '/') return 'retail-home';
  if (pathname === '/shop' || pathname === '/shop/') return 'retail-shop';
  if (pathname === '/story' || pathname === '/story/') return 'retail-story';
  if (pathname === '/blog' || pathname === '/blog/') return 'retail-journal';
  if (/^\/blog\/[a-z0-9_-]+\/?$/i.test(pathname)) return 'retail-article';
  if (/^\/collection\/(?:furniture|decor|fashion|kids)\/?$/.test(pathname))
    return 'retail-collection';
  if (/^\/products\/[a-z0-9_-]+\/?$/i.test(pathname)) return 'retail-product';
  if (pathname === '/trade' || pathname === '/trade/') return 'holm-home';
  return null;
}

/** Reject the entire payload rather than silently discarding an accidentally added private field. */
export function parseFieldBatch(value: unknown): FieldBatch | null {
  if (
    !record(value) ||
    !exactKeys(value, ['version', 'documentToken', 'release', 'route', 'device', 'samples']) ||
    value.version !== 1
  )
    return null;
  if (typeof value.documentToken !== 'string' || !/^[a-f0-9]{32}$/.test(value.documentToken))
    return null;
  if (typeof value.release !== 'string' || !/^[a-f0-9]{40}$/.test(value.release)) return null;
  if (
    !(FIELD_ROUTES as readonly unknown[]).includes(value.route) ||
    (value.device !== 'mobile' && value.device !== 'desktop')
  )
    return null;
  if (!Array.isArray(value.samples) || value.samples.length < 1 || value.samples.length > 3)
    return null;
  const names = new Set<string>();
  const samples: FieldSample[] = [];
  for (const item of value.samples) {
    if (
      !record(item) ||
      !exactKeys(item, ['name', 'value', 'revision']) ||
      !metric(item.name) ||
      !validMetricValue(item.name, item.value)
    )
      return null;
    if (
      !Number.isSafeInteger(item.revision) ||
      (item.revision as number) < 1 ||
      (item.revision as number) > 100
    )
      return null;
    if (names.has(item.name)) return null;
    names.add(item.name);
    samples.push({ name: item.name, value: item.value, revision: item.revision as number });
  }
  return {
    version: 1,
    documentToken: value.documentToken,
    release: value.release,
    route: value.route as FieldRoute,
    device: value.device as 'mobile' | 'desktop',
    samples,
  };
}

/** One latest observation per document and metric; duplicates and reordered deliveries do not add samples. */
export function replaceFieldSample(
  previous: FieldSample | undefined,
  incoming: FieldSample
): FieldSample {
  if (!previous) return incoming;
  if (previous.name !== incoming.name) throw new Error('Metric identity mismatch');
  return incoming.revision > previous.revision ? incoming : previous;
}

/** Exact nearest-rank p75 for bounded, already deduplicated observations. Missing INP is not zero. */
export function summarizeFieldMetric(
  name: FieldMetric,
  values: readonly number[],
  truncated = false
) {
  if (values.some((value) => !validMetricValue(name, value)))
    throw new Error('Invalid field observation');
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const p75 = count ? sorted[Math.ceil(count * 0.75) - 1] : null;
  const threshold = name === 'LCP' ? 2500 : name === 'INP' ? 200 : 0.1;
  const status = truncated
    ? 'truncated'
    : count < FIELD_MIN_SAMPLES
      ? 'insufficient-data'
      : p75! <= threshold
        ? 'within-target'
        : 'above-target';
  return { name, count, p75, threshold, status, truncated };
}
