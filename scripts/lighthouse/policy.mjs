export const categories = ['performance', 'accessibility', 'best-practices', 'seo'];

export function assessRun(lhr, health, expected) {
  const errors = [];
  if (!health?.ok || health.url !== expected.url) errors.push('Healthy route content was not verified');
  if (lhr.runtimeError) errors.push(`Lighthouse runtime error: ${lhr.runtimeError.code}`);
  if (lhr.lighthouseVersion !== '13.6.0') errors.push('Unexpected Lighthouse version');
  if (lhr.finalDisplayedUrl !== expected.url) errors.push('Unexpected final URL');
  if (lhr.configSettings?.formFactor !== expected.device) errors.push('Unexpected device profile');
  if (lhr.audits?.['errors-in-console']?.score !== 1) errors.push('Browser console errors or missing audit');
  const scores = {};
  for (const category of categories) {
    const raw = lhr.categories?.[category]?.score;
    if (!Number.isFinite(raw) || raw < 0 || raw > 1) errors.push(`Missing/invalid ${category} score`);
    else scores[category] = { raw, displayed: Math.round(raw * 100) };
  }
  return { valid: errors.length === 0, errors, scores };
}

export function assessBatch(runs) {
  const errors = [];
  if (runs.length !== 5) errors.push('Release requires exactly five retained runs per route/device');
  if (runs.some(run => !run.valid)) errors.push('One or more runs failed health or integrity validation');
  for (const category of categories.slice(1)) {
    if (runs.some(run => run.scores[category]?.raw !== 1)) errors.push(`${category} must be 100 in every run`);
  }
  const performance = runs.map(run => run.scores.performance?.displayed ?? 0).sort((a, b) => a - b);
  if (performance.filter(score => score === 100).length < 4 || performance.some(score => score < 98)) {
    errors.push('Performance requires four scores of 100 and no score below 98');
  }
  return { passed: errors.length === 0, errors, runs };
}
