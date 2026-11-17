import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from '../../api/og';
function request(path: unknown, extra: Record<string, unknown> = {}) {
  const headers: Record<string, string> = {};
  const response = { status: vi.fn().mockReturnThis(), send: vi.fn(), redirect: vi.fn(), setHeader: (key: string, value: string) => { headers[key] = value; } };
  handler({ query: { path, ...extra } } as unknown as VercelRequest, response as unknown as VercelResponse);
  return { ...response, headers };
}
afterEach(() => vi.unstubAllEnvs());
describe('metadata route boundary', () => {
  it.each(['"><script>alert(1)</script>', '</script><script>alert(1)</script>', '__proto__', 'constructor', 'unknown', ['shop', 'story']])('rejects unrecognized input without reflecting it: %j', path => {
    vi.stubEnv('VITE_PRELAUNCH_MODE', 'false');
    const result = request(path);
    expect(result.status).toHaveBeenCalledWith(404);
    expect(result.headers['Cache-Control']).toBe('no-store');
    expect(result.headers['X-Robots-Tag']).toBe('noindex');
    const html = result.send.mock.calls[0][0] as string;
    expect(html).toContain('<h1>Page not found</h1>');
    expect(html).not.toContain('<script>');
    expect(result.redirect).not.toHaveBeenCalled();
  });
  it.each(['', 'story', 'blog', 'shop', 'collection/furniture', 'collection/decor', 'collection/fashion', 'collection/kids', 'collection/seasonal-pieces'])('preserves known route and referral destination: %s', path => {
    vi.stubEnv('VITE_PRELAUNCH_MODE', 'false');
    const result = request(path, { ref: 'mae1234', ch: 'pin' });
    expect(result.status).toHaveBeenCalledWith(200);
    const html = result.send.mock.calls[0][0] as string;
    expect(html).toContain(`https://www.louiemae.com/?ref=MAE1234&ch=pin#${path}`);
    expect(html).toContain(`rel="canonical" href="https://www.louiemae.com/${path}"`);
  });
  it('keeps prelaunch referral redirects independent of untrusted paths', () => {
    vi.stubEnv('VITE_PRELAUNCH_MODE', 'true');
    const result = request('<script>bad</script>', { ref: 'mae1234' });
    expect(result.redirect).toHaveBeenCalledWith(307, '/?ref=MAE1234');
    expect(result.send).not.toHaveBeenCalled();
  });
});


