'use node';
import { GoogleGenAI } from '@google/genai';
import { v } from 'convex/values';
import { getAuthUserId } from '@convex-dev/auth/server';
import { action } from './_generated/server';
import { cleanPlanRead, type PlanRead } from '../lib/holmPlan';

const MODEL = process.env.LOUIE_MAE_AI_MODEL === 'gemini-2.0-flash' ? 'gemini-2.0-flash' : 'gemini-2.5-flash';

const PROMPT = `You are reading an architectural floor plan image for an interior planner.
Return JSON only, in this shape:
{"rooms":[{"name":"Dining room","points":[[x,y],...]}],"blocks":[{"name":"Column","points":[[x,y],...]}],"scale":{"a":[x,y],"b":[x,y],"meters":number}|null}
Rules:
- Coordinates are fractions of the image width (x) and height (y), from 0 to 1, with the origin top-left.
- Each room is the inside face of its walls, traced clockwise, one point per corner (L-shapes and alcoves included). Name each room if the plan labels it.
- Blocks are fixed things inside rooms: columns, bar counters, host stands, built-in banquettes.
- If a wall has a written dimension, give its two ends and its length in metres in "scale"; otherwise null.
- Leave out furniture, doors swings, text and dimension lines.`;

/** An AI pass that proposes room outlines from an uploaded plan. The partner checks the scale and fixes walls after. */
export const readWalls = action({
  args: { image: v.string(), mime: v.string() },
  handler: async (ctx, a): Promise<PlanRead> => {
    if (!(await getAuthUserId(ctx))) throw new Error('Sign in to read walls from a plan.');
    if (!/^image\/(png|jpe?g|webp)$/.test(a.mime) || a.image.length > 6_000_000) throw new Error('Use a PNG or JPEG under 4 MB.');
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('Reading walls is not set up yet. Trace the walls by hand for now.');
    const response = await new GoogleGenAI({ apiKey: key }).models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: a.mime, data: a.image } }, { text: PROMPT }] }],
      config: { temperature: 0.1, maxOutputTokens: 4000, responseMimeType: 'application/json' },
    });
    const text = (response.text || '').trim().replace(/^```json\s*/i, '').replace(/```$/, '');
    let raw: unknown = null;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error('No walls could be read from this plan. Trace them by hand.');
    }
    const read = cleanPlanRead(raw);
    if (!read.rooms.length) throw new Error('No walls could be read from this plan. Trace them by hand.');
    return read;
  },
});
