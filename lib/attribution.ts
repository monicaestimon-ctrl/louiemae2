// Attribution v2 (spec S27, v2 §16). Pure: last eligible click within an exact 30×24h window
// wins; direct visits never overwrite; expiry is exclusive; ties break deterministically.
export const ATTRIBUTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type ClickView = { clickId: string; beneficiaryId: string; eligible: boolean; at: number; expiresAt: number };

/** The winning click at `now`: eligible, at ≤ now < expiresAt, latest `at`, ties by clickId. */
export function winningClick<T extends ClickView>(clicks: readonly T[], now: number): T | null {
  let best: T | null = null;
  for (const c of clicks) {
    if (!c.eligible || c.at > now || now >= c.expiresAt) continue;
    if (!best || c.at > best.at || (c.at === best.at && c.clickId > best.clickId)) best = c;
  }
  return best;
}

const BOT_UA = /(bot|crawler|spider|crawling|preview|facebookexternalhit|slackbot|twitterbot|linkedinbot|whatsapp|discordbot|headless|lighthouse|curl|wget|python-requests|httpclient)/i;
export const looksLikeBot = (userAgent: string) => !userAgent.trim() || BOT_UA.test(userAgent);

/** Opaque ids for links and clicks (base32, unguessable). */
export function opaqueId(bytes = 10): string {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes)), (b) => abc[b % abc.length]).join('');
}

/** A stable, non-reversible key for a browser's visitor id (raw ids are never stored). */
export async function visitorKeyHash(visitorKey: string): Promise<string> {
  const d = await globalThis.crypto.subtle.digest('SHA-256', new globalThis.TextEncoder().encode(`lm-visitor:${visitorKey}`));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Applied rate per line: the higher of the click-time protected rate and the current eligible rate. */
export const appliedRate = (protectedBps: number | null, currentBps: number) => Math.max(protectedBps ?? 0, currentBps);
