import { describe, expect, it } from 'vitest';
import {
  getBatchImportRetryDelayMs,
  isUpstreamRateLimitError,
  MAX_BATCH_IMPORT_ATTEMPTS,
} from './batchImportRetry';

describe('batch import rate-limit retry', () => {
  it('recognizes the 1688 provider rate-limit errors', () => {
    expect(isUpstreamRateLimitError('OTAPI API HTTP 429')).toBe(true);
    expect(isUpstreamRateLimitError('Too many requests')).toBe(true);
    expect(isUpstreamRateLimitError('API rate limit reached')).toBe(true);
    expect(isUpstreamRateLimitError('Invalid URL format')).toBe(false);
  });

  it('backs off exponentially and staggers the three workers', () => {
    expect(getBatchImportRetryDelayMs(1, 0)).toBe(15_000);
    expect(getBatchImportRetryDelayMs(1, 1)).toBe(20_000);
    expect(getBatchImportRetryDelayMs(1, 2)).toBe(25_000);
    expect(getBatchImportRetryDelayMs(2, 0)).toBe(30_000);
    expect(getBatchImportRetryDelayMs(3, 0)).toBe(60_000);
    expect(MAX_BATCH_IMPORT_ATTEMPTS).toBe(4);
  });
});
