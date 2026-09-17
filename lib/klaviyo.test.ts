import { describe, expect, it, vi } from 'vitest';
import { KlaviyoError, syncKlaviyoWaitlist } from './klaviyo';

const input = { email: 'test@example.com', listId: 'TEST01', apiKey: 'test-key',
  unsubscribe: false, historical: false, consentedAt: Date.UTC(2026, 8, 1) };
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

describe('Klaviyo waitlist consent', () => {
  it('subscribes new profiles to only email marketing and the configured list', async () => {
    const request = vi.fn().mockResolvedValueOnce(json({ data: [] })).mockResolvedValueOnce(new Response(null, { status: 202 }));
    expect(await syncKlaviyoWaitlist(input, request)).toBe('accepted');
    const body = JSON.parse(request.mock.calls[1][1].body);
    expect(body.data.relationships.list.data.id).toBe('TEST01');
    expect(body.data.attributes.profiles.data[0].attributes.subscriptions).toEqual({ email: { marketing: { consent: 'SUBSCRIBED' } } });
    expect(body.data.attributes.historical_import).toBe(false);
  });
  it.each([
    { consent: 'UNSUBSCRIBED' },
    { consent: 'SUBSCRIBED', suppression: [{ reason: 'SPAM_REPORT' }] },
    { consent: 'SUBSCRIBED', list_suppressions: [{ list_id: 'TEST01' }] },
  ])('never removes an existing opt-out: %j', async (marketing) => {
    const request = vi.fn().mockResolvedValue(json({ data: [{ attributes: { subscriptions: { email: { marketing } } } }] }));
    expect(await syncKlaviyoWaitlist(input, request)).toBe('suppressed');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('fails closed when consent cannot be read', async () => {
    const request = vi.fn().mockResolvedValue(json({ data: [{ attributes: {} }] }));
    await expect(syncKlaviyoWaitlist(input, request)).rejects.toThrow(KlaviyoError);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('historical import preserves the recorded consent time', async () => {
    const request = vi.fn().mockResolvedValueOnce(json({ data: [] })).mockResolvedValueOnce(new Response(null, { status: 202 }));
    await syncKlaviyoWaitlist({ ...input, historical: true }, request);
    const attributes = JSON.parse(request.mock.calls[1][1].body).data.attributes;
    expect(attributes.historical_import).toBe(true);
    expect(attributes.profiles.data[0].attributes.subscriptions.email.marketing.consented_at).toBe('2026-09-01T00:00:00.000Z');
  });
  it('propagates local unsubscribes without making a subscription request', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    await syncKlaviyoWaitlist({ ...input, unsubscribe: true }, request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toContain('profile-subscription-bulk-delete-jobs');
  });
  it('preserves Retry-After without exposing provider error bodies', async () => {
    const request = vi.fn().mockResolvedValue(new Response('private subscriber details', { status: 429, headers: { 'retry-after': '120' } }));
    await expect(syncKlaviyoWaitlist(input, request)).rejects.toMatchObject({ status: 429, retryAfterMs: 120000, message: 'Klaviyo request failed (429)' });
  });
});
