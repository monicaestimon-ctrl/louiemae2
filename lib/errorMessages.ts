type ErrorLike = {
  message?: unknown;
  data?: unknown;
};

const cleanConvexPrefix = (message: string): string => {
  return message
    .replace(/^Uncaught ConvexError:\s*/i, '')
    .replace(/^Uncaught Error:\s*/i, '')
    .replace(/\s+Called by client\s*$/i, '')
    .trim();
};

const isGenericConvexWrapper = (message: string): boolean => {
  return /\[CONVEX\s+/i.test(message) && /\bServer Error\b/i.test(message);
};

const extractMessageFromData = (data: unknown): string | undefined => {
  if (!data) return undefined;
  if (typeof data === 'string') return data;
  if (typeof data !== 'object') return undefined;

  const record = data as Record<string, unknown>;
  if (typeof record.message === 'string' && record.message.trim()) return record.message;
  if (typeof record.error === 'string' && record.error.trim()) return record.error;
  if (record.error && typeof record.error === 'object') {
    return extractMessageFromData(record.error);
  }
  return undefined;
};

export const getUserFacingErrorMessage = (
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): string => {
  const errorLike = error as ErrorLike;
  const dataMessage = extractMessageFromData(errorLike?.data);
  if (dataMessage) return cleanConvexPrefix(dataMessage);

  if (error instanceof Error && error.message.trim()) {
    return isGenericConvexWrapper(error.message) ? fallback : cleanConvexPrefix(error.message);
  }

  if (typeof error === 'string' && error.trim()) {
    return isGenericConvexWrapper(error) ? fallback : cleanConvexPrefix(error);
  }

  if (errorLike?.message && typeof errorLike.message === 'string' && errorLike.message.trim()) {
    return isGenericConvexWrapper(errorLike.message) ? fallback : cleanConvexPrefix(errorLike.message);
  }

  return fallback;
};
