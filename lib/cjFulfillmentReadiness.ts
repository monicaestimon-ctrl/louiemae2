import type { CjInventorySnapshot } from "./cjInventory";

export type CjReadinessVariant = {
  id?: string;
  name?: string;
  inStock?: boolean;
  cjVariantId?: string;
  cjSku?: string;
};

export type CjReadinessProduct = {
  name?: string;
  inStock?: boolean;
  cjSourcingStatus?: string;
  cjSourcingJobId?: string;
  cjSourcingState?: string;
  cjFulfillmentReadiness?: string;
  cjProductId?: string;
  cjVariantId?: string;
  cjSku?: string;
  cjInventoryStatus?: string;
  cjInventoryTotal?: number;
  cjInventoryLastCheckedAt?: string;
  cjInventoryError?: string;
  cjInventoryByVariant?: CjInventorySnapshot[];
  variants?: CjReadinessVariant[];
};

export type CjReadinessCheckoutItem = {
  variantId?: string;
  variantName?: string;
  quantity?: number;
};

export type CjReadinessResult = {
  ready: boolean;
  errors: string[];
  warnings: string[];
};

export type CjReadinessOptions = {
  strictInventory?: boolean;
};

export const isCjProductStorefrontReady = (product: Pick<CjReadinessProduct,
  "cjSourcingStatus" | "cjSourcingJobId" | "cjSourcingState" | "cjFulfillmentReadiness" |
  "cjProductId" | "cjVariantId" | "cjSku"
>): boolean => {
  const isCjManaged = Boolean(
    hasValue(product.cjSourcingJobId) ||
    hasValue(product.cjSourcingState) ||
    (hasValue(product.cjSourcingStatus) && product.cjSourcingStatus !== "none") ||
    hasValue(product.cjProductId) ||
    hasValue(product.cjVariantId) ||
    hasValue(product.cjSku)
  );
  return !isCjManaged || Boolean(
    hasValue(product.cjSourcingJobId) &&
    product.cjSourcingState === "fulfillment_ready" &&
    product.cjFulfillmentReadiness === "ready"
  );
};

const hasValue = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const labelProduct = (product: CjReadinessProduct): string => product.name?.trim() || "Product";

const labelVariant = (variant: CjReadinessVariant | undefined, item?: CjReadinessCheckoutItem): string =>
  variant?.name?.trim() || item?.variantName?.trim() || item?.variantId?.trim() || "selected variant";

const activeVariants = (product: CjReadinessProduct): CjReadinessVariant[] =>
  Array.isArray(product.variants) ? product.variants.filter((variant) => variant.inStock !== false) : [];

const findVariantInventory = (
  product: CjReadinessProduct,
  variant: CjReadinessVariant,
): CjInventorySnapshot | undefined => {
  const snapshots = Array.isArray(product.cjInventoryByVariant) ? product.cjInventoryByVariant : [];
  return snapshots.find((snapshot) =>
    (hasValue(variant.cjVariantId) && snapshot.vid === variant.cjVariantId) ||
    (hasValue(variant.cjSku) && snapshot.sku === variant.cjSku)
  );
};

const getProductInventorySnapshot = (product: CjReadinessProduct): CjInventorySnapshot | undefined => {
  if (!product.cjInventoryStatus) return undefined;
  return {
    status: product.cjInventoryStatus as CjInventorySnapshot["status"],
    totalInventoryNum: product.cjInventoryTotal,
    lastCheckedAt: product.cjInventoryLastCheckedAt || "",
    lowStockThreshold: 0,
    error: product.cjInventoryError,
  };
};

const addInventoryReadiness = (
  label: string,
  snapshot: CjInventorySnapshot | undefined,
  errors: string[],
  warnings: string[],
  quantity = 1,
  options: CjReadinessOptions = {},
) => {
  if (!snapshot) {
    if (options.strictInventory) {
      errors.push(`${label} inventory could not be confirmed with CJ.`);
    } else {
      warnings.push(`${label} has not been checked against CJ inventory.`);
    }
    return;
  }

  if (snapshot.status === "error") {
    const message = `${label} inventory could not be refreshed from CJ${snapshot.error ? `: ${snapshot.error}` : "."}`;
    if (options.strictInventory) {
      errors.push(message);
    } else {
      warnings.push(message);
    }
    return;
  }

  if (snapshot.totalInventoryNum !== undefined && snapshot.totalInventoryNum < quantity) {
    errors.push(`${label} has insufficient CJ inventory (${snapshot.totalInventoryNum} available).`);
    return;
  }

  if (snapshot.status === "out_of_stock") {
    errors.push(`${label} is out of stock at CJ.`);
  } else if (snapshot.status === "low_stock") {
    warnings.push(`${label} is low at CJ (${snapshot.totalInventoryNum ?? "unknown"} available).`);
  } else if (snapshot.status === "partial") {
    warnings.push(`${label} has partial CJ inventory availability.`);
  } else if (snapshot.status === "unknown") {
    if (options.strictInventory) {
      errors.push(`${label} inventory could not be confirmed with CJ.`);
    } else {
      warnings.push(`${label} has unknown CJ inventory availability.`);
    }
  }
};

export const evaluateProductCjReadiness = (product: CjReadinessProduct): CjReadinessResult => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const productLabel = labelProduct(product);

  if (product.inStock === false) {
    errors.push(`${productLabel} is marked out of stock.`);
  }
  if (product.cjSourcingStatus && product.cjSourcingStatus !== "approved") {
    errors.push(`${productLabel} is not approved by CJ.`);
  }
  if (!hasValue(product.cjSourcingJobId) || product.cjSourcingState !== "fulfillment_ready" || product.cjFulfillmentReadiness !== "ready") {
    errors.push(`${productLabel} is not fulfillment-ready in the CJ sourcing workflow.`);
  }
  if (!hasValue(product.cjProductId)) {
    errors.push(`${productLabel} is missing a CJ product ID.`);
  }

  const variants = activeVariants(product);
  if (variants.length > 0) {
    for (const variant of variants) {
      const variantLabel = `${productLabel} / ${labelVariant(variant)}`;
      if (!hasValue(variant.cjVariantId)) {
        errors.push(`${variantLabel} is missing a CJ variant ID.`);
      }
      if (!hasValue(variant.cjSku)) {
        errors.push(`${variantLabel} is missing a CJ SKU.`);
      }
      addInventoryReadiness(variantLabel, findVariantInventory(product, variant), errors, warnings);
    }
  } else if (Array.isArray(product.variants) && product.variants.length > 0) {
    errors.push(`${productLabel} has no sellable variants.`);
  } else {
    if (!hasValue(product.cjVariantId)) {
      errors.push(`${productLabel} is missing a CJ variant ID.`);
    }
    if (!hasValue(product.cjSku)) {
      errors.push(`${productLabel} is missing a CJ SKU.`);
    }
    addInventoryReadiness(productLabel, getProductInventorySnapshot(product), errors, warnings);
  }

  return { ready: errors.length === 0, errors, warnings };
};

export const evaluateCheckoutItemCjReadiness = (
  product: CjReadinessProduct,
  item: CjReadinessCheckoutItem,
  options: CjReadinessOptions = {},
): CjReadinessResult => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const productLabel = labelProduct(product);

  if (product.inStock === false) {
    errors.push(`${productLabel} is marked out of stock.`);
  }
  if (product.cjSourcingStatus && product.cjSourcingStatus !== "approved") {
    errors.push(`${productLabel} is not approved by CJ.`);
  }
  if (!hasValue(product.cjSourcingJobId) || product.cjSourcingState !== "fulfillment_ready" || product.cjFulfillmentReadiness !== "ready") {
    errors.push(`${productLabel} is not fulfillment-ready in the CJ sourcing workflow.`);
  }
  if (!hasValue(product.cjProductId)) {
    errors.push(`${productLabel} is missing a CJ product ID.`);
  }

  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (variants.length > 0) {
    if (!hasValue(item.variantId)) {
      errors.push(`${productLabel} requires a selected variant for CJ fulfillment.`);
      return { ready: false, errors, warnings };
    }

    const selectedVariant = variants.find((variant) => variant.id === item.variantId);
    if (!selectedVariant) {
      errors.push(`${productLabel} has an unknown selected variant.`);
      return { ready: false, errors, warnings };
    }

    const variantLabel = `${productLabel} / ${labelVariant(selectedVariant, item)}`;
    if (selectedVariant.inStock === false) {
      errors.push(`${variantLabel} is marked out of stock.`);
    }
    if (!hasValue(selectedVariant.cjVariantId)) {
      errors.push(`${variantLabel} is missing a CJ variant ID.`);
    }
    if (!hasValue(selectedVariant.cjSku)) {
      errors.push(`${variantLabel} is missing a CJ SKU.`);
    }
    addInventoryReadiness(variantLabel, findVariantInventory(product, selectedVariant), errors, warnings, item.quantity, options);
  } else {
    if (!hasValue(product.cjVariantId)) {
      errors.push(`${productLabel} is missing a CJ variant ID.`);
    }
    if (!hasValue(product.cjSku)) {
      errors.push(`${productLabel} is missing a CJ SKU.`);
    }
    addInventoryReadiness(productLabel, getProductInventorySnapshot(product), errors, warnings, item.quantity, options);
  }

  if (item.quantity !== undefined && (!Number.isInteger(item.quantity) || item.quantity <= 0)) {
    errors.push(`${productLabel} has an invalid quantity.`);
  }

  return { ready: errors.length === 0, errors, warnings };
};
