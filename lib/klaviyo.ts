/* global AbortSignal */
// Server-side only. Never import this module into the storefront.
const BASE = 'https://a.klaviyo.com/api';
const REVISION = '2026-07-15';

export class KlaviyoError extends Error {
  constructor(public status: number, public retryAfterMs = 60000) {
    super(`Klaviyo request failed (${status})`);
  }
}

// Read-only reconciliation, deliberately limited to known local contacts.
// Never treat a missing profile or consent field as permission to resubscribe.
export async function getKlaviyoSuppressedEmails(apiKey: string, emails: string[], request: typeof fetch = fetch): Promise<string[]> {
  if (!emails.length) return [];
  if (emails.length > 20) throw new Error('Consent batch exceeds 20 contacts');
  const params = new URLSearchParams({ filter: `any(email,${emails.map(email => JSON.stringify(email)).join(',')})`,
    'additional-fields[profile]': 'subscriptions', 'page[size]': '100' });
  const response = await request(`${BASE}/profiles?${params}`, {
    headers: { Authorization: `Klaviyo-API-Key ${apiKey}`, revision: REVISION, accept: 'application/vnd.api+json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new KlaviyoError(response.status);
  const body = await response.json();
  if (!Array.isArray(body.data) || body.links?.next) throw new KlaviyoError(502);
  const suppressed: string[] = [];
  for (const profile of body.data) {
    const email = profile.attributes?.email?.toLowerCase();
    const marketing = profile.attributes?.subscriptions?.email?.marketing;
    if (!email || !emails.includes(email) || !marketing) throw new KlaviyoError(502);
    if (marketing.consent === 'UNSUBSCRIBED' || marketing.suppression?.length || marketing.list_suppressions?.length) suppressed.push(email);
  }
  return suppressed;
}

export async function syncKlaviyoWaitlist(input: {
  email: string; listId: string; apiKey: string; unsubscribe: boolean;
  historical: boolean; consentedAt: number;
}, request: typeof fetch = fetch): Promise<'accepted' | 'suppressed'> {
  const call = async (path: string, body?: unknown) => {
    const response = await request(`${BASE}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Klaviyo-API-Key ${input.apiKey}`, revision: REVISION,
        accept: 'application/vnd.api+json', 'content-type': 'application/vnd.api+json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      // Do not propagate provider response bodies: they can contain personal data.
      const retry = response.headers.get('retry-after');
      const seconds = Number(retry);
      const delay = retry && !Number.isFinite(seconds) ? Date.parse(retry) - Date.now() : seconds * 1000;
      throw new KlaviyoError(response.status, Math.max(60000, Number.isFinite(delay) ? delay : 60000));
    }
    return response;
  };

  if (input.unsubscribe) {
    // A local unsubscribe means no Louie Mae marketing, so suppress globally.
    await call('/profile-subscription-bulk-delete-jobs', { data: {
      type: 'profile-subscription-bulk-delete-job',
      attributes: { profiles: { data: [{ type: 'profile', attributes: { email: input.email } }] } },
    } });
    return 'accepted';
  }

  // Subscribe APIs can remove suppressions. Read consent before EVERY attempt,
  // including retries and historical imports, and never override an opt-out.
  const params = new URLSearchParams({ filter: `equals(email,${JSON.stringify(input.email)})`,
    'additional-fields[profile]': 'subscriptions' });
  const response = await call(`/profiles?${params}`);
  const profiles = await response.json();
  if (!Array.isArray(profiles.data)) throw new KlaviyoError(502);
  for (const profile of profiles.data) {
    const marketing = profile.attributes?.subscriptions?.email?.marketing;
    // Fail closed if the requested consent fields were not supplied.
    if (!marketing) throw new KlaviyoError(502);
    if (marketing.consent === 'UNSUBSCRIBED' || marketing.suppression?.length || marketing.list_suppressions?.length) return 'suppressed';
  }
  await call('/profile-subscription-bulk-create-jobs', { data: {
    type: 'profile-subscription-bulk-create-job',
    attributes: {
      custom_source: 'Louie Mae website waitlist',
      historical_import: input.historical,
      profiles: { data: [{ type: 'profile', attributes: {
        email: input.email,
        subscriptions: { email: { marketing: { consent: 'SUBSCRIBED',
          ...(input.historical ? { consented_at: new Date(input.consentedAt).toISOString() } : {}) } } },
      } }] },
    },
    relationships: { list: { data: { type: 'list', id: input.listId } } },
  } });
  // HTTP 202 is an accepted asynchronous request, not proof of final list membership.
  return 'accepted';
}
