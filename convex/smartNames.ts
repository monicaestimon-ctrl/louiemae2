"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import type {
    GeneratedSmartNameDraft,
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

const MAX_MODEL_ATTEMPTS = 5;
const MAX_FALLBACK_ATTEMPTS = 80;

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
            return { ok: false, warnings: [], fallbackUsed: false, errorCode: "AUTH_REQUIRED", error: "Authentication required" };
        }
        try {
            await ctx.runQuery(internal.cjAdminAccess.verifyCjAdminIdentity, {});
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("[SmartName] Admin verification failed", { message });
            const permissionDenied = /logged in|missing an email|admin access|permission/i.test(message);
            return {
                ok: false,
                warnings: [],
                fallbackUsed: false,
                errorCode: permissionDenied ? "ADMIN_REQUIRED" : "ADMIN_CHECK_FAILED",
                error: permissionDenied ? "Admin permission required" : "Unable to verify admin access",
            };
        }
        if (process.env.SMART_NAME_ENABLED === "false") {
            return { ok: false, warnings: [], fallbackUsed: false, errorCode: "DISABLED", error: "Smart names are disabled" };
        }

        const typedRequest = request as SmartNameRequest;
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const ownerKey = typedRequest.ownerKey?.trim()
            || (typedRequest.productId ? `product:${typedRequest.productId}` : `generation:${requestId}`);
        const warnings: string[] = [];

        try {
            let sourceSnapshot = normalizeSourceProduct(typedRequest.sourceSnapshot || {});
            warnings.push(...(sourceSnapshot.warnings || []));
            if (typedRequest.options?.allowImageAnalysis) {
                const visual = await analyzeProductImages(sourceSnapshot);
                warnings.push(...visual.warnings);
                sourceSnapshot = attachVisualFacts(sourceSnapshot, visual.facts) as any;
            }

            const facts = extractNormalizedProductFacts(sourceSnapshot);
            let existingNames = await ctx.runQuery(internal.productNameRegistry.listNamesForGeneration, { limit: 240 });
            console.log("[SmartName] started", {
                requestId,
                ownerKey,
                generationMode: typedRequest.generationMode,
                sourceDomain: sourceSnapshot.sourceDomain,
                selectedCollection: typedRequest.adminContext?.selectedCollection,
                globalExcludedNameCount: existingNames.length,
            });

            for (let attempt = 0; attempt < MAX_MODEL_ATTEMPTS; attempt += 1) {
                let draft: GeneratedSmartNameDraft | undefined;
                let fallbackUsed = false;
                let fallbackReason: string | undefined;
                try {
                    const generated = await generateSmartNameWithGemini({
                        facts,
                        adminContext: typedRequest.adminContext || {},
                        existingNames,
                    });
                    warnings.push(...generated.warnings);
                    draft = coerceSmartNameDraft(generated.value);
                } catch (error) {
                    warnings.push(error instanceof Error ? error.message : String(error));
                }

                if (!draft) {
                    fallbackUsed = true;
                    fallbackReason = "MALFORMED_OR_UNAVAILABLE_MODEL_OUTPUT";
                    draft = buildSafeNameFallback(facts, existingNames);
                }
                const validationErrors = validateSmartNameDraft(draft, facts, existingNames);
                if (validationErrors.length > 0) {
                    warnings.push(...validationErrors);
                    fallbackUsed = true;
                    fallbackReason = validationErrors.join(" ");
                    draft = buildSafeNameFallback(facts, existingNames);
                }

                const reservation = await ctx.runMutation(internal.productNameRegistry.reserveSuggestion, {
                    displayName: draft.name,
                    ownerKey,
                    requestId,
                });
                if (reservation.reserved) {
                    console.log("[SmartName] reserved", {
                        requestId,
                        model: getSmartNameModel(),
                        name: draft.name,
                        fallbackUsed,
                        attempt: attempt + 1,
                    });
                    return {
                        ok: true,
                        name: draft.name,
                        structured: draft,
                        facts,
                        claimId: reservation.claimId,
                        ownerKey,
                        requestId,
                        warnings: [...new Set(warnings)],
                        fallbackUsed,
                        fallbackReason,
                    };
                }
                existingNames = [...existingNames, draft.name];
                warnings.push(`A generated name was already reserved; generating a fresh option (attempt ${attempt + 1}).`);
            }

            // The deterministic fallback includes an unbounded sequence once the curated pool is used.
            for (let attempt = 0; attempt < MAX_FALLBACK_ATTEMPTS; attempt += 1) {
                const draft = buildSafeNameFallback(facts, existingNames);
                const reservation = await ctx.runMutation(internal.productNameRegistry.reserveSuggestion, {
                    displayName: draft.name,
                    ownerKey,
                    requestId,
                });
                if (reservation.reserved) {
                    return {
                        ok: true,
                        name: draft.name,
                        structured: draft,
                        facts,
                        claimId: reservation.claimId,
                        ownerKey,
                        requestId,
                        warnings: [...new Set(warnings)],
                        fallbackUsed: true,
                        fallbackReason: "COLLISION_RETRY_FALLBACK",
                    };
                }
                existingNames = [...existingNames, draft.name];
            }

            return {
                ok: false,
                facts,
                warnings: [...new Set(warnings)],
                fallbackUsed: false,
                errorCode: "NAME_RESERVATION_EXHAUSTED",
                error: "A unique name could not be reserved. Please try again.",
                ownerKey,
                requestId,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("[SmartName] failed", { requestId, message });
            return {
                ok: false,
                warnings: [...new Set([...warnings, message])],
                fallbackUsed: false,
                errorCode: "SMART_NAME_FAILED",
                error: "A unique name could not be generated right now. Please try again.",
                ownerKey,
                requestId,
            };
        }
    },
});
