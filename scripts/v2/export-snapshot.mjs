// S00: read-only snapshot of the deployment before any v2 migration commit (v2 §22).
// Uses `npx convex export` (a read-only backup) and writes a manifest with the file hash,
// code commit and the names (never values) of the v2 flags.
//   node scripts/v2/export-snapshot.mjs <output-dir> [--prod]
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
if (!out) {
  console.error('Usage: node scripts/v2/export-snapshot.mjs <output-dir> [--prod]');
  process.exit(1);
}
if (path.resolve(out).startsWith(process.cwd())) {
  console.error('Write snapshots outside the repository: they contain customer and cost data.');
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const file = path.join(out, `convex-snapshot-${stamp}.zip`);
execFileSync('npx', ['convex', 'export', '--path', file, ...(process.argv.includes('--prod') ? ['--prod'] : [])], { stdio: 'inherit' });
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const commit = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();
const schemaHash = crypto.createHash('sha256').update(fs.readFileSync('convex/schema.ts')).update(fs.readFileSync('convex/v2Tables.ts')).digest('hex');
const manifest = { file: path.basename(file), sha256, commit, schemaHash, createdAt: new Date().toISOString(), flags: ['see lib/flags.ts V2_FLAGS'] };
fs.writeFileSync(path.join(out, `manifest-${stamp}.json`), JSON.stringify(manifest, null, 2));
console.log('Snapshot written:', manifest);
