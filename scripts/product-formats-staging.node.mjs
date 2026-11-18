import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
const run = promisify(execFile);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const script = path.resolve('scripts/prepare-product-formats.mjs');
for (const failure of ['later-width', 'missing-provenance'])
  test(`never publishes a partial family on ${failure}`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lm-format-staging-'));
    try {
      const source = 'https://fixture.invalid/original.png';
      const bytes = await sharp({
        create: { width: 64, height: 64, channels: 3, background: '#756148' },
      })
        .png()
        .toBuffer();
      for (const folder of ['docs/quality', 'lib', 'artifacts/lighthouse/product-originals'])
        await mkdir(path.join(root, folder), { recursive: true });
      const manifest = JSON.stringify({ [source]: { base: '/images/fixture', widths: [16, 32] } });
      await writeFile(path.join(root, 'lib/productImageManifest.json'), manifest);
      await writeFile(
        path.join(root, 'docs/quality/product-image-provenance.json'),
        JSON.stringify({
          records: [
            {
              source,
              sha256: hash(bytes),
              renditions: [
                { width: 16, bytes: 1000000 },
                { width: 32, bytes: 1 },
              ],
            },
          ],
        })
      );
      await writeFile(
        path.join(root, 'artifacts/lighthouse/product-originals', hash(source)),
        bytes
      );
      if (failure !== 'missing-provenance')
        await writeFile(
          path.join(root, 'docs/quality/product-format-provenance.json'),
          '{"records":[]}'
        );
      await assert.rejects(run(process.execPath, [script, source], { cwd: root }), (error) => {
        assert.match(error.stderr, failure === 'later-width' ? /does not improve every/ : /ENOENT/);
        return true;
      });
      await assert.rejects(access(path.join(root, 'public')), { code: 'ENOENT' });
      assert.equal(
        await readFile(path.join(root, 'lib/productImageManifest.json'), 'utf8'),
        manifest
      );
      if (failure !== 'missing-provenance')
        assert.equal(
          await readFile(path.join(root, 'docs/quality/product-format-provenance.json'), 'utf8'),
          '{"records":[]}'
        );
    } finally {
      assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
      await rm(root, { recursive: true, force: true });
    }
  });
