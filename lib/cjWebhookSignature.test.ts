import { describe, expect, it } from "vitest";
import { computeCjWebhookSignature, verifyCjWebhookSignature } from "./cjWebhookSignature";

describe("CJ webhook signatures", () => {
  const openId = "123";
  const rawBody = '{"messageId":"123111","messageType":"INSERT","params":"123","type":"PRODUCT"}';
  const expectedSignature = "AHxoGFMoS/4mZfJ5vFes5//Pz2QibFQhh3GlrTtnWpk=";

  it("matches CJ's documented HMAC-SHA256 Base64 sample", async () => {
    await expect(computeCjWebhookSignature(openId, rawBody)).resolves.toBe(expectedSignature);
  });

  it("accepts a matching signature", async () => {
    await expect(verifyCjWebhookSignature(openId, rawBody, expectedSignature)).resolves.toBe(true);
  });

  it("rejects a changed body", async () => {
    const reorderedBody = '{"type":"PRODUCT","messageType":"INSERT","messageId":"123111","params":"123"}';
    await expect(verifyCjWebhookSignature(openId, reorderedBody, expectedSignature)).resolves.toBe(false);
  });

  it("rejects a changed signature", async () => {
    await expect(verifyCjWebhookSignature(openId, rawBody, `${expectedSignature}x`)).resolves.toBe(false);
  });
});
