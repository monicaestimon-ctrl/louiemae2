// Creator enrollment checks and safe redirects (spec S24, S25, v2 §14). Automated basic abuse
// checks only flag for human review; they never block silently or merge identities.

const DISPOSABLE = new Set([
  'mailinator.com',
  'guerrillamail.com',
  '10minutemail.com',
  'tempmail.com',
  'temp-mail.org',
  'yopmail.com',
  'trashmail.com',
  'sharklasers.com',
  'getnada.com',
  'dispostable.com',
  'maildrop.cc',
]);
const BAD_HOSTS = /(^|\.)((localhost)|(example\.(com|org|net))|(bit\.ly)|(tinyurl\.com))$/i;

/** Field-keyed validation shared by enrollment feedback and the existing server policy. */
export function profileFieldProblems(p: { displayName: string; urls: string[] }): {
  name: string[];
  urls: string[];
} {
  const name: string[] = [];
  const urls: string[] = [];
  if (p.displayName.trim().length < 2 || p.displayName.length > 80)
    name.push('Add your name or handle (2–80 characters).');
  if (!p.urls.length) urls.push('Add at least one social profile or website.');
  if (p.urls.length > 5) urls.push('Add up to five links.');
  for (const raw of p.urls) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      urls.push(`"${raw.slice(0, 60)}" is not a web address.`);
      continue;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:')
      urls.push(`"${raw.slice(0, 60)}" must be a web link.`);
  }
  return { name, urls };
}
/** Preserve the server's ordered problem list while exposing field associations to the UI. */
export function profileProblems(p: { displayName: string; urls: string[] }): string[] {
  const errors = profileFieldProblems(p);
  return [...errors.name, ...errors.urls];
}

/** Reasons to send a creator to manual review instead of activating automatically. */
export function abuseFlags(input: {
  email: string;
  urls: string[];
  duplicatePayoutIdentity: boolean;
  recentEnrollmentsFromSameDomain: number;
}): string[] {
  const flags: string[] = [];
  const domain = input.email.split('@')[1]?.toLowerCase() ?? '';
  if (!domain || DISPOSABLE.has(domain)) flags.push('disposable or missing email domain');
  for (const raw of input.urls) {
    try {
      const h = new URL(raw).hostname;
      if (BAD_HOSTS.test(h) || /^\d+\.\d+\.\d+\.\d+$/.test(h))
        flags.push(`link host needs review: ${h}`);
    } catch {
      flags.push('invalid link');
    }
  }
  if (input.duplicatePayoutIdentity) flags.push('payout identity matches another account');
  if (input.recentEnrollmentsFromSameDomain >= 5)
    flags.push('many recent enrollments from the same email domain');
  return flags;
}

const REDIRECT_PATHS = [/^\/$/, /^\/trade(\/|$)/, /^\/#/, /^\/r\/[a-z0-9]{8,24}$/];

/** Only same-site, allowlisted paths are valid redirect targets (no open redirects). */
export function safeRedirect(target: string | null | undefined, fallback = '/'): string {
  if (!target || typeof target !== 'string') return fallback;
  if (!target.startsWith('/') || target.startsWith('//') || /[\\\s]/.test(target)) return fallback;
  return REDIRECT_PATHS.some((re) => re.test(target)) ? target : fallback;
}
