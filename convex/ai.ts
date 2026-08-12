"use node";

import { GoogleGenAI } from "@google/genai";
import { createHash } from "node:crypto";
import { v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";

const DEFAULT_MODEL = "gemini-2.5-flash";
const ALLOWED_MODELS = new Set(["gemini-2.5-flash", "gemini-2.0-flash"]);
const configuredModel = process.env.LOUIE_MAE_AI_MODEL || DEFAULT_MODEL;
const MODEL = ALLOWED_MODELS.has(configuredModel) ? configuredModel : DEFAULT_MODEL;
const CONCIERGE_FALLBACK = "I am currently assisting other clients. Please try again in a moment.";

const fallbackSubjects = [
  "New from Louie Mae",
  "Discover our latest collection",
  "A note from Monica",
];

const fallbackTemplate = {
  introduction: "Welcome to our latest update.",
  main_content: "We have some exciting news to share with you.",
  conclusion: "Thank you for being part of our journey.",
  quote: "Simplicity is the ultimate sophistication.",
  collection_title: "New Collection",
  description: "Discover our latest arrivals, curated just for you.",
  discount: "20% OFF",
  sale_title: "Exclusive Access",
  details: "Shop our private sale for a limited time.",
};

const clamp = (value: string, max: number) => value.trim().slice(0, max);

const hashRequest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const parseJson = <T>(value: string | undefined): T => {
  const cleaned = (value || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!cleaned) throw new Error("The AI provider returned an empty response.");
  return JSON.parse(cleaned) as T;
};

const getAI = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("AI is not configured. Set GEMINI_API_KEY in the Convex environment.");
  }
  return new GoogleGenAI({ apiKey });
};

const requireAdmin = async (ctx: ActionCtx) => {
  await ctx.runQuery(internal.cjAdminAccess.verifyCjAdminIdentity, {});
};

async function measured<T>(operation: string, inputChars: number, work: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await work();
    console.info("[AIUsage]", {
      operation,
      model: MODEL,
      inputChars,
      durationMs: Date.now() - startedAt,
      success: true,
    });
    return result;
  } catch (error) {
    console.warn("[AIUsage]", {
      operation,
      model: MODEL,
      inputChars,
      durationMs: Date.now() - startedAt,
      success: false,
      error: error instanceof Error ? error.message : "Unknown provider error",
    });
    throw error;
  }
}

/**
 * Public storefront concierge. Provider credentials remain server-only and the
 * request is deliberately bounded to prevent a single chat from creating an
 * unbounded model bill. Admin/content actions below require Convex auth.
 */
export const generateConciergeResponse = action({
  args: {
    userMessage: v.string(),
    history: v.array(v.object({ role: v.string(), text: v.string() })),
    clientToken: v.string(),
  },
  handler: async (ctx, args): Promise<string> => {
    const userMessage = clamp(args.userMessage, 800);
    const clientToken = args.clientToken.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
    const history = args.history.slice(-8).map((message) => ({
      role: message.role === "user" ? "user" : "model",
      parts: [{ text: clamp(message.text, 800) }],
    }));
    if (!userMessage) return "How may I help you curate your space or style today?";
    if (clientToken.length < 12) return CONCIERGE_FALLBACK;

    const now = Date.now();
    const requestHash = hashRequest(JSON.stringify({
      clientToken,
      userMessage,
      history: history.map(item => [item.role, item.parts[0].text]),
    }));
    const claim = await ctx.runMutation(internal.aiUsage.claimPublicRequest, {
      clientToken,
      requestHash,
      operation: "storefront_concierge",
      now,
    });
    if ("reason" in claim) {
      if (claim.reason === "duplicate" && claim.response) return claim.response;
      return claim.reason === "rate_limited"
        ? "I have reached my conversation limit for the moment. Please try again shortly."
        : CONCIERGE_FALLBACK;
    }

    try {
      const reply = await measured(
        "storefront_concierge",
        userMessage.length + history.reduce((sum, item) => sum + item.parts[0].text.length, 0),
        async () => {
          const response = await getAI().models.generateContent({
            model: MODEL,
            contents: [...history, { role: "user", parts: [{ text: userMessage }] }],
            config: {
              systemInstruction: `You are the Louie Mae Concierge, a warm, sophisticated interior design and fashion assistant. Louie Mae offers curated furniture, home decor, women's fashion, and children's items with an earthy, timeless aesthetic. Help shoppers find products and give concise styling advice. Never claim real-time inventory, prices, policies, or order details you have not been given. Do not use markdown headings or bold markers.`,
              temperature: 0.6,
              maxOutputTokens: 500,
            },
          });
          return response.text?.trim() || "I apologize, I'm having a moment of creative block. Could you repeat that?";
        },
      );
      await ctx.runMutation(internal.aiUsage.completePublicRequest, {
        usageId: claim.usageId,
        response: reply,
        success: true,
        now: Date.now(),
      });
      return reply;
    } catch {
      await ctx.runMutation(internal.aiUsage.completePublicRequest, {
        usageId: claim.usageId,
        success: false,
        now: Date.now(),
      });
      return CONCIERGE_FALLBACK;
    }
  },
});

export const generatePageStructure = action({
  args: { prompt: v.string(), title: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const prompt = clamp(args.prompt, 1_500);
    const title = clamp(args.title, 160);
    const response = await measured("page_structure", prompt.length + title.length, () =>
      getAI().models.generateContent({
        model: MODEL,
        contents: `Create a page about: ${prompt}. The title should be approximately: ${title}`,
        config: {
          systemInstruction: `You are a web architect for Louie Mae, an earthy, minimalist, sophisticated lifestyle brand. Return strict JSON with {"title": string, "sections": PageSection[]}. Each section must have a short random id and a type of hero, text, image-text, or manifesto. Hero sections need image, heading, and subheading. Text sections need heading and content. Image-text sections need image, heading, and content. Manifesto sections need content. Use relevant Unsplash image URLs. Keep the tone elegant, timeless, welcoming, and subtly faith-based.`,
          responseMimeType: "application/json",
          temperature: 0.5,
          maxOutputTokens: 2_000,
        },
      }),
    );
    const result = parseJson<{ title?: unknown; sections?: unknown }>(response.text);
    if (typeof result.title !== "string" || !Array.isArray(result.sections)) {
      throw new Error("The AI provider returned an invalid page structure.");
    }
    const allowedTypes = new Set(["hero", "text", "image-text", "manifesto"]);
    const sections = result.sections.slice(0, 12).filter((section): section is Record<string, unknown> =>
      !!section && typeof section === "object" && allowedTypes.has(String((section as Record<string, unknown>).type)),
    );
    if (sections.length === 0) throw new Error("The AI provider did not return any valid page sections.");
    return { title: clamp(result.title, 160), sections };
  },
});

export const suggestProductCategory = action({
  args: { productName: v.string(), productDescription: v.string() },
  handler: async (ctx, args): Promise<string> => {
    await requireAdmin(ctx);
    const productName = clamp(args.productName, 300);
    const productDescription = clamp(args.productDescription, 3_000);
    const validCategories = [
      "Girls Tops", "Girls Bottoms", "Girls Dresses", "Girls Rompers",
      "Girls 2-Piece Sets", "Girls Activewear", "Girls Accessories", "Girls Footwear",
      "Boys", "Toys", "Nursery Furniture", "Playroom Furniture",
    ];
    const response = await measured("product_category", productName.length + productDescription.length, () =>
      getAI().models.generateContent({
        model: MODEL,
        contents: `Product name: ${productName}\nDescription: ${productDescription}`,
        config: {
          systemInstruction: `Choose exactly one category from this list: ${validCategories.join(", ")}. Return only the exact category text. If the product is for boys, use Boys.`,
          temperature: 0,
          maxOutputTokens: 40,
        },
      }),
    );
    const category = response.text?.trim() || "";
    return validCategories.includes(category) ? category : "";
  },
});

export const translateVariantNames = action({
  args: { variantNames: v.array(v.string()) },
  handler: async (ctx, args): Promise<Array<{ original: string; translated: string }>> => {
    await requireAdmin(ctx);
    const names = args.variantNames.slice(0, 80).map((name) => clamp(name, 240));
    const chineseNames = names.filter((name) => /[\u4e00-\u9fff]/.test(name));
    const translations = new Map(names.map((name) => [name, name]));
    if (chineseNames.length === 0) {
      return names.map((original) => ({ original, translated: original }));
    }

    for (let index = 0; index < chineseNames.length; index += 40) {
      const batch = chineseNames.slice(index, index + 40);
      try {
        const response = await measured("variant_translation", JSON.stringify(batch).length, () =>
          getAI().models.generateContent({
            model: MODEL,
            contents: `Translate these variant labels:\n${JSON.stringify(batch)}`,
            config: {
              systemInstruction: `Translate Chinese product variant labels into concise English. Translate only Chinese text, preserve numbers and symbols, and retain Property: Value structure. Return a strict JSON array of strings in the same order as the input.`,
              responseMimeType: "application/json",
              temperature: 0.1,
              maxOutputTokens: 1_500,
            },
          }),
        );
        const translated = parseJson<unknown[]>(response.text);
        if (translated.length === batch.length) {
          batch.forEach((original, offset) => {
            const value = translated[offset];
            if (typeof value === "string" && value.trim()) translations.set(original, clamp(value, 240));
          });
        }
      } catch (error) {
        console.warn("[AIUsage] Variant translation batch used originals", {
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
    return names.map((original) => ({ original, translated: translations.get(original) || original }));
  },
});

export const generateEmailSubject = action({
  args: { topic: v.string() },
  handler: async (ctx, args): Promise<string[]> => {
    await requireAdmin(ctx);
    const topic = clamp(args.topic, 500);
    try {
      const response = await measured("email_subject", topic.length, () =>
        getAI().models.generateContent({
          model: MODEL,
          contents: `Topic: ${topic}`,
          config: {
            systemInstruction: `Write three distinct email subject lines for Louie Mae. The voice is elegant, warm, minimal, and editorial. Avoid all caps, excessive emoji, and spam language. Return a strict JSON array of exactly three strings.`,
            responseMimeType: "application/json",
            temperature: 0.7,
            maxOutputTokens: 160,
          },
        }),
      );
      const values = parseJson<unknown[]>(response.text)
        .filter((value): value is string => typeof value === "string" && !!value.trim())
        .slice(0, 3)
        .map((value) => clamp(value, 120));
      return values.length === 3 ? values : fallbackSubjects;
    } catch {
      return fallbackSubjects;
    }
  },
});

export const personalizeTemplate = action({
  args: { templateId: v.string(), topic: v.string(), objective: v.string() },
  handler: async (ctx, args): Promise<Record<string, string>> => {
    await requireAdmin(ctx);
    const templateId = ["minimalist", "showcase", "exclusive"].includes(args.templateId)
      ? args.templateId
      : "minimalist";
    const topic = clamp(args.topic, 500);
    const objective = clamp(args.objective, 120);
    const placeholders = templateId === "minimalist"
      ? ["introduction", "main_content", "quote", "conclusion"]
      : templateId === "showcase"
        ? ["collection_title", "description"]
        : ["discount", "sale_title", "details"];
    try {
      const response = await measured("email_template", topic.length + objective.length, () =>
        getAI().models.generateContent({
          model: MODEL,
          contents: `Template: ${templateId}\nTopic: ${topic}\nObjective: ${objective}`,
          config: {
            systemInstruction: `Write email-template content for Louie Mae in a sophisticated, warm, minimalist voice. Avoid emoji, exaggerated punctuation, and generic sales language. Return a strict JSON object with only these keys: ${placeholders.join(", ")}.`,
            responseMimeType: "application/json",
            temperature: 0.6,
            maxOutputTokens: 1_000,
          },
        }),
      );
      const value = parseJson<Record<string, unknown>>(response.text);
      return Object.fromEntries(placeholders.map((key) => [
        key,
        typeof value[key] === "string" && value[key].trim()
          ? clamp(value[key] as string, 2_000)
          : clamp(String(fallbackTemplate[key as keyof typeof fallbackTemplate] || ""), 2_000),
      ]));
    } catch {
      return Object.fromEntries(placeholders.map((key) => [
        key,
        String(fallbackTemplate[key as keyof typeof fallbackTemplate] || ""),
      ]));
    }
  },
});

export const generateBlogExcerpts = action({
  args: { content: v.string() },
  handler: async (ctx, args): Promise<Array<{ style: string; text: string }>> => {
    await requireAdmin(ctx);
    const content = clamp(args.content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "), 3_000);
    const response = await measured("blog_excerpts", content.length, () =>
      getAI().models.generateContent({
        model: MODEL,
        contents: `Blog post content:\n${content}`,
        config: {
          systemInstruction: `You are an editorial assistant for Simply Mae, Louie Mae's premium lifestyle and faith journal. Return a strict JSON array of exactly four excerpt options. Each object has style and text. Use these styles in order: THE HOOK, THE HEART, THE THESIS, THE REFRAME. Each excerpt is one or two sentences that entices the reader without inventing claims.`,
          responseMimeType: "application/json",
          temperature: 0.65,
          maxOutputTokens: 700,
        },
      }),
    );
    const options = parseJson<unknown[]>(response.text)
      .filter((option): option is Record<string, unknown> => !!option && typeof option === "object")
      .map((option) => ({
        style: clamp(typeof option.style === "string" ? option.style : "EXCERPT", 40),
        text: clamp(typeof option.text === "string" ? option.text : "", 500),
      }))
      .filter((option) => !!option.text)
      .slice(0, 4);
    if (options.length !== 4) throw new Error("The AI provider returned an invalid excerpt set.");
    return options;
  },
});
