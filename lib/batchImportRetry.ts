export const MAX_BATCH_IMPORT_ATTEMPTS = 4;

export const isUpstreamRateLimitError = (message: string): boolean =>
  /(?:\b429\b|too many requests|rate[ -]?limit(?:ed| reached)?)/i.test(message);

/**
 * Exponential backoff plus a stable per-item offset keeps the three workers
 * from retrying the same provider in lockstep.
 */
export const getBatchImportRetryDelayMs = (attempts: number, position: number): number => {
  const exponent = Math.max(0, Math.min(attempts - 1, 3));
  const backoff = 15_000 * (2 ** exponent);
  const workerOffset = Math.abs(position % 3) * 5_000;
  return backoff + workerOffset;
};
