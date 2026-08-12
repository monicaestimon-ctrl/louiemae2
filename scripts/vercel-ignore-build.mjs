import { execFileSync } from 'node:child_process';

let changedFiles;
try {
  changedFiles = execFileSync('git', ['diff', '--name-only', 'HEAD^', 'HEAD'], {
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
  file !== '.prettierrc',
);

if (hasRuntimeChange) {
  console.log('Runtime files changed; build is required.');
  process.exit(1);
}

console.log('Only documentation or repository automation changed; skipping Vercel build.');
process.exit(0);
