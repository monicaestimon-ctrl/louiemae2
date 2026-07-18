export type BatchImportErrorLike = {
  normalizedUrl?: string;
  inputUrl?: string;
  error?: string;
  status?: string;
};

const getCandidateUrls = (item: BatchImportErrorLike): string[] =>
  [item.normalizedUrl, item.inputUrl].filter((value): value is string => Boolean(value));

export const isLegacyWrappedUrlFragment = (url: string): boolean => {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (/^https?:\/\/[A-F0-9]{2}%/i.test(trimmed)) return true;
  return /%$/.test(trimmed);
};

export const isObsoleteBatchImportError = (item: BatchImportErrorLike): boolean => {
  if (item.status && item.status !== "error") return false;
  const urls = getCandidateUrls(item);
  if (!urls.some(isLegacyWrappedUrlFragment)) return false;

  const error = item.error || "";
  return (
    /Invalid URL format/i.test(error) ||
    /Invalid IP address: undefined/i.test(error) ||
    /SCRAPE_FAILED/i.test(error) ||
    /INVALID_URL/i.test(error)
  );
};
