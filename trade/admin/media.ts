/* global HTMLCanvasElement */
import type { Id } from '../../convex/_generated/dataModel';
import { customerMessage } from '../../lib/errors';
export type CutoutDraft = { blob: Blob; url: string; aspect: number };
export const errText = (error: unknown) => customerMessage(error);
export async function uploadBlob(
  getUrl: () => Promise<string>,
  blob: Blob
): Promise<Id<'_storage'>> {
  const abort = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      abort.abort();
      reject(Error('Upload timed out. Please try again.'));
    }, 30_000);
  });
  const upload = async (): Promise<Id<'_storage'>> => {
    const url = await getUrl();
    // A late URL response must never start a write after the UI reported a timeout.
    if (abort.signal.aborted) throw Error('Upload timed out');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
      signal: abort.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw Error('Upload failed');
    }
    const value: unknown = await response.json();
    if (
      !value ||
      typeof value !== 'object' ||
      !('storageId' in value) ||
      typeof value.storageId !== 'string' ||
      !value.storageId
    ) {
      throw Error('Invalid upload response');
    }
    return value.storageId as Id<'_storage'>;
  };
  try {
    return await Promise.race([upload(), deadline]);
  } finally {
    clearTimeout(timeout);
  }
}

export function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      if (error) {
        image.src = '';
        reject(error);
      } else resolve(image);
    };
    const timeout = setTimeout(() => finish(Error('Image load timed out')), 15_000);
    image.crossOrigin = 'anonymous';
    image.onload = () => finish();
    image.onerror = () => finish(Error('Image unavailable'));
    try {
      image.src = new URL(src, window.location.origin + '/trade/').href;
    } catch {
      finish(Error('Invalid image address'));
    }
  });
}
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(Error('The cutout could not be created.'))),
        'image/png'
      );
    } catch {
      reject(Error('The photo does not permit a cutout download.'));
    }
  });
}
/** Explicit staff-only editing; supplier source photo is never changed. */
export async function cutoutFromPhoto(src: string): Promise<CutoutDraft> {
  const im = await loadImg(src);
  const s = Math.min(1, 2000 / Math.max(im.width, im.height)),
    W = Math.round(im.width * s),
    H = Math.round(im.height * s);
  if (!W || !H) throw Error('The photo is empty.');
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) throw Error('Image editing is unavailable.');
  g.drawImage(im, 0, 0, W, H);
  const data = g.getImageData(0, 0, W, H),
    px = data.data,
    edge: number[] = [];
  for (let x = 0; x < W; x += 4) edge.push(x * 4, ((H - 1) * W + x) * 4);
  for (let y = 0; y < H; y += 4) edge.push(y * W * 4, (y * W + W - 1) * 4);
  const median = (k: number) => {
    const values = edge.map((i) => px[i + k]).sort((a, b) => a - b);
    return values[values.length >> 1];
  };
  const bg = [median(0), median(1), median(2)],
    tolerance = 34;
  const distance = (i: number) => Math.hypot(px[i] - bg[0], px[i + 1] - bg[1], px[i + 2] - bg[2]);
  const seen = new Uint8Array(W * H),
    stack: number[] = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const p = stack.pop()!;
    if (seen[p] || distance(p * 4) > tolerance) continue;
    seen[p] = 1;
    const x = p % W,
      y = (p / W) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < W - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - W);
    if (y < H - 1) stack.push(p + W);
  }
  let x0 = W,
    y0 = H,
    x1 = 0,
    y1 = 0;
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    if (seen[p]) {
      px[i + 3] = 0;
      continue;
    }
    const x = p % W,
      y = (p / W) | 0;
    const boundary =
      (x > 0 && seen[p - 1]) ||
      (x < W - 1 && seen[p + 1]) ||
      (y > 0 && seen[p - W]) ||
      (y < H - 1 && seen[p + W]);
    if (boundary) px[i + 3] = Math.round(255 * Math.min(1, distance(i) / (tolerance * 2.2)));
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  if (x1 <= x0 || y1 <= y0) throw Error('No piece found against the background.');
  g.putImageData(data, 0, 0);
  const margin = Math.round(Math.max(W, H) * 0.01);
  x0 = Math.max(0, x0 - margin);
  y0 = Math.max(0, y0 - margin);
  x1 = Math.min(W - 1, x1 + margin);
  y1 = Math.min(H - 1, y1 + margin);
  const output = document.createElement('canvas');
  output.width = x1 - x0 + 1;
  output.height = y1 - y0 + 1;
  const context = output.getContext('2d');
  if (!context) throw Error('Image editing is unavailable.');
  context.drawImage(canvas, x0, y0, output.width, output.height, 0, 0, output.width, output.height);
  return {
    blob: await canvasBlob(output),
    url: output.toDataURL('image/png'),
    aspect: output.width / output.height,
  };
}
