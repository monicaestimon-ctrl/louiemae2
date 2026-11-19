import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import { readFieldRequest } from '../lib/quality/fieldRequest';
const origins = new Set(['https://louiemae.com', 'https://www.louiemae.com']);
function allowed(request: Request) {
  const origin = request.headers.get('origin');
  return origin && origins.has(origin) ? origin : null;
}
function reply(status: number, origin: string | null, code?: string) {
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  if (code) headers['Content-Type'] = 'application/json';
  return new Response(code ? JSON.stringify({ status: code }) : null, { status, headers });
}
function credentials(request: Request) {
  return request.headers.has('authorization') || request.headers.has('cookie');
}
export const qualityConfig = httpAction(async (_ctx, request) => {
  const origin = allowed(request);
  if (request.headers.has('origin') && !origin) return reply(403, null, 'forbidden');
  if (credentials(request)) return reply(400, origin, 'anonymous_only');
  return new Response(JSON.stringify({ enabled: process.env.FIELD_QUALITY_ENABLED === 'true' }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      'X-Content-Type-Options': 'nosniff',
      ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    },
  });
});
export const qualityOptions = httpAction(async (_ctx, request) => {
  const origin = allowed(request);
  if (!origin) return reply(403, null, 'forbidden');
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '300',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
    },
  });
});
export const qualityRecord = httpAction(async (ctx, request) => {
  const origin = allowed(request);
  if (!origin) return reply(403, null, 'forbidden');
  if (credentials(request)) return reply(400, origin, 'anonymous_only');
  if (process.env.FIELD_QUALITY_ENABLED !== 'true') return reply(503, origin, 'disabled');
  const batch = await readFieldRequest(request);
  if (!batch) return reply(400, origin, 'invalid');
  try {
    const result = await ctx.runMutation(internal.qualityTelemetry.record, {
      payload: JSON.stringify(batch),
    });
    if (result.status === 'recorded' || result.status === 'duplicate') return reply(204, origin);
    return reply(
      result.status === 'limited'
        ? 429
        : result.status === 'invalid' || result.status === 'conflict'
          ? 400
          : 503,
      origin,
      result.status === 'limited'
        ? 'limited'
        : result.status === 'disabled'
          ? 'disabled'
          : 'unavailable'
    );
  } catch {
    return reply(503, origin, 'unavailable');
  }
});
