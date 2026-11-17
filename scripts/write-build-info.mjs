import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

// Public release identity only; never copy environment variables into this artifact.
const commit = process.env.VERCEL_GIT_COMMIT_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid build source commit');
await writeFile('dist/build-info.json', JSON.stringify({ schemaVersion: 1, commit }) + '\n');
