import { describe, expect, it } from "vitest";
import { parseCjTokenResponse } from "./cjAuth";

describe("CJ token response parsing", () => {
  it("stores the new access and refresh token returned by CJ", () => {
    expect(parseCjTokenResponse({
      result: true,
      data: {
        openId: 123456,
        accessToken: "new-access",
        accessTokenExpiryDate: "2026-09-01T00:00:00Z",
        refreshToken: "new-refresh",
        refreshTokenExpiryDate: "2027-02-01T00:00:00Z",
      },
    })).toEqual({
      ok: true,
      tokens: {
        openId: "123456",
        accessToken: "new-access",
        accessTokenExpiryDate: "2026-09-01T00:00:00Z",
        refreshToken: "new-refresh",
        refreshTokenExpiryDate: "2027-02-01T00:00:00Z",
        createDate: undefined,
      },
    });
  });

  it("uses existing refresh metadata only when CJ omits it", () => {
    const result = parseCjTokenResponse({
      result: true,
      data: {
        accessToken: "new-access",
        accessTokenExpiryDate: "2026-09-01T00:00:00Z",
      },
    }, {
      openId: "open-id",
      refreshToken: "old-refresh",
      refreshTokenExpiryDate: "2027-02-01T00:00:00Z",
    });

    expect(result).toMatchObject({
      ok: true,
      tokens: { openId: "open-id", refreshToken: "old-refresh" },
    });
  });

  it("rejects the obsolete data=true assumption", () => {
    expect(parseCjTokenResponse({ result: true, data: true })).toEqual({
      ok: false,
      message: "CJ authentication returned an unsuccessful response.",
    });
  });

  it("rejects missing authoritative access expiry", () => {
    expect(parseCjTokenResponse({
      result: true,
      data: { accessToken: "new-access", refreshToken: "new-refresh" },
    }, {
      refreshToken: "old-refresh",
      refreshTokenExpiryDate: "2027-02-01T00:00:00Z",
    }).ok).toBe(false);
  });
});
