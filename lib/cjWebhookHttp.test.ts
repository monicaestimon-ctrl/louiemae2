import { describe, expect, it } from "vitest";
import {
  handleCjWebhookHttpRequest,
  type CjWebhookHttpDependencies,
} from "./cjWebhookHttp";
import { computeCjWebhookSignature, verifyCjWebhookSignature } from "./cjWebhookSignature";
import type { ParsedCjWebhookPayload } from "./cjWebhookRequest";

const openId = "test-open-id";
const noopLogger = {
  error: () => undefined,
  log: () => undefined,
  warn: () => undefined,
};

const signedRequest = async (
  payload: Record<string, unknown>,
  signatureOverride?: string,
): Promise<Request> => {
  const rawBody = JSON.stringify(payload);
  const signature = signatureOverride ?? await computeCjWebhookSignature(openId, rawBody);

  return new Request("https://louiemae.com/cj/webhook", {
    method: "POST",
    body: rawBody,
    headers: { sign: signature },
  });
};

const signatureVerifier: CjWebhookHttpDependencies["verifySignature"] = async (request, rawBody) => {
  const signature = request.headers.get("sign");
  if (!signature) {
    return { ok: false, status: 401, error: "Missing CJ webhook signature" };
  }

  const verified = await verifyCjWebhookSignature(openId, rawBody, signature);
  return verified
    ? { ok: true }
    : { ok: false, status: 401, error: "Invalid CJ webhook signature" };
};

const readJson = async (response: Response) => ({
  status: response.status,
  body: await response.json(),
});

const createDependencies = (overrides: Partial<CjWebhookHttpDependencies> = {}) => {
  const handledPayloads: ParsedCjWebhookPayload[] = [];
  const processedClaims: unknown[] = [];
  const retryableClaims: unknown[] = [];
  const failedClaims: unknown[] = [];

  const deps: CjWebhookHttpDependencies = {
    verifySignature: signatureVerifier,
    claimWebhook: async (messageId, type) => ({
      claimed: true,
      claimToken: `claim-${messageId}-${type}`,
    }),
    handleWebhookTopic: async (payload) => {
      handledPayloads.push(payload);
      return true;
    },
    markProcessed: async (claim) => {
      processedClaims.push(claim);
    },
    markRetryable: async (claim, error) => {
      retryableClaims.push({ claim, error });
    },
    markFailed: async (claim) => {
      failedClaims.push(claim);
    },
    logger: noopLogger,
    ...overrides,
  };

  return { deps, failedClaims, handledPayloads, processedClaims, retryableClaims };
};

describe("CJ webhook HTTP handling", () => {
  it("accepts a valid signed webhook, handles the topic, and marks it processed", async () => {
    const payload = {
      messageId: "msg-valid",
      type: "ORDER",
      messageType: "UPDATE",
      params: { orderNumber: "LM123" },
    };
    const { deps, handledPayloads, processedClaims, retryableClaims } = createDependencies();

    const response = await handleCjWebhookHttpRequest(await signedRequest(payload), deps);

    await expect(readJson(response)).resolves.toEqual({
      status: 200,
      body: { success: true },
    });
    expect(handledPayloads).toEqual([payload]);
    expect(processedClaims).toEqual([{
      messageId: "msg-valid",
      type: "ORDER",
      claimToken: "claim-msg-valid-ORDER",
    }]);
    expect(retryableClaims).toEqual([]);
  });

  it("rejects an invalid signature before claiming or handling the webhook", async () => {
    const payload = {
      messageId: "msg-invalid-signature",
      type: "ORDER",
      messageType: "UPDATE",
      params: {},
    };
    const claimCalls: Array<{ messageId: string; type: string }> = [];
    const { deps, handledPayloads, processedClaims } = createDependencies({
      claimWebhook: async (messageId, type) => {
        claimCalls.push({ messageId, type });
        return { claimed: true, claimToken: `claim-${messageId}-${type}` };
      },
    });

    const response = await handleCjWebhookHttpRequest(await signedRequest(payload, "bad-signature"), deps);

    await expect(readJson(response)).resolves.toEqual({
      status: 401,
      body: { success: false, error: "Invalid CJ webhook signature" },
    });
    expect(handledPayloads).toEqual([]);
    expect(processedClaims).toEqual([]);
    expect(claimCalls).toEqual([]);
  });

  it("returns success without side effects for duplicate webhook claims", async () => {
    const payload = {
      messageId: "msg-duplicate",
      type: "ORDER",
      messageType: "UPDATE",
      params: {},
    };
    const { deps, handledPayloads, processedClaims } = createDependencies({
      claimWebhook: async () => ({ claimed: false, status: "processed" }),
    });

    const response = await handleCjWebhookHttpRequest(await signedRequest(payload), deps);

    await expect(readJson(response)).resolves.toEqual({
      status: 200,
      body: { success: true, skipped: true, status: "processed" },
    });
    expect(handledPayloads).toEqual([]);
    expect(processedClaims).toEqual([]);
  });

  it("processes unknown webhook topics idempotently", async () => {
    const payload = {
      messageId: "msg-unknown",
      type: "SOMETHING_NEW",
      params: { futureField: true },
    };
    const { deps, handledPayloads, processedClaims } = createDependencies();

    const response = await handleCjWebhookHttpRequest(await signedRequest(payload), deps);

    await expect(readJson(response)).resolves.toEqual({
      status: 200,
      body: { success: true },
    });
    expect(handledPayloads).toEqual([{
      messageId: "msg-unknown",
      type: "SOMETHING_NEW",
      messageType: "unknown",
      params: { futureField: true },
    }]);
    expect(processedClaims).toEqual([{
      messageId: "msg-unknown",
      type: "SOMETHING_NEW",
      claimToken: "claim-msg-unknown-SOMETHING_NEW",
    }]);
  });

  it("marks the claimed webhook failed when the processed state write fails", async () => {
    const payload = {
      messageId: "msg-processed-write-fails",
      type: "ORDER",
      params: {},
    };
    const { deps, failedClaims } = createDependencies({
      markProcessed: async () => {
        throw new Error("database unavailable");
      },
    });

    const response = await handleCjWebhookHttpRequest(await signedRequest(payload), deps);

    await expect(readJson(response)).resolves.toEqual({
      status: 500,
      body: { success: false, error: "Internal server error" },
    });
    expect(failedClaims).toEqual([{
      messageId: "msg-processed-write-fails",
      type: "ORDER",
      claimToken: "claim-msg-processed-write-fails-ORDER",
    }]);
  });

  it("marks the claimed webhook failed when the retryable state write fails", async () => {
    const payload = {
      messageId: "msg-retryable-write-fails",
      type: "SOURCINGCREATE",
      params: {},
    };
    const { deps, failedClaims } = createDependencies({
      handleWebhookTopic: async () => false,
      markRetryable: async () => {
        throw new Error("database unavailable");
      },
    });

    const response = await handleCjWebhookHttpRequest(await signedRequest(payload), deps);

    await expect(readJson(response)).resolves.toEqual({
      status: 500,
      body: { success: false, error: "Internal server error" },
    });
    expect(failedClaims).toEqual([{
      messageId: "msg-retryable-write-fails",
      type: "SOURCINGCREATE",
      claimToken: "claim-msg-retryable-write-fails-SOURCINGCREATE",
    }]);
  });
});
