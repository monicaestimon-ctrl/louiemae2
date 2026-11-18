export const smokeRoutes = ['retail-home', 'collection-furniture', 'holm-home'];
export const smokeDevices = [{ name: 'mobile', width: 320 }, { name: 'desktop', width: 1440 }];

/** Synthetic availability only: never describe these checks as Lighthouse or field scores. */
export function assessSmoke(report) {
  const errors = [];
  const commit = report?.expectedCommit;
  if (!/^[a-f0-9]{40}$/.test(commit ?? '') || report.before?.commit !== commit || report.after?.commit !== commit)
    errors.push('Deployment identity did not remain verified');
  const expected = new Set(smokeRoutes.flatMap(route => smokeDevices.map(device => `${route}:${device.name}`)));
  const seen = new Set();
  for (const row of report?.results ?? []) {
    const key = `${row.route}:${row.device}`;
    if (!expected.has(key) || seen.has(key)) errors.push(`Unexpected or duplicate case: ${key}`);
    seen.add(key);
    if (row.status !== 200 || row.sameUrl !== true || row.healthy !== true || row.commands !== 0 ||
        !Array.isArray(row.errors) || row.errors.length || !Array.isArray(row.axe) || row.axe.length)
      errors.push(`Unhealthy case: ${key}`);
  }
  for (const key of expected) if (!seen.has(key)) errors.push(`Missing case: ${key}`);
  return { passed: errors.length === 0, errors, scope: 'Read-only synthetic public health and automated accessibility; not full-spec acceptance' };
}
