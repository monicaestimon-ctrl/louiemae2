export const normalizeProductImportUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return `https://${trimmed}`;
};

/**
 * Extracts URLs pasted from Notes, messages, or a line-separated list.
 * Keeping this deliberately permissive lets 1688 share links pass through to
 * the server, where redirects are resolved safely before product extraction.
 */
export const parseProductImportUrls = (value: string): string[] => {
  const candidates = value
    .split(/[\s,]+/)
    .map(normalizeProductImportUrl)
    .filter(Boolean);

  return [...new Set(candidates)];
};
