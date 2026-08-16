export type CjSourcingWebhookEvidence = {
  sourcingId: string;
  thirdProductId?: string;
  evidence: "completed" | "failed" | "unknown";
  cjProductId?: string;
  cjVariantId?: string;
  cjSku?: string;
  statusText?: string;
};

export type CjSourcingWebhookParseResult =
  | { ok: true; evidence: CjSourcingWebhookEvidence }
  | { ok: false; error: string };

const firstString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
};

export const parseCjSourcingWebhookEvidence = (
  params: Record<string, unknown>,
): CjSourcingWebhookParseResult => {
  const sourcingId = firstString(params.cjSourcingId, params.sourceId, params.id);
  if (!sourcingId) return { ok: false, error: "CJ sourcing webhook is missing a sourcing ID" };

  const rawStatus = firstString(params.status, params.sourceStatus)?.toLowerCase();
  const evidence = rawStatus === "completed" || rawStatus === "success" || rawStatus === "succeeded"
    ? "completed"
    : rawStatus === "failed" || rawStatus === "rejected"
      ? "failed"
      : "unknown";

  return {
    ok: true,
    evidence: {
      sourcingId,
      thirdProductId: firstString(params.thirdProductId),
      evidence,
      cjProductId: firstString(params.cjProductId, params.pid),
      cjVariantId: firstString(params.cjVariantId, params.vid),
      cjSku: firstString(params.cjVariantSku, params.sku),
      statusText: firstString(params.failReason, params.message, rawStatus),
    },
  };
};
