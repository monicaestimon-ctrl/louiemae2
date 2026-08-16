export const CJ_SOURCING_FIELD_MAX_LENGTH = 200;

export type CjSourcingPayload = {
  productName: string;
  productImage: string;
  productUrl: string;
  remark?: string;
  price?: string;
  thirdProductId: string;
};

export type CjSourcingPayloadInput = {
  productName: string;
  productImage?: string;
  productUrl: string;
  remark?: string;
  price?: number;
  thirdProductId: string;
};

export type CjSourcingValidationErrorCode =
  | "MISSING_PRODUCT_NAME"
  | "PRODUCT_NAME_TOO_LONG"
  | "MISSING_PRODUCT_IMAGE"
  | "INVALID_PRODUCT_IMAGE"
  | "PRODUCT_IMAGE_TOO_LONG"
  | "MISSING_PRODUCT_URL"
  | "INVALID_PRODUCT_URL"
  | "PRODUCT_URL_TOO_LONG"
  | "MISSING_THIRD_PRODUCT_ID";

export type CjSourcingPayloadResult =
  | { ok: true; payload: CjSourcingPayload }
  | { ok: false; code: CjSourcingValidationErrorCode; message: string };

const parsePublicHttpUrl = (value: string): URL | null => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase())) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const buildCjSourcingPayload = (
  input: CjSourcingPayloadInput,
): CjSourcingPayloadResult => {
  const productName = input.productName.trim();
  if (!productName) {
    return { ok: false, code: "MISSING_PRODUCT_NAME", message: "CJ sourcing requires a product name." };
  }
  if (productName.length > CJ_SOURCING_FIELD_MAX_LENGTH) {
    return { ok: false, code: "PRODUCT_NAME_TOO_LONG", message: "CJ product name exceeds 200 characters." };
  }

  const productImage = input.productImage?.trim() ?? "";
  if (!productImage) {
    return { ok: false, code: "MISSING_PRODUCT_IMAGE", message: "CJ sourcing requires a product image." };
  }
  if (!parsePublicHttpUrl(productImage)) {
    return { ok: false, code: "INVALID_PRODUCT_IMAGE", message: "CJ product image must be a public HTTP(S) URL." };
  }
  if (productImage.length > CJ_SOURCING_FIELD_MAX_LENGTH) {
    return { ok: false, code: "PRODUCT_IMAGE_TOO_LONG", message: "CJ product image URL exceeds 200 characters." };
  }

  const productUrl = input.productUrl.trim();
  if (!productUrl) {
    return { ok: false, code: "MISSING_PRODUCT_URL", message: "CJ sourcing requires a source URL." };
  }
  if (!parsePublicHttpUrl(productUrl)) {
    return { ok: false, code: "INVALID_PRODUCT_URL", message: "CJ source URL must be a public HTTP(S) URL." };
  }
  if (productUrl.length > CJ_SOURCING_FIELD_MAX_LENGTH) {
    return { ok: false, code: "PRODUCT_URL_TOO_LONG", message: "CJ source URL exceeds 200 characters." };
  }

  const thirdProductId = input.thirdProductId.trim();
  if (!thirdProductId) {
    return { ok: false, code: "MISSING_THIRD_PRODUCT_ID", message: "CJ sourcing requires an internal correlation ID." };
  }

  const remark = input.remark?.trim().slice(0, CJ_SOURCING_FIELD_MAX_LENGTH);
  return {
    ok: true,
    payload: {
      productName,
      productImage,
      productUrl,
      thirdProductId,
      ...(remark ? { remark } : {}),
      ...(Number.isFinite(input.price) && Number(input.price) > 0 ? { price: String(input.price) } : {}),
    },
  };
};

export type CjSourcingEvidence = "pending" | "processing" | "success" | "failure" | "unknown";

export const classifyCjSourcingStatus = (status: unknown): CjSourcingEvidence => {
  const normalized = String(status ?? "").trim();
  if (normalized === "1") return "pending";
  if (normalized === "2") return "processing";
  if (normalized === "3" || normalized === "9") return "success";
  if (normalized === "4" || normalized === "5") return "failure";
  return "unknown";
};

export const canApproveCjSourcing = (input: {
  catalogVerified: boolean;
  cjProductId?: string | null;
}) => input.catalogVerified && Boolean(input.cjProductId?.trim());

const canonicalPayloadJson = (payload: CjSourcingPayload) => JSON.stringify({
  productImage: payload.productImage,
  productName: payload.productName,
  productUrl: payload.productUrl,
  remark: payload.remark ?? null,
  price: payload.price ?? null,
  thirdProductId: payload.thirdProductId,
});

export const hashCjSourcingPayload = async (payload: CjSourcingPayload): Promise<string> => {
  const bytes = new globalThis.TextEncoder().encode(canonicalPayloadJson(payload));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};
