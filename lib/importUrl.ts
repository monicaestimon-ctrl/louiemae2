export const normalizeProductImportUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return `https://${trimmed}`;
};

export const extract1688ProductId = (value: string): string | null => {
  try {
    const url = new URL(normalizeProductImportUrl(value));
    const hostname = url.hostname.toLowerCase();
    if (hostname !== '1688.com' && !hostname.endsWith('.1688.com')) return null;

    const pathMatch = url.pathname.match(/\/offer\/(?:offer_detail-)?(\d+)(?:\.html)?(?:\/|$)/i);
    if (pathMatch) return pathMatch[1];

    for (const key of ['offerId', 'itemId', 'offer_id']) {
      const candidate = url.searchParams.get(key);
      if (candidate && /^\d+$/.test(candidate)) return candidate;
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Extracts URLs pasted from Notes, messages, or a line-separated list.
 * Keeping this deliberately permissive lets 1688 share links pass through to
 * the server, where redirects are resolved safely before product extraction.
 */
export const parseProductImportUrls = (value: string): string[] => {
  const startsLikeUrl = (candidate: string): boolean =>
    /^(?:https?:\/\/|\/\/|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#]|$))/i.test(candidate.trim());

  // Notes and messaging apps sometimes insert a hard line-wrap in the middle
  // of a long encoded query string. Treat a line that does not start like a
  // URL as a continuation of the preceding URL instead of inventing a new one.
  const rawCandidates: string[] = [];
  for (const line of value.replace(/\r\n?/g, '\n').split('\n')) {
    const fragments = line
      .trim()
      .split(/(?:,\s*|\s+)(?=(?:https?:\/\/|\/\/|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#]|$)))/i)
      .map(fragment => fragment.trim())
      .filter(Boolean);

    for (const fragment of fragments) {
      if (startsLikeUrl(fragment) || rawCandidates.length === 0) {
        rawCandidates.push(fragment);
      } else {
        rawCandidates[rawCandidates.length - 1] += fragment.replace(/\s+/g, '');
      }
    }
  }

  const candidates = rawCandidates.map(normalizeProductImportUrl).filter(Boolean);

  return [...new Set(candidates)];
};
