import { execFileSync } from 'node:child_process';

let changedFiles;
const previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA?.trim() || 'HEAD^';
try {
  changedFiles = execFileSync('git', ['diff', '--name-only', previousSha, 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).split(/\r?\n/).map((file) => file.trim()).filter(Boolean);
} catch {
  console.log('No parent commit is available; build is required.');
  process.exit(1);
}

const hasRuntimeChange = changedFiles.some((file) =>
  !file.endsWith('.md') &&
  !file.startsWith('docs/') &&
  !file.startsWith('.github/') &&
  !file.startsWith('.prettierrc'),
);

if (hasRuntimeChange) {
  console.log('Runtime files changed; build is required.');
  process.exit(1);
}

console.log('Only documentation or repository automation changed; skipping Vercel build.');
process.exit(0);
