'use node';

import { action } from './_generated/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { auth } from './auth';

const CHINESE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

function containsChinese(value = ''): boolean {
  return CHINESE.test(value);
}

async function fetchWithTimeout(url: string, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function translateWithGoogle(text: string): Promise<string> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`Google translation returned HTTP ${response.status}`);
  const payload = (await response.json()) as any[];
  const translated = Array.isArray(payload?.[0])
    ? payload[0].map((part: any[]) => String(part?.[0] || '')).join('')
    : '';
  if (!translated.trim()) throw new Error('Google translation returned no text');
  return translated.trim();
}

async function translateWithMyMemory(text: string): Promise<string> {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=zh-CN|en`;
  const response = await fetchWithTimeout(url, 20_000);
  if (!response.ok) throw new Error(`MyMemory returned HTTP ${response.status}`);
  const payload = (await response.json()) as any;
  const translated = String(payload?.responseData?.translatedText || '').trim();
  if (!translated) throw new Error('MyMemory returned no text');
  return translated;
}

async function translateOne(
  text: string
): Promise<{ text: string; provider: string; error?: string }> {
  if (!text.trim() || !containsChinese(text)) return { text, provider: 'unchanged' };
  const errors: string[] = [];
  for (const [provider, translate] of [
    ['google', translateWithGoogle],
    ['mymemory', translateWithMyMemory],
  ] as const) {
    try {
      const translated = await translate(text);
      if (!containsChinese(translated)) return { text: translated, provider };
      errors.push(`${provider} left untranslated Chinese text`);
    } catch (error) {
      errors.push(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { text, provider: 'failed', error: errors.join('; ') };
}

export const translateProductFields = action({
  args: {
    name: v.string(),
    description: v.string(),
    variantNames: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId)
      return {
        ok: false,
        errorCode: 'AUTH_REQUIRED',
        error: 'Authentication required',
        ...args,
        failures: [],
      };
    try {
      await ctx.runQuery(internal.cjAdminAccess.verifyCjAdminIdentity, {});
    } catch {
      return {
        ok: false,
        errorCode: 'ADMIN_REQUIRED',
        error: 'Admin permission required',
        ...args,
        failures: [],
      };
    }

    const unique = [...new Set([args.name, args.description, ...args.variantNames])];
    const translated = new Map<string, Awaited<ReturnType<typeof translateOne>>>();
    for (let index = 0; index < unique.length; index += 4) {
      const chunk = unique.slice(index, index + 4);
      const results = await Promise.all(chunk.map(translateOne));
      chunk.forEach((source, offset) => translated.set(source, results[offset]));
    }
    const failures = [...translated.entries()]
      .filter(([, result]) => result.error)
      .map(([field, result]) => ({ field: field.slice(0, 120), error: result.error! }));
    const result = {
      name: translated.get(args.name)?.text || args.name,
      description: translated.get(args.description)?.text || args.description,
      variantNames: args.variantNames.map((name) => translated.get(name)?.text || name),
    };
    const remainingChinese = [result.name, result.description, ...result.variantNames].filter(
      containsChinese
    ).length;
    return {
      ok: failures.length === 0 && remainingChinese === 0,
      partial: failures.length > 0 && failures.length < unique.filter(containsChinese).length,
      ...result,
      providers: [
        ...new Set(
          [...translated.values()]
            .map((value) => value.provider)
            .filter((value) => value !== 'unchanged')
        ),
      ],
      failures,
      remainingChinese,
      errorCode: remainingChinese ? 'TRANSLATION_INCOMPLETE' : undefined,
      error: remainingChinese
        ? `${remainingChinese} field${remainingChinese === 1 ? '' : 's'} could not be translated.`
        : undefined,
    };
  },
});
