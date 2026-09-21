// Build against only explicitly permitted public variables. The user's local
// environment is never rewritten or copied into the verification environment.
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { build, loadEnv } from 'vite';
const env = loadEnv('production', process.cwd(), 'VITE_');
const dir = await mkdtemp(join(tmpdir(), 'louiemae-furniture-build-'));
try {
  await writeFile(
    join(dir, '.env'),
    `VITE_CONVEX_URL=${JSON.stringify(env.VITE_CONVEX_URL || '')}\nVITE_PRELAUNCH_MODE=${env.VITE_PRELAUNCH_MODE === 'false' ? 'false' : 'true'}\n`
  );
  await build({ envDir: dir });
  const root = await readFile('dist/index.html', 'utf8');
  const furniture = await readFile('dist/furniture/index.html', 'utf8');
  if (
    root.includes('House of Louie Mae — Furniture') ||
    !furniture.includes('House of Louie Mae — Furniture')
  )
    throw new Error('Furniture entry isolation failed.');
  console.log('Separate root and furniture build entries verified.');
} finally {
  await cleanupVerificationDirectory(dir);
}

async function cleanupVerificationDirectory(directory) {
  // Validate the task-owned temporary directory before recursive removal.
  const resolved = resolve(directory);
  if (dirname(resolved) !== resolve(tmpdir()) || !basename(resolved).startsWith('louiemae-furniture-build-')) {
    throw new Error('Unexpected verification directory; refusing cleanup.');
  }
  await rm(resolved, { recursive: true, force: true });
}
