// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ATTRIBUTION_MS, activeRef, captureRefFromUrl, normalizeCode, pieceShareUrl, rememberRef, shareOrigin, visitorId } from './partnerLink';
import { partnerQuery } from '../api/og';

const go = (path: string) => window.history.replaceState(null, '', path);
const partner = () => vi.fn().mockResolvedValue(true);
const notAPartner = () => vi.fn().mockResolvedValue(false);

beforeEach(() => {
  localStorage.clear();
  go('/');
});

describe('partner links in the browser', () => {
  it('saves a confirmed code, reports the visit and clears the address bar', async () => {
    go('/collection/furniture?ref=mae1234&ch=pin#collection/furniture');
    const record = partner();
    const got = await captureRefFromUrl(record, 'site:/collection/furniture');
    expect(got?.code).toBe('MAE1234');
    expect(record).toHaveBeenCalledWith({ refCode: 'MAE1234', channel: 'pin', target: 'site:/collection/furniture', visitorId: visitorId() });
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#collection/furniture');
    expect(activeRef()?.code).toBe('MAE1234');
  });

  it('reads a code written after the hash route, and keeps the route’s own filters', async () => {
    go('/#collection/kids?cat=Girls&ref=MAE1234&ch=story');
    expect((await captureRefFromUrl(partner(), 'site:/'))?.code).toBe('MAE1234');
    expect(window.location.hash).toBe('#collection/kids?cat=Girls');
  });

  it('leaves the address alone when the visitor moved on before the visit was confirmed', async () => {
    go('/?ref=MAE1234#shop');
    const record = vi.fn(async () => {
      go('/#collection/kids');
      return true;
    });
    expect((await captureRefFromUrl(record, 'site:/'))?.code).toBe('MAE1234');
    expect(window.location.hash).toBe('#collection/kids');
    expect(window.location.search).toBe('');
  });

  it('never lets an unknown ?ref= replace a real partner’s code, and leaves that tag alone', async () => {
    rememberRef('PARTNERA', 'pin');
    go('/?utm_source=mail&ref=newsletter');
    expect(await captureRefFromUrl(notAPartner(), 'site:/')).toBeNull();
    expect(activeRef()?.code).toBe('PARTNERA');
    expect(window.location.search).toBe('?utm_source=mail&ref=newsletter');
  });

  it('ignores malformed codes without calling the server', async () => {
    go('/?ref=!!');
    const record = partner();
    expect(await captureRefFromUrl(record, 'site:/')).toBeNull();
    expect(record).not.toHaveBeenCalled();
  });

  it('keeps nothing when the visit can’t be confirmed', async () => {
    go('/?ref=MAE1234');
    expect(await captureRefFromUrl(vi.fn().mockRejectedValue(new Error('offline')), 'site:/')).toBeNull();
    expect(activeRef()).toBeNull();
  });

  it('shares one saved code and visitor id with /trade', () => {
    rememberRef('house42', 'link');
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

  it('builds piece links on louiemae.com with the code only when there is one', () => {
    expect(shareOrigin()).toBe('https://www.louiemae.com'); // jsdom runs on localhost
    expect(pieceShareUrl('https://www.louiemae.com', 7, 'MAE1234', 'pin')).toBe('https://www.louiemae.com/trade?ref=MAE1234&ch=pin#p/7');
    expect(pieceShareUrl('https://www.louiemae.com', 7, null)).toBe('https://www.louiemae.com/trade#p/7');
    expect(normalizeCode(' mae-12 34 ')).toBe('MAE1234');
    expect(normalizeCode('abc')).toBe('');
  });
});

describe('shared-page redirect (api/og)', () => {
  it('passes a well-formed partner code on to the app', () => {
    expect(partnerQuery({ ref: 'mae1234', ch: 'pin' })).toBe('?ref=MAE1234&ch=pin');
    expect(partnerQuery({ ref: 'MAE1234' })).toBe('?ref=MAE1234');
  });

  it('drops anything that could reach the page as markup', () => {
    for (const ref of ['"><script>', "x');alert(1)//", '<img src=x>'])
      expect(partnerQuery({ ref, ch: 'pin' })).toMatch(/^(\?ref=[A-Z0-9]{4,16}&ch=pin)?$/);
    expect(partnerQuery({ ref: '!!' })).toBe('');
    expect(partnerQuery({ ref: 'MAE1234', ch: '"><b>' })).toBe('?ref=MAE1234');
    expect(partnerQuery({})).toBe('');
  });
});
