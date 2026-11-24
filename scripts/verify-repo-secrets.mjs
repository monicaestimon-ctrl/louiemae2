// Fails if tracked source or docs contain live payment keys, webhook secrets or deploy keys, or if
// supplier cost data under data/ is tracked (v2 S38). Run in CI next to the client-secret check.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const PATTERNS = [
  ['Stripe live secret key', /\b(sk|rk)_live_[0-9A-Za-z]{10,}/],
  ['Stripe webhook secret', /\bwhsec_[0-9A-Za-z]{16,}/],
  ['Convex deploy key', /\b(prod|dev|preview):[a-z0-9-]+\|[0-9a-f]{20,}/],
  ['Resend API key', /\bre_[0-9A-Za-z]{20,}/],
];
const problems = [];
for (const f of files) {
  if (f.startsWith('data/') && !/(^data\/\.gitignore$|\.sha256$|\/parity-[^/]+\.md$)/.test(f)) problems.push(`${f}: supplier data must not be tracked`);
  if (/\.(png|jpe?g|webp|glb|gif|ico|pdf|woff2?|ttf|mp4|zip)$/i.test(f) || f === 'package-lock.json') continue;
  let text;
  try {
    text = fs.readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  for (const [label, re] of PATTERNS) if (re.test(text)) problems.push(`${f}: ${label}`);
}
if (problems.length) {
  console.error('Secrets or supplier data found in tracked files:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`Repository secret scan passed for ${files.length} tracked files.`);
