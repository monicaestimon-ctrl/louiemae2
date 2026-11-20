// Shipment classification (spec S16, v2 §10). Ground versus LTL versus quote-only comes from
// each carton's own measurements against a versioned carrier rule; size class alone is never
// enough, dimensions are never averaged, and supplier-marked LTL is never downgraded.

export type CarrierRule = {
  carrier: string;
  service: string;
  effectiveFrom: number;
  effectiveTo?: number;
  /** Cubic millimetres per billable gram (dimensional divisor converted to metric). */
  dimDivisorMm3PerG: number;
  ground: {
    maxLongestMm: number;
    maxLengthPlusGirthMm: number;
    maxWeightG: number;
    maxBillableWeightG?: number;
  };
  /** Above these, LTL still works if every carton fits a pallet; otherwise quote. */
  ltl: { maxLongestMm: number; maxWeightG: number; maxCartons: number };
};

export type CartonIn = {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  grossWeightG: number;
  supplierMethod: 'ground' | 'ltl' | 'unknown';
};

export type CartonMetrics = {
  longestMm: number;
  girthMm: number;
  lengthPlusGirthMm: number;
  volumeMm3: number;
  actualG: number;
  dimG: number;
  billableG: number;
};

export function cartonMetrics(
  c: CartonIn,
  rule: Pick<CarrierRule, 'dimDivisorMm3PerG'>
): CartonMetrics {
  if (
    ![c.lengthMm, c.widthMm, c.heightMm, c.grossWeightG, rule.dimDivisorMm3PerG].every(
      (n) => Number.isFinite(n) && n > 0
    )
  )
    throw new Error('Positive carton measurements and dimensional divisor required');
  const dims = [c.lengthMm, c.widthMm, c.heightMm].sort((a, b) => b - a);
  const girthMm = 2 * (dims[1] + dims[2]);
  const volumeMm3 = dims[0] * dims[1] * dims[2];
  if (!Number.isSafeInteger(volumeMm3)) throw new Error('Carton volume exceeds safe bounds');
  const dimG = Math.ceil(volumeMm3 / rule.dimDivisorMm3PerG);
  return {
    longestMm: dims[0],
    girthMm,
    lengthPlusGirthMm: dims[0] + girthMm,
    volumeMm3,
    actualG: c.grossWeightG,
    dimG,
    billableG: Math.max(c.grossWeightG, dimG),
  };
}

export type Classification = {
  mode: 'ground' | 'ltl' | 'quote';
  reasons: string[];
  cartons: CartonMetrics[];
  billableG: number;
};

/** Classifies a shipment group's cartons. Truckload, unknown inputs and oversize beyond LTL are quote-only. */
export function classify(
  cartons: readonly CartonIn[],
  rule: CarrierRule,
  opts: { quoteOnly?: boolean } = {}
): Classification {
  const reasons: string[] = [];
  if (!cartons.length)
    return { mode: 'quote', reasons: ['carton data missing'], cartons: [], billableG: 0 };
  if (
    cartons.length > 500 ||
    !Number.isFinite(rule.dimDivisorMm3PerG) ||
    rule.dimDivisorMm3PerG <= 0 ||
    cartons.some(
      (c) =>
        ![c.lengthMm, c.widthMm, c.heightMm, c.grossWeightG].every(
          (n) => Number.isSafeInteger(n) && n > 0
        ) || !Number.isSafeInteger(c.lengthMm * c.widthMm * c.heightMm)
    )
  )
    return {
      mode: 'quote',
      reasons: ['invalid or excessive carton data'],
      cartons: [],
      billableG: 0,
    };
  const metrics = cartons.map((c) => cartonMetrics(c, rule));
  const billableG = metrics.reduce((t, m) => t + m.billableG, 0);
  if (cartons.some((c) => c.supplierMethod === 'unknown'))
    return {
      mode: 'quote',
      reasons: ['supplier shipping method requires confirmation'],
      cartons: metrics,
      billableG,
    };
  if (opts.quoteOnly)
    return {
      mode: 'quote',
      reasons: ['quote-only destination or service'],
      cartons: metrics,
      billableG,
    };
  const bad = cartons.some(
    (c) =>
      ![c.lengthMm, c.widthMm, c.heightMm, c.grossWeightG].every((n) => Number.isFinite(n) && n > 0)
  );
  if (bad)
    return {
      mode: 'quote',
      reasons: ['carton dimensions or weight missing'],
      cartons: metrics,
      billableG,
    };
  const supplierLtl = cartons.some((c) => c.supplierMethod === 'ltl');
  const groundFails = metrics.flatMap((m, i) => {
    const r: string[] = [];
    if (m.longestMm > rule.ground.maxLongestMm)
      r.push(`carton ${i + 1} longest side over ground limit`);
    if (m.lengthPlusGirthMm > rule.ground.maxLengthPlusGirthMm)
      r.push(`carton ${i + 1} length plus girth over ground limit`);
    if (m.actualG > rule.ground.maxWeightG) r.push(`carton ${i + 1} weight over ground limit`);
    if (rule.ground.maxBillableWeightG && m.billableG > rule.ground.maxBillableWeightG)
      r.push(`carton ${i + 1} billable weight over ground limit`);
    return r;
  });
  if (!supplierLtl && !groundFails.length)
    return { mode: 'ground', reasons, cartons: metrics, billableG };
  if (supplierLtl) reasons.push('supplier ships this item LTL (never downgraded)');
  reasons.push(...groundFails);
  const ltlFails =
    metrics.some((m) => m.longestMm > rule.ltl.maxLongestMm || m.actualG > rule.ltl.maxWeightG) ||
    cartons.length > rule.ltl.maxCartons;
  if (ltlFails)
    return {
      mode: 'quote',
      reasons: [...reasons, 'beyond automatic LTL limits (truckload or oversize quote)'],
      cartons: metrics,
      billableG,
    };
  return { mode: 'ltl', reasons, cartons: metrics, billableG };
}
