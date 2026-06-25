import { parseCjWebhookPayload, type ParsedCjWebhookPayload } from "./cjWebhookRequest";

type CjWebhookSignatureResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

type CjWebhookClaimResult = {
  claimed: boolean;
  status?: string;
  claimToken?: string;
};

type ClaimedCjWebhook = {
  messageId: string;
  type: string;
  claimToken: string;
};

type CjWebhookLogger = {
  error: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
};

export type CjWebhookHttpDependencies = {
  verifySignature: (request: Request, rawBody: string) => Promise<CjWebhookSignatureResult>;
  claimWebhook: (messageId: string, type: string) => Promise<CjWebhookClaimResult>;
  handleWebhookTopic: (payload: ParsedCjWebhookPayload) => Promise<boolean>;
  markProcessed: (claim: ClaimedCjWebhook) => Promise<void>;
  markRetryable: (claim: ClaimedCjWebhook, error: string) => Promise<void>;
  markFailed: (claim: ClaimedCjWebhook) => Promise<void>;
  logger?: CjWebhookLogger;
};

export const cjJsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const handleCjWebhookHttpRequest = async (
  request: Request,
  deps: CjWebhookHttpDependencies,
): Promise<Response> => {
  const logger = deps.logger ?? console;
  let claimedWebhook: ClaimedCjWebhook | null = null;
  let selectedOutcome: "processed" | "retryable" | null = null;

  try {
    const rawBody = await request.text();
    const signatureResult = await deps.verifySignature(request, rawBody);
    if ("error" in signatureResult) {
      logger.warn(`CJ Webhook rejected: ${signatureResult.error}`);
      return cjJsonResponse({ success: false, error: signatureResult.error }, signatureResult.status);
    }

    const parsedPayload = parseCjWebhookPayload(rawBody);
    if ("error" in parsedPayload) {
      return cjJsonResponse({ success: false, error: parsedPayload.error }, parsedPayload.status);
    }

    const payload = parsedPayload.payload;
    logger.log(
      `CJ Webhook received: messageId=${payload.messageId} type=${payload.type} messageType=${payload.messageType}`,
    );

    const claimResult = await deps.claimWebhook(payload.messageId, payload.type);
    if (!claimResult.claimed) {
      logger.log(`CJ Webhook: Already claimed messageId=${payload.messageId}, skipping`);
      return cjJsonResponse({ success: true, skipped: true, status: claimResult.status });
    }
    if (typeof claimResult.claimToken !== "string") {
      throw new Error("CJ webhook claim did not return a claim token");
    }

    claimedWebhook = {
      messageId: payload.messageId,
      type: payload.type,
      claimToken: claimResult.claimToken,
    };

    const webhookHandled = await deps.handleWebhookTopic(payload);
    if (webhookHandled) {
      await deps.markProcessed(claimedWebhook);
      selectedOutcome = "processed";
      return cjJsonResponse({ success: true });
    }

    const retryMessage = `${payload.type} handler did not find a matching product`;
    logger.warn(`CJ Webhook: ${retryMessage}; returning 503 so CJ can retry messageId=${payload.messageId}`);
    await deps.markRetryable(claimedWebhook, retryMessage);
    selectedOutcome = "retryable";
    return cjJsonResponse({ success: false, retry: true, error: retryMessage }, 503);
  } catch (error: unknown) {
    logger.error("CJ Webhook error:", error);
    if (claimedWebhook && selectedOutcome === null) {
      try {
        await deps.markFailed(claimedWebhook);
      } catch (markError) {
        logger.error("Failed to mark CJ webhook failure:", markError);
      }
    }
    return cjJsonResponse({ success: false, error: "Internal server error" }, 500);
  }
};
