import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
    getUserId: vi.fn(),
}));

vi.mock("./auth", () => ({
    auth: { getUserId: authMocks.getUserId },
}));

import { requireCjAdminIdentity } from "./cjAdminAccess";

const makeCtx = (identity: Record<string, unknown> | null, user: Record<string, unknown> | null) => ({
    auth: { getUserIdentity: vi.fn().mockResolvedValue(identity) },
    db: { get: vi.fn().mockResolvedValue(user) },
});

describe("requireCjAdminIdentity", () => {
    const previousCjAdminEmails = process.env.CJ_ADMIN_EMAILS;
    const previousAdminEmails = process.env.ADMIN_EMAILS;

    beforeEach(() => {
        authMocks.getUserId.mockReset();
        authMocks.getUserId.mockResolvedValue("user-1");
        process.env.CJ_ADMIN_EMAILS = "owner@louiemae.com";
        delete process.env.ADMIN_EMAILS;
    });

    afterEach(() => {
        if (previousCjAdminEmails === undefined) delete process.env.CJ_ADMIN_EMAILS;
        else process.env.CJ_ADMIN_EMAILS = previousCjAdminEmails;
        if (previousAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
        else process.env.ADMIN_EMAILS = previousAdminEmails;
    });

    it("uses the Convex Auth user email when the session identity omits it", async () => {
        const ctx = makeCtx({ subject: "user-1" }, { email: "Owner@LouieMae.com" });

        await expect(requireCjAdminIdentity(ctx as never)).resolves.toEqual({
            email: "owner@louiemae.com",
        });
        expect(ctx.db.get).toHaveBeenCalledWith("user-1");
    });

    it("still accepts an allowlisted email supplied by the identity", async () => {
        const ctx = makeCtx({ email: "owner@louiemae.com" }, null);

        await expect(requireCjAdminIdentity(ctx as never)).resolves.toEqual({
            email: "owner@louiemae.com",
        });
    });

    it("rejects an authenticated account outside the admin allowlist", async () => {
        const ctx = makeCtx({}, { email: "viewer@example.com" });

        await expect(requireCjAdminIdentity(ctx as never)).rejects.toThrow(
            "You do not have permission to manage CJ fulfillment.",
        );
    });
});
