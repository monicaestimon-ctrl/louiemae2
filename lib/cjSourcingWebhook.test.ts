import { describe, expect, it } from "vitest";
import { parseCjSourcingWebhookEvidence } from "./cjSourcingWebhook";

describe("CJ sourcing webhook normalization", () => {
  it("normalizes completed sourcing evidence and identifier aliases", () => {
    expect(parseCjSourcingWebhookEvidence({
      sourceId: 12345,
      status: " SUCCESS ",
      pid: " pid-1 ",
      vid: "vid-1",
      sku: "sku-1",
      thirdProductId: "product-1",
    })).toEqual({
      ok: true,
      evidence: {
        sourcingId: "12345",
        thirdProductId: "product-1",
        evidence: "completed",
        cjProductId: "pid-1",
        cjVariantId: "vid-1",
        cjSku: "sku-1",
        statusText: "success",
      },
    });
  });

  it.each(["failed", "Rejected", "FAILED"])("normalizes %s as failed", (status) => {
    const parsed = parseCjSourcingWebhookEvidence({ cjSourcingId: "source-1", status });
    expect(parsed.ok && parsed.evidence.evidence).toBe("failed");
  });

  it("keeps unfamiliar provider states non-terminal", () => {
    const parsed = parseCjSourcingWebhookEvidence({ cjSourcingId: "source-1", sourceStatus: "reviewing" });
    expect(parsed.ok && parsed.evidence.evidence).toBe("unknown");
  });

  it("rejects payloads that cannot be correlated", () => {
    expect(parseCjSourcingWebhookEvidence({ status: "completed" })).toEqual({
      ok: false,
      error: "CJ sourcing webhook is missing a sourcing ID",
    });
  });
});
