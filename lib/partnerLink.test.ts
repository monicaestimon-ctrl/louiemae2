// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ATTRIBUTION_MS, activeRef, captureRefFromUrl, normalizeCode, pieceShareUrl, rememberRef, visitorId } from './partnerLink';

const go = (path: string) => window.history.replaceState(null, '', path);

beforeEach(() => {
  localStorage.clear();
  go('/');
});

describe('partner links in the browser', () => {
  it('saves the code, reports the visit and clears the address bar', () => {
    go('/collection/furniture?ref=mae1234&ch=pin#collection/furniture');
    const record = vi.fn().mockResolvedValue(undefined);
    const got = captureRefFromUrl(record, 'site:/collection/furniture');
    expect(got?.code).toBe('MAE1234');
    expect(record).toHaveBeenCalledWith({ refCode: 'MAE1234', channel: 'pin', target: 'site:/collection/furniture', visitorId: visitorId() });
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#collection/furniture');
    expect(activeRef()?.code).toBe('MAE1234');
  });

  it('keeps other query parameters and ignores malformed codes', () => {
    go('/?utm_source=ig&ref=!!&ch=story');
    const record = vi.fn();
    expect(captureRefFromUrl(record, 'site:/')).toBeNull();
    expect(record).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?utm_source=ig');
    expect(activeRef()).toBeNull();
  });

  it('shares one saved code and visitor id with /trade', () => {
    rememberRef('HOUSE42', 'link');
    // /trade reads the same keys (hol:ref, hol:visitor) through these helpers
    expect(JSON.parse(localStorage.getItem('hol:ref')!).code).toBe('HOUSE42');
    const id = visitorId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(visitorId()).toBe(id);
  });

  it('forgets a code after 30 days', () => {
    rememberRef('HOUSE42', 'link', 1_000);
    expect(activeRef(1_000 + ATTRIBUTION_MS - 1)?.code).toBe('HOUSE42');
    expect(activeRef(1_000 + ATTRIBUTION_MS)).toBeNull();
  });

  it('builds piece links with the code only when there is one', () => {
    expect(pieceShareUrl('https://louiemae.com', 7, 'MAE1234', 'pin')).toBe('https://louiemae.com/trade?ref=MAE1234&ch=pin#p/7');
    expect(pieceShareUrl('https://louiemae.com', 7, null)).toBe('https://louiemae.com/trade#p/7');
    expect(normalizeCode(' mae-12 34 ')).toBe('MAE1234');
    expect(normalizeCode('abc')).toBe('');
  });
});
