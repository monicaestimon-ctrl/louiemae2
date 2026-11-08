import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { ConvexHttpClient } from 'convex/browser';
import type { FunctionArgs } from 'convex/server';
import { api } from '../convex/_generated/api.js';
import { signRequest } from '../lib/delivery/requestProof.js';
import { DELIVERY_BODY_BYTES } from '../lib/delivery/requestBounds.js';
import { CommerceError } from '../lib/errors.js';
import { publicDeliveryError } from '../lib/delivery/publicErrors.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Please use the delivery form.' });
  }
  try {
    const host = req.headers.host;
    if (!host || req.headers.origin !== `https://${host}`) throw new CommerceError('FORBIDDEN');
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json')
      throw new CommerceError('INVALID_INPUT');
    const length = req.headers['content-length'];
    if (
      length &&
      (Array.isArray(length) || !/^\d+$/.test(length) || Number(length) > DELIVERY_BODY_BYTES)
    )
      throw new CommerceError('INVALID_INPUT');
    const body = req.body;
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Buffer.byteLength(JSON.stringify(body), 'utf8') > DELIVERY_BODY_BYTES ||
      !['estimate', 'quote'].includes(body.operation) ||
      !body.input ||
      typeof body.input !== 'object' ||
      Array.isArray(body.input) ||
      'proof' in body.input
    )
      throw new CommerceError('INVALID_INPUT');
    const secret = process.env.DELIVERY_REQUEST_SECRET;
    const url = process.env.VITE_CONVEX_URL;
    // The platform supplies this header. Never trust client-controlled visitor IDs or proxy fallbacks.
    const ip = req.headers['x-vercel-forwarded-for'];
    if (
      process.env.VERCEL !== '1' ||
      !secret ||
      !/^[a-f0-9]{64}$/.test(secret) ||
      !url ||
      !/^https:\/\/[a-z0-9-]+\.convex\.cloud$/.test(url) ||
      typeof ip !== 'string' ||
      !isIP(ip.trim())
    )
      throw new CommerceError('TEMPORARILY_UNAVAILABLE');
    const rateKey = createHmac('sha256', secret)
      .update(`${new Date().toISOString().slice(0, 10)}:${ip.trim()}`)
      .digest('hex');
    const proof = await signRequest(secret, body.operation, body.input, {
      issuedAt: Date.now(),
      nonce: randomBytes(24).toString('hex'),
      rateKey,
    });
    const deadline = globalThis.AbortSignal.timeout(15000);
    const client = new ConvexHttpClient(url, {
      logger: false,
      fetch: (target, init) => fetch(target, { ...init, signal: deadline, redirect: 'error' }),
    });
    const authorization = req.headers.authorization;
    if (authorization) {
      if (!/^Bearer [A-Za-z0-9_.-]+$/.test(authorization) || authorization.length > 8192)
        throw new CommerceError('FORBIDDEN');
      client.setAuth(authorization.slice(7));
    }
    const result =
      body.operation === 'estimate'
        ? await client.action(api.dlvTaxActions.estimate, { ...body.input, proof } as FunctionArgs<
            typeof api.dlvTaxActions.estimate
          >)
        : await client.action(api.dlvTaxActions.requestQuote, {
            ...body.input,
            proof,
          } as FunctionArgs<typeof api.dlvTaxActions.requestQuote>);
    return res.status(200).json({ result });
  } catch (error) {
    const safe = publicDeliveryError(error);
    const status =
      safe.code === 'RATE_LIMITED'
        ? 429
        : safe.code === 'FORBIDDEN'
          ? 403
          : safe.code === 'INVALID_INPUT'
            ? 400
            : safe.code === 'TEMPORARILY_UNAVAILABLE'
              ? 503
              : 409;
    if (status === 429) res.setHeader('Retry-After', '60');
    return res.status(status).json({ error: safe.data });
  }
}
