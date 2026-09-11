"use node";
import { classifyAiProviderError, sanitizeAiWarning } from '../lib/aiProviderErrors';

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
        try {
            await ctx.runQuery(internal.cjAdminAccess.verifyCjAdminIdentity, {});
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("[SmartDescription] Admin verification failed", { message });
            const permissionDenied = /logged in|missing an email|admin access|permission/i.test(message);
            return {
                ok: false,
                warnings: [],
                validation: {
                    passed: false,
                    errors: [{
                        code: "GENERIC_COPY",
                        message: permissionDenied ? "Admin permission required." : "Admin verification is unavailable.",
                        severity: "error",
                    }],
                    warnings: [],
                    claimChecks: [],
                    repaired: false,
                },
                fallbackUsed: false,
                error: permissionDenied ? "Admin permission required" : "Unable to verify admin access",
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
            const prepared = await ctx.runAction(internal.productSourceActions.prepare, { request: typedRequest });
            let sourceSnapshot = normalizeSourceProduct(prepared.sourceSnapshot);
            warnings.push(...prepared.warnings);
            warnings.push(...(sourceSnapshot.warnings || []));

            if (typedRequest.options?.allowImageAnalysis) {
                const imageUrls = [...sourceSnapshot.images, ...(sourceSnapshot.descriptionImages || [])].map(image => image.url);
                const visualCacheKey = createHash('sha256').update(JSON.stringify({ imageUrls, model: getSmartDescriptionModel(), prompt: 'visual-facts-v1' })).digest('hex');
                const cached = await ctx.runQuery(internal.visualFactCache.get, { cacheKey: visualCacheKey });
                const visual = cached || await analyzeProductImages(sourceSnapshot);
                if (!cached) await ctx.runMutation(internal.visualFactCache.put, {
                    cacheKey: visualCacheKey, sourceSnapshotHash: hashSnapshot(sourceSnapshot), model: getSmartDescriptionModel(),
                    promptVersion: 'visual-facts-v1', visualFacts: visual.facts, warnings: visual.warnings,
                    ttlMs: visual.facts.length ? undefined : 5 * 60 * 1000,
                });
                warnings.push(...visual.warnings.map(sanitizeAiWarning));
                sourceSnapshot = attachVisualFacts(sourceSnapshot, visual.facts) as any;
            }

            const facts = extractNormalizedProductFacts(sourceSnapshot);
            warnings.push(...facts.missingImportantFacts.map(fact => `Missing source fact: ${fact}.`));
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

            let providerErrorCode: string | undefined;
            let providerRetryable: boolean | undefined;
            let generated: Awaited<ReturnType<typeof generateDescriptionDraftWithGemini>> = { warnings: [] };
            try {
                generated = await generateDescriptionDraftWithGemini({ facts, brandVoice: LOUIE_MAE_BRAND_VOICE, similarDescriptions, adminContext: typedRequest.adminContext || {} });
            } catch (error) {
                const failure = classifyAiProviderError(error);
                providerErrorCode = failure.code;
                providerRetryable = failure.retryable;
                warnings.push(failure.message);
            }
            warnings.push(...generated.warnings);
            let finalDraft = coerceGeneratedDescriptionDraft(generated.value);
            let repaired = false;
            let rawModelResponse = generated.raw;
            let fallbackUsed = false;
            let fallbackReason: string | undefined;
            let validation;

            if (!finalDraft) {
                fallbackUsed = true;
                fallbackReason = providerErrorCode || "MALFORMED_MODEL_OUTPUT";
                if (!providerErrorCode) warnings.push("The AI response could not be used. A limited draft is available for review.");
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
                let repairedResult: Awaited<ReturnType<typeof repairDescriptionDraftWithGemini>> = { warnings: [] };
                try {
                    repairedResult = await repairDescriptionDraftWithGemini({ draft: finalDraft, validation, facts, brandVoice: LOUIE_MAE_BRAND_VOICE });
                } catch (error) {
                    warnings.push(classifyAiProviderError(error).message);
                }
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
                fallbackReason = fallbackReason || validation.errors.map(issue => issue.code).join(", ");
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
            const sourceSnapshotHash = prepared.sourceHash;
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
                sourceSnapshotId: prepared.sourceSnapshotId,
                selectedCjVariantIds: typedRequest.selection?.variants.flatMap(v => v.cjVariantId ? [v.cjVariantId] : []),
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
                providerErrorCode,
                providerRetryable,
            });

            console.log("[SmartDescription] generated", {
                requestId,
                model: getSmartDescriptionModel(),
                promptVersion: SMART_DESCRIPTION_PROMPT_VERSION,
                outputLength: description.length,
                detailLineCount: finalDraft.detailLines.length,
            });

            const insufficientEvidence = fallbackUsed && facts.designDetails.length + facts.materials.length + facts.patternOrFinish.length
                + facts.fitOrSilhouette.length + facts.functionalDetails.length + facts.dimensions.length === 0;
            return {
                ok: !insufficientEvidence,
                error: insufficientEvidence ? 'There are not enough verified product details to write a description. Confirm supplier facts or select clearer photos, then try again.' : undefined,
                description,
                sourceSnapshotId: prepared.sourceSnapshotId,
                model: getSmartDescriptionModel(), promptVersion: SMART_DESCRIPTION_PROMPT_VERSION, sourceSnapshotHash,
                providerErrorCode, providerRetryable,
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
