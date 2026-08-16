export type CjStoredTokenValues = {
  openId?: string;
  accessToken: string;
  accessTokenExpiryDate: string;
  refreshToken: string;
  refreshTokenExpiryDate: string;
  createDate?: string;
};

type CjTokenFallback = Pick<CjStoredTokenValues, "refreshToken" | "refreshTokenExpiryDate"> & {
  openId?: string;
};

export type CjTokenParseResult =
  | { ok: true; tokens: CjStoredTokenValues }
  | { ok: false; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const normalizedOpenId = (value: unknown): string | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return nonEmptyString(value);
};

export const parseCjTokenResponse = (
  raw: unknown,
  fallback?: CjTokenFallback,
): CjTokenParseResult => {
  if (!isRecord(raw) || raw.result !== true || !isRecord(raw.data)) {
    return { ok: false, message: "CJ authentication returned an unsuccessful response." };
  }

  const accessToken = nonEmptyString(raw.data.accessToken);
  const accessTokenExpiryDate = nonEmptyString(raw.data.accessTokenExpiryDate);
  const refreshToken = nonEmptyString(raw.data.refreshToken) ?? fallback?.refreshToken;
  const refreshTokenExpiryDate = nonEmptyString(raw.data.refreshTokenExpiryDate)
    ?? fallback?.refreshTokenExpiryDate;

  if (!accessToken || !accessTokenExpiryDate || !refreshToken || !refreshTokenExpiryDate) {
    return { ok: false, message: "CJ authentication response is missing token fields or expiry dates." };
  }

  return {
    ok: true,
    tokens: {
      openId: normalizedOpenId(raw.data.openId) ?? fallback?.openId,
      accessToken,
      accessTokenExpiryDate,
      refreshToken,
      refreshTokenExpiryDate,
      createDate: nonEmptyString(raw.data.createDate),
    },
  };
};
