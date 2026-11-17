import sharp from 'sharp';
/** Decode/orient once; PNG avoids an extra lossy JPEG encoding before resizing. */
export const orientProductSource = original => sharp(original, { limitInputPixels: 50_000_000 }).rotate().png().toBuffer({ resolveWithObject: true });
