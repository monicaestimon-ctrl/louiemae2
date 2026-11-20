import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { PUBLIC_INITIAL_ID, type PublicInitialData } from './publicInitialData.js';
/** Bind a small public DTO to the exact initial response; never embed commerce authority. */
export function withPublicInitialData(
  html: string,
  path: string,
  data: PublicInitialData,
  now = Date.now()
) {
  const serialized = JSON.stringify(data);
  const revision = createHash('sha256').update(serialized).digest('hex');
  const json = JSON.stringify({ version: 1, path, at: now, revision, data })
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  if (Buffer.byteLength(json, 'utf8') > 300_000 || gzipSync(json).length > 100 * 1024) return html;
  return html.replace(
    '</head>',
    () => `<script id="${PUBLIC_INITIAL_ID}" type="application/json">${json}</script></head>`
  );
}
