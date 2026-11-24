import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

// Public release identity only; never copy environment variables into this artifact.
if (process.env.VERCEL_GIT_COMMIT_SHA && process.env.BUILD_SOURCE_COMMIT &&
    process.env.VERCEL_GIT_COMMIT_SHA !== process.env.BUILD_SOURCE_COMMIT) throw new Error('Conflicting build source commits');
const commit = process.env.VERCEL_GIT_COMMIT_SHA || process.env.BUILD_SOURCE_COMMIT || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid build source commit');
const documents = await Promise.all(['dist/index.html', 'dist/trade/index.html'].map(async file => {
  const html = await readFile(file, 'utf8');
  if (!html.includes('</head>')) throw new Error('Missing document head: ' + file);
  const clean = html.replace(/<meta name="lm-build-commit" content="[a-f0-9]{40}">\s*/g, '');
  return {file, html:clean.replace('</head>', `<meta name="lm-build-commit" content="${commit}"></head>`)};
}));
await Promise.all(documents.map(({file,html})=>writeFile(file,html)));
await writeFile('dist/build-info.json', JSON.stringify({ schemaVersion: 1, commit }) + '\n');
