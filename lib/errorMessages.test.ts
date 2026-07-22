import { describe, expect, it } from 'vitest';
import { getUserFacingErrorMessage } from './errorMessages';

describe('getUserFacingErrorMessage', () => {
  it('prefers structured ConvexError data messages', () => {
    const message = getUserFacingErrorMessage({
      message: '[CONVEX A(scraper:scrapeProduct)] Server Error Called by client',
      data: {
        code: 'UNSUPPORTED_DOMAIN',
        message: 'Domain not supported for scraping: "example.com". Only known storefronts are allowed.',
      },
    });

    expect(message).toBe('Domain not supported for scraping: "example.com". Only known storefronts are allowed.');
  });

  it('hides generic Convex wrappers when no structured detail is present', () => {
    expect(
      getUserFacingErrorMessage(
        new Error('[CONVEX A(scraper:scrapeProduct)] [Request ID: abc] Server Error Called by client'),
        'Import failed. Please try a different link.',
      ),
    ).toBe('Import failed. Please try a different link.');
  });

  it('cleans ConvexError prefixes from message strings', () => {
    expect(getUserFacingErrorMessage('Uncaught ConvexError: OTAPI request timed out after 30s')).toBe(
      'OTAPI request timed out after 30s',
    );
  });

  it('extracts the message from serialized Convex errors stored by batch jobs', () => {
    expect(getUserFacingErrorMessage(
      'Uncaught ConvexError: {"code":"SCRAPE_FAILED","message":"This 1688 QR share link is expired."} at handler (../convex/scraper.ts:300:54)',
    )).toBe('This 1688 QR share link is expired.');
  });

  it('handles plain objects with message fields', () => {
    expect(getUserFacingErrorMessage({ message: 'Failed to load page: HTTP 403 Forbidden' })).toBe(
      'Failed to load page: HTTP 403 Forbidden',
    );
  });
});
