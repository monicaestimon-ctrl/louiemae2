// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { CommerceError } from '../errors';
import { verifyRequest } from './requestProof';
import handler from '../../api/delivery';
const mock = vi.hoisted(() => ({ action: vi.fn(), auth: vi.fn() }));
vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    action = mock.action;
    setAuth = mock.auth;
  },
}));
const input = {
  lines: [{ productId: 'fixture', variantId: 'fixture', packs: 1 }],
  channel: 'retail',
  zip: '95206',
  visitorKey: 'fixture',
};
const headers = {
  host: 'louiemae.com',
  origin: 'https://louiemae.com',
  'content-type': 'application/json',
  'x-vercel-forwarded-for': '192.0.2.1',
};
async function call(overrides: Record<string, unknown> = {}) {
  const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  await handler(
    {
      method: 'POST',
      headers,
      body: { operation: 'estimate', input },
      ...overrides,
    } as unknown as VercelRequest,
    res as unknown as VercelResponse
  );
  return res;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('DELIVERY_REQUEST_SECRET', '1'.repeat(64));
  vi.stubEnv('VITE_CONVEX_URL', 'https://fixture.convex.cloud');
  mock.action.mockResolvedValue({ estimateId: 'fixture' });
});
afterEach(() => vi.unstubAllEnvs());
describe('delivery server gateway', () => {
  it('signs the exact input, forwards account authentication and never returns the proof or IP', async () => {
    const res = await call({ headers: { ...headers, authorization: 'Bearer fixture.jwt.token' } });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mock.auth).toHaveBeenCalledWith('fixture.jwt.token');
    const { proof, ...body } = mock.action.mock.calls[0][1];
    expect(await verifyRequest('1'.repeat(64), 'estimate', body, proof, Date.now())).toBe(true);
    expect(JSON.stringify(proof)).not.toContain('192.0.2.1');
    expect(res.json).toHaveBeenCalledWith({ result: { estimateId: 'fixture' } });
  });
  it('rejects cross-origin, unsupported, oversized and forged-proof inputs before backend work', async () => {
    for (const overrides of [
      { headers: { ...headers, origin: 'https://untrusted.example' } },
      { headers: { ...headers, 'content-type': 'text/plain' } },
      { body: { operation: 'estimate', input: { ...input, proof: {} } } },
      { body: { operation: 'estimate', input, padding: 'x'.repeat(65536) } },
      { body: { operation: 'cancel', input } },
    ]) {
      const res = await call(overrides);
      expect(res.status.mock.calls[0][0]).toBeGreaterThanOrEqual(400);
    }
    expect(mock.action).not.toHaveBeenCalled();
  });
  it('fails closed without trusted host context and returns safe limit/provider errors', async () => {
    const missing = await call({
      headers: { ...headers, 'x-vercel-forwarded-for': undefined, 'x-forwarded-for': '192.0.2.1' },
    });
    expect(missing.status).toHaveBeenCalledWith(503);
    expect(mock.action).not.toHaveBeenCalled();
    mock.action.mockRejectedValueOnce(new CommerceError('RATE_LIMITED', 'private detail'));
    const limited = await call();
    expect(limited.status).toHaveBeenCalledWith(429);
    expect(limited.setHeader).toHaveBeenCalledWith('Retry-After', '60');
    mock.action.mockRejectedValueOnce(new Error('provider secret'));
    const failed = await call();
    expect(failed.status).toHaveBeenCalledWith(503);
    expect(JSON.stringify(failed.json.mock.calls)).not.toMatch(/provider secret|private detail/);
  });
});
