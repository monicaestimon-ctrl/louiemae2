import type { IncomingMessage, ServerResponse } from 'node:http';

/** Structural contract for Vercel's documented Node HTTP helpers, not a runtime adapter.
 * Request bodies remain unknown until the handler validates them.
 * https://vercel.com/docs/functions/runtimes/node-js#nodejs-request-and-response-objects
 */
export type VercelRequest = IncomingMessage & {
  query: Record<string, string | string[] | undefined>;
  cookies: Record<string, string | undefined>;
  body: unknown;
};
export type VercelResponse = ServerResponse & {
  status(code: number): VercelResponse;
  send(body: unknown): VercelResponse;
  json(body: unknown): VercelResponse;
  redirect(status: number, url: string): VercelResponse;
  redirect(url: string): VercelResponse;
};
