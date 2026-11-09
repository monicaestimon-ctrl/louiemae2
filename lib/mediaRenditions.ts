// Node-only image preparation. No visual generation, cropping, enlargement or source mutation.
import sharp from 'sharp';

export async function mediaRenditions(bytes: Uint8Array) {
  if (!bytes.length || bytes.byteLength > 20 * 1024 * 1024) throw new Error('Image must be at most 20 MB');
  const options = { limitInputPixels: 40_000_000, failOn: 'warning' as const };
  const meta = await sharp(bytes, options).metadata();
  if (!['jpeg', 'png', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) !== 1)
    throw new Error('Use a single JPEG, PNG or WebP product photograph');
  if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < 800)
    throw new Error('Product photograph must be at least 800 pixels on each edge');
  const derivatives: { width: number; height: number; bytes: Uint8Array; format: 'webp' }[] = [];
  for (const width of [640, 1280, 2048]) {
    const result = await sharp(bytes, options).rotate().resize({ width, withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 }).toBuffer({ resolveWithObject: true });
    if (!derivatives.some(d => d.width === result.info.width)) derivatives.push({
      width: result.info.width, height: result.info.height, bytes: new Uint8Array(result.data), format: 'webp',
    });
  }
  return { mime: `image/${meta.format}`, width: meta.width, height: meta.height, derivatives };
}
