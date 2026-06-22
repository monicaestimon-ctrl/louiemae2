"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { auth } from "./auth";
import {
    SmartNameRequest,
    SmartNameResponse,
    SourceProductSnapshot,
} from "../lib/smartDescription";
import { extractNormalizedProductFacts } from "./productFacts";
import { analyzeProductImages } from "./geminiDescriptionClient";
import { normalizeSourceProduct } from "./sourceProductNormalizer";
import {
    buildSafeNameFallback,
    coerceSmartNameDraft,
    generateSmartNameWithGemini,
    getSmartNameModel,
    validateSmartNameDraft,
} from "./geminiNameClient";

function attachVisualFacts(snapshot: SourceProductSnapshot, facts: any[]): SourceProductSnapshot {
    if (!facts.length) return snapshot;
    const byUrl = new Map<string, any[]>();
    for (const fact of facts) {
        if (!fact.imageUrl) continue;
        if (!byUrl.has(fact.imageUrl)) byUrl.set(fact.imageUrl, []);
        byUrl.get(fact.imageUrl)!.push(fact);
    }
    const add = (images = []) => images.map((image: any) => ({
        ...image,
        visualFacts: [...(image.visualFacts || []), ...(byUrl.get(image.url) || [])],
    }));
    return {
        ...snapshot,
        images: add(snapshot.images as any),
        descriptionImages: add(snapshot.descriptionImages as any),
    };
}

export const generateSmartName = action({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<SmartNameResponse> => {
        const userId = await auth.getUserId(ctx);
        if (!userId) {
            return {
                ok: false,
                warnings: [],
                fallbackUsed: false,
                error: "Authentication required",
            };
        }
        if (process.env.SMART_NAME_ENABLED === "false") {
            return {
                ok: false,
                warnings: [],
                fallbackUsed: false,
                error: "Smart names are disabled",
            };
        }

        const typedRequest = request as SmartNameRequest;
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const warnings: string[] = [];
        console.log("[SmartName] started", {
            requestId,
            generationMode: typedRequest.generationMode,
            sourceDomain: typedRequest.sourceSnapshot?.sourceDomain,
            imageCount: typedRequest.sourceSnapshot?.images?.length || 0,
            hasAttributes: !!typedRequest.sourceSnapshot?.attributes?.length,
            hasVariants: !!typedRequest.sourceSnapshot?.variants?.length,
            selectedCollection: typedRequest.adminContext?.selectedCollection,
        });

        try {
            let sourceSnapshot = normalizeSourceProduct(typedRequest.sourceSnapshot || {});
            warnings.push(...(sourceSnapshot.warnings || []));

            if (typedRequest.options?.allowImageAnalysis) {
                const visual = await analyzeProductImages(sourceSnapshot);
                warnings.push(...visual.warnings);
                sourceSnapshot = attachVisualFacts(sourceSnapshot, visual.facts) as any;
            }

            const facts = extractNormalizedProductFacts(sourceSnapshot);
            console.log("[SmartName] facts extracted", {
                requestId,
                sourceQualityScore: facts.sourceQuality.score,
                productType: facts.productType.value,
                collection: facts.collection.value,
                designFacts: facts.designDetails.length,
            });

            const generated = await generateSmartNameWithGemini({
                facts,
                adminContext: typedRequest.adminContext || {},
            });
            warnings.push(...generated.warnings);

            let finalDraft = coerceSmartNameDraft(generated.value);
            let fallbackUsed = false;
            let fallbackReason: string | undefined;

            if (!finalDraft) {
                fallbackUsed = true;
                fallbackReason = "MALFORMED_MODEL_OUTPUT";
                finalDraft = buildSafeNameFallback(facts);
            }

            const validationErrors = validateSmartNameDraft(finalDraft, facts);
            if (validationErrors.length > 0) {
                fallbackUsed = true;
                fallbackReason = validationErrors.join(" ");
                warnings.push(...validationErrors);
                finalDraft = buildSafeNameFallback(facts);
            }

            console.log("[SmartName] generated", {
                requestId,
                model: getSmartNameModel(),
                name: finalDraft.name,
                fallbackUsed,
            });

            return {
                ok: true,
                name: finalDraft.name,
                structured: finalDraft,
                facts,
                warnings: [...new Set(warnings)],
                fallbackUsed,
                fallbackReason,
            };
        } catch (error: any) {
            const facts = extractNormalizedProductFacts(normalizeSourceProduct(typedRequest.sourceSnapshot || {}));
            const fallback = buildSafeNameFallback(facts);
            return {
                ok: true,
                name: fallback.name,
                structured: fallback,
                facts,
                warnings: [...new Set([...warnings, error?.message || "Smart name generation failed; safe fallback was used."])],
                fallbackUsed: true,
                fallbackReason: error?.message || "SMART_NAME_FAILED",
            };
        }
    },
});
