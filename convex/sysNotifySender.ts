'use node';
import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { notificationEnvelope } from './v2Validators';

type Envelope = { from: string; to: string; subject: string; text: string; replyTo?: string };
type Receipt = { ok: true; providerId: string } | { ok: false; error: string; retryable: boolean };

/** Fixed endpoint, no redirects, bounded timeout/body; provider errors never include customer data.
 * Contract: https://resend.com/docs/api-reference/emails/send-email
 * Idempotency: https://resend.com/docs/dashboard/emails/idempotency-keys (24 hours).
 */
export async function sendRecorded(
  envelope: Envelope,
  key: string,
  transport: typeof fetch = fetch
): Promise<Receipt> {
  const secret = process.env.RESEND_API_KEY;
  if (!secret) return { ok: false, error: 'Email provider is not configured', retryable: false };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await transport('https://api.resend.com/emails', {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify({
        from: envelope.from,
        to: [envelope.to],
        subject: envelope.subject,
        text: envelope.text,
        ...(envelope.replyTo ? { reply_to: envelope.replyTo } : {}),
      }),
    });
    const reader = response.body?.getReader();
    let text = '',
      size = 0;
    if (reader) {
      const decoder = new globalThis.TextDecoder();
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 65536) {
          await reader.cancel();
          return {
            ok: false,
            error: 'Provider response exceeded size limit; reconcile before retry',
            retryable: false,
          };
        }
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    }
    let body: { id?: unknown; name?: unknown } = {};
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, error: 'Provider response was not valid JSON', retryable: true };
    }
    if (response.ok && typeof body.id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(body.id))
      return { ok: true, providerId: body.id };
    const retryable =
      response.status === 429 ||
      response.status >= 500 ||
      (response.status === 409 && body.name === 'concurrent_idempotent_requests');
    return {
      ok: false,
      error: `Email provider did not confirm acceptance (HTTP ${response.status})`,
      retryable,
    };
  } catch {
    return {
      ok: false,
      error: 'Email delivery outcome uncertain after network interruption',
      retryable: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const send = internalAction({
  args: { envelope: notificationEnvelope, key: v.string() },
  handler: async (_ctx, a): Promise<Receipt> => sendRecorded(a.envelope, a.key),
});
