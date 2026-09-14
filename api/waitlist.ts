import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac } from 'node:crypto';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';
import { normalizeWaitlistEmail } from '../lib/waitlistValidation.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Please use the signup form.' }); }
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && origin !== `https://${host}` && origin !== `http://${host}`) return res.status(403).json({ error: 'Please join from the Louie Mae website.' });
  if (!req.headers['content-type']?.includes('application/json')) return res.status(415).json({ error: 'Please use the signup form.' });
  if (Number(req.headers['content-length']) > 2048) return res.status(413).json({ error: 'Please use a valid email address.' });
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Please use the signup form.' });
  if (body.website) return res.status(400).json({ error: 'Please leave the website field empty.' });
  const email = normalizeWaitlistEmail(body.email);
  if (!email || body.consent !== true) return res.status(400).json({ error: 'Please enter a valid email address and agree to receive updates.' });
  const secret = process.env.WAITLIST_INTAKE_SECRET;
  const url = process.env.VITE_CONVEX_URL;
  if (!secret || !url) return res.status(503).json({ error: 'The waitlist is temporarily unavailable. Please try again shortly.' });
  // Vercel supplies the trusted client address. Only a daily rotating HMAC is stored.
  const ip = String(req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const rateKey = createHmac('sha256', secret).update(`${new Date().toISOString().slice(0,10)}:${ip}`).digest('hex');
  try {
    const client = new ConvexHttpClient(url);
    const result = await client.mutation(api.waitlist.register, { secret, email, rateKey, consent: true });
    if (!result.ok) { res.setHeader('Retry-After', '3600'); return res.status(429).json({ error: 'Too many attempts. Please try again in an hour.' }); }
    return res.status(200).json({ ok: true });
  } catch {
    // Never expose backend errors, secrets, or subscriber data to visitors or logs.
    return res.status(503).json({ error: 'We couldn’t save your email right now. Please try again shortly.' });
  }
}
