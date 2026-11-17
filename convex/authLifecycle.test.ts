// @vitest-environment node
/// <reference types="vite/client" />
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { decodeJwt } from 'jose';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api } from './_generated/api';
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
afterEach(() => vi.unstubAllEnvs());
it('preserves password identity across sign-in and refresh and invalidates the signed-out session', async () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  vi.stubEnv('JWT_PRIVATE_KEY', keys.privateKey);
  vi.stubEnv('CONVEX_SITE_URL', 'https://auth-fixture.invalid');
  const t = convexTest(schema, modules);
  const params = { email: 'auth-fixture@example.test', password: 'fixture-password-for-isolated-test' };
  const signup = await t.action(api.auth.signIn, { provider: 'password', params: { ...params, flow: 'signUp' } });
  expect(signup.tokens?.token).toBeTruthy();
  const subject = decodeJwt(signup.tokens!.token).sub!;
  const userId = subject.split('|')[0];
  await expect(t.action(api.auth.signIn, { provider: 'password', params: { ...params, password: 'incorrect-fixture-password', flow: 'signIn' } })).rejects.toThrow();
  const signin = await t.action(api.auth.signIn, { provider: 'password', params: { ...params, flow: 'signIn' } });
  expect(decodeJwt(signin.tokens!.token).sub!.split('|')[0]).toBe(userId);
  const refreshed = await t.action(api.auth.signIn, { refreshToken: signin.tokens!.refreshToken });
  expect(refreshed.tokens?.token).toBeTruthy();
  const currentSubject = decodeJwt(refreshed.tokens!.token).sub!;
  const viewer = t.withIdentity({ subject: currentSubject });
  expect(await viewer.query(api.auth.isAuthenticated, {})).toBe(true);
  await viewer.action(api.auth.signOut, {});
  await t.run(async ctx => {
    const sessionId = ctx.db.normalizeId('authSessions', currentSubject.split('|')[1]);
    expect(sessionId && await ctx.db.get(sessionId)).toBeNull();
    expect(await ctx.db.query('users').collect()).toHaveLength(1);
  });
  const afterLogout = await t.action(api.auth.signIn, { refreshToken: refreshed.tokens!.refreshToken });
  expect(afterLogout.tokens).toBeNull();
});
