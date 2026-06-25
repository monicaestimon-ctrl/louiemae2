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
  cjProductId?: string;
  cjVariantId?: string;
  cjSku?: string;
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

const hasValue = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const labelProduct = (product: CjReadinessProduct): string => product.name?.trim() || "Product";

const labelVariant = (variant: CjReadinessVariant | undefined, item?: CjReadinessCheckoutItem): string =>
  variant?.name?.trim() || item?.variantName?.trim() || item?.variantId?.trim() || "selected variant";

const activeVariants = (product: CjReadinessProduct): CjReadinessVariant[] =>
  Array.isArray(product.variants) ? product.variants.filter((variant) => variant.inStock !== false) : [];

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
  }

  return { ready: errors.length === 0, errors, warnings };
};

export const evaluateCheckoutItemCjReadiness = (
  product: CjReadinessProduct,
  item: CjReadinessCheckoutItem,
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
  } else {
    if (!hasValue(product.cjVariantId)) {
      errors.push(`${productLabel} is missing a CJ variant ID.`);
    }
    if (!hasValue(product.cjSku)) {
      errors.push(`${productLabel} is missing a CJ SKU.`);
    }
  }

  if (item.quantity !== undefined && (!Number.isInteger(item.quantity) || item.quantity <= 0)) {
    errors.push(`${productLabel} has an invalid quantity.`);
  }

  return { ready: errors.length === 0, errors, warnings };
};
