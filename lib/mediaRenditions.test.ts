// @vitest-environment node
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { mediaRenditions } from './mediaRenditions';

describe('stored supplier photo preparation', () => {
  it('creates bounded WebP sizes without enlarging, retaining source bytes or EXIF in derivatives', async () => {
    const bytes = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: 'white' } }).jpeg().withMetadata().toBuffer();
    const before = Buffer.from(bytes);
    const result = await mediaRenditions(bytes);
    expect(result.derivatives.map(d => d.width)).toEqual([640, 1280, 1600]);
    expect(bytes.equals(before)).toBe(true);
    for (const d of result.derivatives) {
      const meta = await sharp(d.bytes).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.exif).toBeUndefined();
      expect(meta.width).toBe(d.width);
      expect(meta.height).toBe(d.height);
    }
  });
  it('rejects HTML, tiny images and oversized uploads', async () => {
    await expect(mediaRenditions(Buffer.from('<html>not a photo</html>'))).rejects.toThrow();
    const tiny = await sharp({ create: { width: 20, height: 20, channels: 3, background: 'white' } }).png().toBuffer();
    await expect(mediaRenditions(tiny)).rejects.toThrow(/800 pixels/);
    await expect(mediaRenditions(new Uint8Array(20 * 1024 * 1024 + 1))).rejects.toThrow(/20 MB/);
  });
});
