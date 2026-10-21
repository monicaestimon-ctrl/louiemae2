// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { linkOrCreateUser } from './authLinking';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const google = (email: string, emailVerified = true) => ({
  existingUserId: null,
  type: 'oauth',
  providerId: 'google',
  profile: { email, name: 'Ama Owusu', image: 'https://lh3.example/a.jpg', emailVerified },
});

async function passwordUser(t: ReturnType<typeof convexTest>, email: string) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { email });
    await ctx.db.insert('authAccounts', { userId, provider: 'password', providerAccountId: email, secret: 'hash' });
    const sessionId = await ctx.db.insert('authSessions', { userId, expirationTime: Date.now() + 1e6 });
    await ctx.db.insert('authRefreshTokens', { sessionId, expirationTime: Date.now() + 1e6 });
    return userId;
  });
}

describe('Google sign-in account linking', () => {
  it('joins a verified Google email to the existing password account and retires the password', async () => {
    const t = convexTest(schema, modules);
    const existing = await passwordUser(t, 'ama@studio.com');
    const id = await t.run((ctx) => linkOrCreateUser(ctx, google('Ama@Studio.com')));
    expect(id).toBe(existing);
    await t.run(async (ctx) => {
      const user = await ctx.db.get(existing);
      expect(user?.emailVerificationTime).toBeTypeOf('number');
      expect(user?.name).toBe('Ama Owusu');
      expect(await ctx.db.query('authAccounts').collect()).toHaveLength(0);
      expect(await ctx.db.query('authSessions').collect()).toHaveLength(0);
      expect(await ctx.db.query('authRefreshTokens').collect()).toHaveLength(0);
    });
  });

  it('does not link when Google has not verified the email', async () => {
    const t = convexTest(schema, modules);
    const existing = await passwordUser(t, 'ama@studio.com');
    const id = await t.run((ctx) => linkOrCreateUser(ctx, google('ama@studio.com', false)));
    expect(id).not.toBe(existing);
    await t.run(async (ctx) => {
      expect(await ctx.db.query('authAccounts').collect()).toHaveLength(1);
      expect((await ctx.db.get(id))?.emailVerificationTime).toBeUndefined();
    });
  });

  it('keeps the password of an account that is already verified', async () => {
    const t = convexTest(schema, modules);
    const existing = await passwordUser(t, 'ama@studio.com');
    await t.run((ctx) => ctx.db.patch(existing, { emailVerificationTime: 1 }));
    expect(await t.run((ctx) => linkOrCreateUser(ctx, google('ama@studio.com')))).toBe(existing);
    await t.run(async (ctx) => {
      expect(await ctx.db.query('authAccounts').collect()).toHaveLength(1);
    });
  });

  it('creates a new user for password sign-ups and new Google emails', async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) =>
      linkOrCreateUser(ctx, { existingUserId: null, type: 'credentials', providerId: 'password', profile: { email: 'new@studio.com' } })
    );
    const b = await t.run((ctx) => linkOrCreateUser(ctx, google('other@studio.com')));
    expect(a).not.toBe(b);
    await t.run(async (ctx) => {
      expect((await ctx.db.get(a))?.emailVerificationTime).toBeUndefined();
      expect((await ctx.db.get(b))?.emailVerificationTime).toBeTypeOf('number');
    });
  });

  it('returns the existing user for a returning account', async () => {
    const t = convexTest(schema, modules);
    const existing = await passwordUser(t, 'ama@studio.com');
    const id = await t.run((ctx) =>
      linkOrCreateUser(ctx, { existingUserId: existing, type: 'credentials', providerId: 'password', profile: { email: 'ama@studio.com' } })
    );
    expect(id).toBe(existing);
  });
});
