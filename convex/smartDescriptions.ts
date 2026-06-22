"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { createHash } from "crypto";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import {
    SmartDescriptionRequest,
    SmartDescriptionResponse,
    SourceProductSnapshot,
    coerceGeneratedDescriptionDraft,
    formatDescription,
} from "../lib/smartDescription";
import { LOUIE_MAE_BRAND_VOICE, BRAND_VOICE_VERSION, SMART_DESCRIPTION_PROMPT_VERSION } from "./brandVoice";
import { extractNormalizedProductFacts } from "./productFacts";
import {
    buildSafeFallbackDescription,
    isRepairableValidationIssue,
    validateGeneratedDescription,
} from "./descriptionValidators";
import {
    analyzeProductImages,
    generateDescriptionDraftWithGemini,
    getSmartDescriptionModel,
    repairDescriptionDraftWithGemini,
} from "./geminiDescriptionClient";
import { normalizeSourceProduct } from "./sourceProductNormalizer";

function hashSnapshot(snapshot: SourceProductSnapshot): string {
    const canonical = stableStringify(snapshot);
    return createHash("sha256").update(canonical).digest("hex");
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
    }
    if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

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

export const generateSmartDescription = action({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<SmartDescriptionResponse> => {
        const userId = await auth.getUserId(ctx);
        if (!userId) {
            return {
                ok: false,
                warnings: [],
                validation: {
                    passed: false,
                    errors: [{ code: "GENERIC_COPY", message: "Authentication required.", severity: "error" }],
                    warnings: [],
                    claimChecks: [],
                    repaired: false,
                },
                fallbackUsed: false,
                error: "Authentication required",
            };
        }
        if (process.env.SMART_DESCRIPTION_ENABLED === "false") {
            return {
                ok: false,
                warnings: [],
                validation: {
                    passed: false,
                    errors: [{ code: "GENERIC_COPY", message: "Smart descriptions are disabled.", severity: "error" }],
                    warnings: [],
                    claimChecks: [],
                    repaired: false,
                },
                fallbackUsed: false,
                error: "Smart descriptions are disabled",
            };
        }

        const typedRequest = request as SmartDescriptionRequest;
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const warnings: string[] = [];
        console.log("[SmartDescription] started", {
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
            console.log("[SmartDescription] facts extracted", {
                requestId,
                sourceQualityScore: facts.sourceQuality.score,
                productType: facts.productType.value,
                collection: facts.collection.value,
                factCountsByType: {
                    design: facts.designDetails.length,
                    materials: facts.materials.length,
                    variants: facts.variants.length,
                    dimensions: facts.dimensions.length,
                },
            });

            const similarDescriptions = await ctx.runQuery(internal.descriptionAudits.findSimilarDescriptions, {
                collection: facts.collection.value,
                productType: facts.productType.value,
                limit: 10,
            });

            const generated = await generateDescriptionDraftWithGemini({
                facts,
                brandVoice: LOUIE_MAE_BRAND_VOICE,
                similarDescriptions,
                adminContext: typedRequest.adminContext || {},
            });
            warnings.push(...generated.warnings);
            let finalDraft = coerceGeneratedDescriptionDraft(generated.value);
            let repaired = false;
            let rawModelResponse = generated.raw;
            let fallbackUsed = false;
            let fallbackReason: string | undefined;
            let validation;

            if (!finalDraft) {
                fallbackUsed = true;
                fallbackReason = "MALFORMED_MODEL_OUTPUT";
                warnings.push("Smart description model returned malformed output; safe fallback copy was used.");
                console.log("[SmartDescription] fallback used", { requestId, fallbackReason });
                finalDraft = buildSafeFallbackDescription(facts, sourceSnapshot);
                validation = validateGeneratedDescription({
                    draft: finalDraft,
                    facts,
                    brandVoice: LOUIE_MAE_BRAND_VOICE,
                    similarDescriptions,
                });
            } else {
                validation = validateGeneratedDescription({
                    draft: finalDraft,
                    facts,
                    brandVoice: LOUIE_MAE_BRAND_VOICE,
                    similarDescriptions,
                });
            }

            if (!fallbackUsed && !validation.passed && validation.errors.every(isRepairableValidationIssue)) {
                console.log("[SmartDescription] validation failed", {
                    requestId,
                    issueCodes: validation.errors.map(issue => issue.code),
                });
                const repairedResult = await repairDescriptionDraftWithGemini({
                    draft: finalDraft,
                    validation,
                    facts,
                    brandVoice: LOUIE_MAE_BRAND_VOICE,
                });
                warnings.push(...repairedResult.warnings);
                const repairedDraft = coerceGeneratedDescriptionDraft(repairedResult.value);
                if (repairedDraft) {
                    finalDraft = repairedDraft;
                    rawModelResponse = repairedResult.raw || rawModelResponse;
                    repaired = true;
                    validation = validateGeneratedDescription({
                        draft: finalDraft,
                        facts,
                        brandVoice: LOUIE_MAE_BRAND_VOICE,
                        similarDescriptions,
                    });
                }
            }

            if (!validation.passed) {
                fallbackUsed = true;
                fallbackReason = validation.errors.map(issue => issue.code).join(", ");
                repaired = false;
                console.log("[SmartDescription] fallback used", { requestId, fallbackReason });
                finalDraft = buildSafeFallbackDescription(facts, sourceSnapshot);
                validation = validateGeneratedDescription({
                    draft: finalDraft,
                    facts,
                    brandVoice: LOUIE_MAE_BRAND_VOICE,
                    similarDescriptions,
                });
            }

            validation = { ...validation, repaired };
            const description = formatDescription(finalDraft);
            const sourceSnapshotHash = hashSnapshot(sourceSnapshot);
            const auditId = await ctx.runMutation(internal.descriptionAudits.createDescriptionAudit, {
                productId: typedRequest.productId as any,
                importSessionId: typedRequest.importSessionId,
                sourceUrl: sourceSnapshot.sourceUrl,
                sourceDomain: sourceSnapshot.sourceDomain,
                generationMode: typedRequest.generationMode,
                model: getSmartDescriptionModel(),
                promptVersion: SMART_DESCRIPTION_PROMPT_VERSION,
                brandVoiceVersion: BRAND_VOICE_VERSION,
                sourceSnapshotHash,
                sourceSnapshot,
                normalizedFacts: facts,
                generatedDraft: finalDraft,
                finalDescription: description,
                rawModelResponse,
                validation,
                fallbackUsed,
                fallbackReason,
                adminEdited: false,
                warnings: [...new Set([...warnings, ...validation.warnings.map(issue => issue.message)])],
                createdBy: userId,
            });

            console.log("[SmartDescription] generated", {
                requestId,
                model: getSmartDescriptionModel(),
                promptVersion: SMART_DESCRIPTION_PROMPT_VERSION,
                outputLength: description.length,
                detailLineCount: finalDraft.detailLines.length,
            });

            return {
                ok: true,
                description,
                structured: finalDraft,
                facts,
                auditId,
                warnings: [...new Set([...warnings, ...validation.warnings.map(issue => issue.message)])],
                validation,
                fallbackUsed,
                fallbackReason,
            };
        } catch (error: any) {
            return {
                ok: false,
                warnings,
                validation: {
                    passed: false,
                    errors: [{ code: "GENERIC_COPY", message: error?.message || "Smart description generation failed.", severity: "error" }],
                    warnings: [],
                    claimChecks: [],
                    repaired: false,
                },
                fallbackUsed: false,
                error: error?.message || "Smart description generation failed",
            };
        }
    },
});
