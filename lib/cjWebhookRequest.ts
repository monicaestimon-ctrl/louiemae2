export type ParsedCjWebhookPayload = {
  messageId: string;
  type: string;
  messageType: string;
  params: Record<string, unknown>;
};

export type CjWebhookPayloadParseResult =
  | { ok: true; payload: ParsedCjWebhookPayload }
  | { ok: false; status: 400; error: string };

export const parseCjWebhookPayload = (rawBody: string): CjWebhookPayloadParseResult => {
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, error: "Invalid webhook JSON" };
  }

  if (parsedBody === null || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
    return { ok: false, status: 400, error: "Invalid webhook payload" };
  }

  const body = parsedBody as Record<string, unknown>;
  const { messageId, type, messageType, params } = body;

  if (typeof messageId !== "string" || !messageId.trim() || typeof type !== "string" || !type.trim()) {
    return { ok: false, status: 400, error: "Invalid webhook payload" };
  }

  if (messageType !== undefined && (typeof messageType !== "string" || !messageType.trim())) {
    return { ok: false, status: 400, error: "Invalid webhook payload" };
  }

  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    return { ok: false, status: 400, error: "Invalid webhook payload" };
  }

  const normalizedMessageType = typeof messageType === "string" ? messageType.trim() : "unknown";

  return {
    ok: true,
    payload: {
      messageId: messageId.trim(),
      type: type.trim(),
      messageType: normalizedMessageType,
      params: params as Record<string, unknown>,
    },
  };
};
