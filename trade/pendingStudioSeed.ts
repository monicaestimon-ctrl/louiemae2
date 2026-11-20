import { useState } from 'react';

const key = 'hol:pending-studio';
let recoveryUnavailable = false;
type Seed = Record<string, unknown> | null;

export function readPendingStudioSeed(): Seed {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (record.version !== 1 || !record.seed || typeof record.seed !== 'object' || Array.isArray(record.seed)) {
      sessionStorage.removeItem(key);
      return null;
    }
    return record.seed;
  } catch { return null; }
}

export function savePendingStudioSeed(seed: Seed) {
  try {
    if (seed === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify({ version: 1, seed }));
    recoveryUnavailable = false;
  } catch {
    recoveryUnavailable = seed !== null;
    try { sessionStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
  }
}

export function usePendingStudioSeed() {
  const [seed, update] = useState<Seed>(readPendingStudioSeed);
  return [seed, (next: Seed) => { savePendingStudioSeed(next); update(next); }] as const;
}

export function reloadEditor() {
  if (recoveryUnavailable && !window.confirm('The pending Studio selection or uploaded photo could not be saved on this device. Reloading will discard it. Reload anyway?')) return;
  window.location.reload();
}
