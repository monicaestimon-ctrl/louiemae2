import type { VercelRequest, VercelResponse } from '@vercel/node';

/** Deliberately independent of catalog, authentication and application JavaScript. */
export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const allowed = req.method === 'GET' || req.method === 'HEAD';
  if (!allowed) res.setHeader('Allow', 'GET, HEAD');
  const title = allowed ? 'Page not found' : 'Method not allowed';
  return res.status(allowed ? 404 : 405).send(req.method === 'HEAD' ? '' : `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${title} | Louie Mae</title>
<style>body{margin:0;background:#f8f5ef;color:#3e3029;font-family:Georgia,serif}main{max-width:42rem;margin:12vh auto;padding:2rem}h1{font-weight:400;font-size:clamp(2rem,6vw,3.5rem)}p{font:1.125rem/1.7 system-ui,sans-serif}a{color:inherit;text-underline-offset:.25em}a:focus-visible{outline:3px solid currentColor;outline-offset:6px}nav{display:flex;flex-wrap:wrap;gap:1.5rem;margin-top:2rem}nav a{padding:.75rem 0;font:1rem/1.5 system-ui,sans-serif}</style>
</head><body><main><p>Louie Mae</p><h1>${title}</h1><p>${allowed ? 'This page may have moved or is no longer available.' : 'Please use a link below to continue browsing.'}</p><nav aria-label="Continue browsing"><a href="/">Return home</a><a href="/shop">Explore collections</a></nav></main></body></html>`);
}
