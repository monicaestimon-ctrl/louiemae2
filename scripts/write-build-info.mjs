import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

// Public release identity only; never copy environment variables into this artifact.
if (process.env.VERCEL_GIT_COMMIT_SHA && process.env.BUILD_SOURCE_COMMIT &&
    process.env.VERCEL_GIT_COMMIT_SHA !== process.env.BUILD_SOURCE_COMMIT) throw new Error('Conflicting build source commits');
const commit = process.env.VERCEL_GIT_COMMIT_SHA || process.env.BUILD_SOURCE_COMMIT || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid build source commit');
await writeFile('dist/build-info.json', JSON.stringify({ schemaVersion: 1, commit }) + '\n');
