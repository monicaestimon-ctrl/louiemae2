import { parseDecimal } from './decimal';
import { CommerceError } from './errors';
import type { Availability } from './catFreshness';

export type StockEvidence = {
  warehouseId: string | null;
  warehouseFingerprint: string;
  quantity: string | null;
  unitBasis: 'piece' | 'pack' | 'piece_or_pack' | 'unknown';
  kind: 'available_to_sell' | 'on_hand' | 'binary' | 'unknown';
  availability: Availability;
  confirmed: boolean;
  provisionalAcceptance?: { sourceObservationId: string; authorizationRef: string };
  piecesPerPack: number;
  observedAt: number;
  validUntil?: number;
};
export function stockQuantity(value: string | null) {
  if (value === null) return null;
  if (!/^\d{1,7}(\.\d{1,9})?$/.test(value))
    throw new CommerceError('INVALID_INPUT', 'Use a nonnegative whole stock quantity');
  const n = parseDecimal(value);
  if (n.d !== 1n || n.n > 1_000_000n)
    throw new CommerceError(
      'INVALID_INPUT',
      'Stock quantity must be a whole count up to 1,000,000'
    );
  return Number(n.n);
}
export function stockView(
  source: StockEvidence | null,
  warehouseId: string | undefined,
  piecesPerPack: number,
  now: number,
  maxAgeMs: number,
  minimumPacks = 1,
  warehouseFingerprint?: string
) {
  const provisional = !!source?.provisionalAcceptance?.sourceObservationId
    && !!source.provisionalAcceptance.authorizationRef.trim()
    && !source.confirmed && source.kind === 'on_hand' && source.unitBasis === 'piece';
  const unknown = {
    availability: 'unknown' as Availability,
    availablePacks: null as number | null,
    automatic: false,
    current: false,
    observedAt: undefined as number | undefined,
  };
  if (
    !Number.isSafeInteger(piecesPerPack) ||
    piecesPerPack < 1 ||
    !Number.isSafeInteger(minimumPacks) ||
    minimumPacks < 1 ||
    !source ||
    (!source.confirmed && !provisional) ||
    !warehouseId ||
    source.warehouseId !== warehouseId ||
    !source.warehouseFingerprint ||
    source.warehouseFingerprint !== warehouseFingerprint ||
    source.piecesPerPack !== piecesPerPack ||
    !Number.isSafeInteger(source.observedAt) ||
    source.observedAt <= 0 ||
    source.observedAt > now ||
    now - source.observedAt > maxAgeMs ||
    (source.validUntil !== undefined &&
      (!Number.isSafeInteger(source.validUntil) || source.validUntil <= now))
  )
    return unknown;
  let quantity: number | null;
  try {
    quantity = stockQuantity(source.quantity);
  } catch {
    return unknown;
  }
  const basisKnown =
    source.unitBasis === 'piece' ||
    source.unitBasis === 'pack' ||
    (source.unitBasis === 'piece_or_pack' && piecesPerPack === 1);
  const packs =
    quantity === null || !basisKnown
      ? null
      : source.unitBasis === 'pack'
        ? quantity
        : Math.floor(quantity / piecesPerPack);
  const current = source.kind !== 'unknown' && (source.kind === 'binary' || packs !== null);
  let availability = current ? source.availability : ('unknown' as Availability);
  if (availability === 'in_stock' && packs !== null && packs < minimumPacks)
    availability = 'out_of_stock';
  // Retain on-hand provenance. Only a separately recorded owner acceptance permits
  // its provisional use; this does not claim a supplier-guaranteed allocation.
  return {
    availability,
    availablePacks: packs,
    automatic: current && (source.kind === 'available_to_sell' || provisional) && availability === 'in_stock',
    current,
    observedAt: source.observedAt,
  };
}
