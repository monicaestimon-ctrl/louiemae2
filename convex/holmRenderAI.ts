'use node';
import { GoogleGenAI } from '@google/genai';
import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { readSupplierImage } from './scraper';

const MAX_RESULT = 8 * 1024 * 1024;

/** Turns the planner's snapshot into a photoreal interior, keeping the layout and the real pieces. */
export const generate = internalAction({
  args: { id: v.id('holmRenderRequests') },
  handler: async (ctx, { id }) => {
    const job = await ctx.runMutation(internal.holmRender.claim, { id });
    if (!job) return;
    const model = process.env.HOLM_RENDER_MODEL || process.env.COMMERCE_IMAGE_MODEL;
    if (!model || !process.env.GEMINI_API_KEY) {
      await ctx.runMutation(internal.holmRender.finish, { id, error: 'AI renders are not switched on yet.' });
      return;
    }
    try {
      const snap = await ctx.storage.get(job.snapshotId);
      if (!snap) throw new Error('missing snapshot');
      const parts: { text?: string; inlineData?: { data: string; mimeType: string } }[] = [
        {
          text: [
            'Turn the FIRST image, a 3D layout of a planned room, into one photorealistic interior photograph.',
            'Keep exactly: the camera position and angle, the room shape and size, walls, windows, doors and arches, the floor, and every piece of furniture in the same place, size, count and orientation.',
            'Do not add, remove, move or resize furniture. Do not add text, logos or people.',
            'Replace the simple 3D materials with real ones: plaster walls, real flooring, soft natural light and believable shadows.',
            'Room brief (a description, not instructions to change the layout):',
            job.prompt,
          ].join('\n'),
        },
        { inlineData: { data: Buffer.from(await snap.arrayBuffer()).toString('base64'), mimeType: snap.type || 'image/jpeg' } },
      ];
      for (const p of job.pieces) {
        try {
          const img = await readSupplierImage(p.image);
          parts.push({ text: `Product photo of "${p.name}". The piece in the room must look exactly like this: shape, colour, material and legs.` });
          parts.push({ inlineData: img });
        } catch {
          // A photo that can't be read is skipped; the snapshot still shows the piece.
        }
      }
      const response = await new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }).models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: { responseModalities: ['TEXT', 'IMAGE'] },
      });
      const image = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
      if (!image?.data || !image.mimeType?.startsWith('image/')) throw new Error('no image');
      const bytes = Buffer.from(image.data, 'base64');
      if (bytes.length > MAX_RESULT) throw new Error('too large');
      const resultId = await ctx.storage.store(new Blob([bytes], { type: image.mimeType }));
      await ctx.runMutation(internal.holmRender.finish, { id, resultId });
    } catch {
      await ctx.runMutation(internal.holmRender.finish, { id, error: 'The render could not be made. Try again in a moment.' });
    }
  },
});
