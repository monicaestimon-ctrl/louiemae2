import { describe, expect, it } from "vitest";
import { parseCjWebhookPayload } from "./cjWebhookRequest";

describe("CJ webhook request parsing", () => {
  it("parses a valid CJ webhook payload", () => {
    expect(parseCjWebhookPayload(JSON.stringify({
      messageId: " msg-1 ",
      type: " ORDER ",
      messageType: " status ",
      params: { orderNumber: "ABC123" },
    }))).toEqual({
      ok: true,
      payload: {
        messageId: "msg-1",
        type: "ORDER",
        messageType: "status",
        params: { orderNumber: "ABC123" },
      },
    });
  });

  it("defaults missing messageType to unknown", () => {
    expect(parseCjWebhookPayload(JSON.stringify({
      messageId: "msg-2",
      type: "UNKNOWN_TOPIC",
      params: {},
    }))).toEqual({
      ok: true,
      payload: {
        messageId: "msg-2",
        type: "UNKNOWN_TOPIC",
        messageType: "unknown",
        params: {},
      },
    });
  });

  it("rejects invalid JSON", () => {
    expect(parseCjWebhookPayload("{")).toEqual({
      ok: false,
      status: 400,
      error: "Invalid webhook JSON",
    });
  });

  it.each([
    null,
    [],
    { messageId: "", type: "ORDER", params: {} },
    { messageId: "msg-3", type: "", params: {} },
    { messageId: "msg-4", type: "ORDER", params: null },
    { messageId: "msg-5", type: "ORDER", params: [] },
    { messageId: "msg-6", type: "ORDER", messageType: "", params: {} },
    { messageId: "msg-7", type: "ORDER", messageType: 7, params: {} },
  ])("rejects malformed payload %j", (payload) => {
    expect(parseCjWebhookPayload(JSON.stringify(payload))).toEqual({
      ok: false,
      status: 400,
      error: "Invalid webhook payload",
    });
  });
});
