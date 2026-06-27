export type CjAdminSeverity = "critical" | "warning" | "info";

export type CjAdminRiskType =
  | "automation"
  | "mapping"
  | "shipping"
  | "fulfillment"
  | "payment"
  | "tracking"
  | "inventory"
  | "notification"
  | "refund"
  | "pricing";

export type CjAdminOrderItem = {
  name: string;
  quantity: number;
  cjVariantId?: string;
  cjSku?: string;
};

export type CjAdminOrderInput = {
  _id?: string;
  stripeSessionId?: string;
  customerEmail: string;
  customerName?: string;
  items: CjAdminOrderItem[];
  total: number;
  currency: string;
  status: string;
  shippingAddress?: unknown;
  cjOrderId?: string;
  cjStatus?: string;
  cjError?: string;
  cjLastSyncAt?: string;
  cjAutomationMode?: string;
  cjFulfillmentStep?: string;
  cjFulfillmentLastStepAt?: string;
  cjFulfillmentRetryCount?: number;
  cjPaymentStatus?: string;
  cjParentOrderId?: string;
  cjPayId?: string;
  cjPaymentUrl?: string;
  cjPaymentAmount?: number;
  cjAutoPaymentAttemptedAt?: string;
  cjAutoPaymentError?: string;
  cjQuotedLogisticsName?: string;
  cjEstimatedProfit?: number;
  cjPricingWarnings?: string[];
  trackingNumber?: string;
  trackingUrl?: string;
  carrier?: string;
  cjTrackingStatus?: string;
  trackingNotificationSentFor?: string;
  trackingNotificationSentAt?: string;
  shippedAt?: string;
  estimatedDelivery?: string;
  createdAt: string;
  updatedAt: string;
};

export type CjAdminProductInput = {
  _id?: string;
  name: string;
  cjSourcingStatus?: string;
  cjProductId?: string;
  cjVariantId?: string;
  cjSku?: string;
  variants?: Array<{
    name: string;
    cjVariantId?: string;
    cjSku?: string;
    inStock?: boolean;
  }>;
  cjInventoryStatus?: string;
  cjInventoryTotal?: number;
  cjInventoryLastCheckedAt?: string;
  cjInventoryError?: string;
  sourceUrl?: string;
  inStock?: boolean;
};

export type CjAdminAutomationState = {
  fulfillmentAutomationReady: boolean;
  balancePaymentReady: boolean;
  autoFulfillmentEnabled: boolean;
  autoBalancePayEnabled: boolean;
  webhookUrlConfigured: boolean;
  webhookSignatureVerificationRequired: boolean;
  apiKeyConfigured: boolean;
  warnings: string[];
  mode: string;
};

export type CjAdminPipelineState =
  | "not_cj"
  | "needs_review"
  | "paid_on_louie_mae"
  | "ready_for_cj"
  | "sending_to_cj"
  | "cj_order_created"
  | "cj_cart_confirmed"
  | "waiting_for_cj_payment"
  | "paid_in_cj"
  | "waiting_for_tracking"
  | "in_transit"
  | "delivered"
  | "cancelled";

export type CjControlRoomOrder = {
  orderId?: string;
  customerName: string;
  customerEmail: string;
  total: number;
  currency: string;
  status: string;
  pipelineState: CjAdminPipelineState;
  pipelineLabel: string;
  pipelineRank: number;
  needsReview: boolean;
  nextAction: string;
  nextActionKey:
    | "none"
    | "retry_order"
    | "sync_order_tracking"
    | "refresh_inventory"
    | "open_cj_payment"
    | "review_mapping"
    | "review_shipping"
    | "review_refund";
  cjOrderId?: string;
  cjParentOrderId?: string;
  cjPaymentStatus?: string;
  cjFulfillmentStep?: string;
  cjStatus?: string;
  cjError?: string;
  cjPaymentUrl?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  carrier?: string;
  cjTrackingStatus?: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  risks: CjAdminRisk[];
};

export type CjAdminRisk = {
  key: string;
  type: CjAdminRiskType;
  severity: CjAdminSeverity;
  title: string;
  description: string;
  nextAction: string;
  actionKey:
    | "none"
    | "retry_order"
    | "sync_order_tracking"
    | "sync_all_tracking"
    | "refresh_inventory"
    | "configure_webhooks"
    | "open_cj_payment"
    | "review_mapping"
    | "review_shipping"
    | "review_refund"
    | "resend_customer_update";
  orderId?: string;
  productId?: string;
  createdAt: string;
  reviewed?: {
    reviewedAt: string;
    note?: string;
    actorEmail?: string;
  };
};

export type CjReviewedRiskAudit = {
  riskKey?: string;
  reviewedAt?: string;
  createdAt: string;
  note?: string;
  actorEmail?: string;
};

export type CjControlRoomSummary = {
  totalCjOrders: number;
  needsReview: number;
  readyForCj: number;
  waitingForPayment: number;
  waitingForTracking: number;
  inTransit: number;
  delivered: number;
  criticalRisks: number;
  warningRisks: number;
};

export type CjRiskSummary = {
  totalRisks: number;
  critical: number;
  warning: number;
  info: number;
  orderRisks: number;
  productRisks: number;
};

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const PIPELINE_RANKS: Record<CjAdminPipelineState, number> = {
  not_cj: 0,
  needs_review: 1,
  paid_on_louie_mae: 2,
  ready_for_cj: 3,
  sending_to_cj: 4,
  cj_order_created: 5,
  cj_cart_confirmed: 6,
  waiting_for_cj_payment: 7,
  paid_in_cj: 8,
  waiting_for_tracking: 9,
  in_transit: 10,
  delivered: 11,
  cancelled: 12,
};

const PIPELINE_LABELS: Record<CjAdminPipelineState, string> = {
  not_cj: "Not a CJ order",
  needs_review: "Needs review",
  paid_on_louie_mae: "Paid on Louie Mae",
  ready_for_cj: "Ready for CJ",
  sending_to_cj: "Sending to CJ",
  cj_order_created: "CJ order created",
  cj_cart_confirmed: "CJ cart confirmed",
  waiting_for_cj_payment: "Waiting for CJ payment",
  paid_in_cj: "Paid in CJ",
  waiting_for_tracking: "Waiting for tracking",
  in_transit: "In transit",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const SEVERITY_RANK: Record<CjAdminSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const hasValue = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const toTime = (value: string | undefined): number => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const ageMs = (value: string | undefined, nowMs: number): number => {
  const time = toTime(value);
  return time > 0 ? nowMs - time : Number.POSITIVE_INFINITY;
};

export const isCjFulfillmentOrder = (order: CjAdminOrderInput): boolean =>
  order.items.some((item) => hasValue(item.cjVariantId) || hasValue(item.cjSku)) ||
  hasValue(order.cjOrderId) ||
  hasValue(order.cjStatus) ||
  hasValue(order.cjFulfillmentStep) ||
  hasValue(order.cjPaymentStatus) ||
  hasValue(order.trackingNumber);

export const orderHasMissingCjMapping = (order: CjAdminOrderInput): boolean =>
  order.items.some((item) => !hasValue(item.cjVariantId) || !hasValue(item.cjSku));

export const getCjOrderPipelineState = (order: CjAdminOrderInput): CjAdminPipelineState => {
  if (!isCjFulfillmentOrder(order)) return "not_cj";
  if (order.status === "cancelled") return "cancelled";
  if (order.cjStatus === "delivered" || order.status === "delivered") return "delivered";
  if (order.cjStatus === "shipped" || hasValue(order.trackingNumber)) return "in_transit";
  if (order.cjError || order.cjAutoPaymentError || order.cjStatus === "failed" || order.cjFulfillmentStep === "failed" || order.cjPaymentStatus === "failed") {
    return "needs_review";
  }
  if (orderHasMissingCjMapping(order)) return "needs_review";
  if (!order.shippingAddress) return "needs_review";
  if (order.cjPaymentStatus === "manual_payment_required" || order.cjPaymentStatus === "balance_payment_ready" || order.cjPaymentStatus === "payment_order_generated") {
    return "waiting_for_cj_payment";
  }
  if (order.cjFulfillmentStep === "payment_order_generated" || hasValue(order.cjPayId) || hasValue(order.cjPaymentUrl)) {
    return "waiting_for_cj_payment";
  }
  if (order.cjPaymentStatus === "paid" || order.cjFulfillmentStep === "paid" || order.cjFulfillmentStep === "processing" || order.cjStatus === "processing") {
    return "waiting_for_tracking";
  }
  if (order.cjFulfillmentStep === "cart_confirmed" || order.cjFulfillmentStep === "generating_payment_order") {
    return "cj_cart_confirmed";
  }
  if (hasValue(order.cjOrderId) || order.cjFulfillmentStep === "order_created" || order.cjFulfillmentStep === "cart_added" || order.cjStatus === "confirmed") {
    return "cj_order_created";
  }
  if (order.cjStatus === "sending" || order.cjFulfillmentStep === "creating_order" || order.cjFulfillmentStep === "adding_to_cart" || order.cjFulfillmentStep === "confirming_cart") {
    return "sending_to_cj";
  }
  if (order.status === "paid" || order.status === "processing") return "ready_for_cj";
  return "paid_on_louie_mae";
};

const getLastActivityAt = (order: CjAdminOrderInput): string =>
  [
    order.updatedAt,
    order.cjFulfillmentLastStepAt,
    order.cjLastSyncAt,
    order.cjAutoPaymentAttemptedAt,
    order.trackingNotificationSentAt,
    order.shippedAt,
    order.createdAt,
  ]
    .filter(hasValue)
    .sort((a, b) => toTime(b) - toTime(a))[0] || order.updatedAt;

const createOrderRisk = (
  order: CjAdminOrderInput,
  key: string,
  type: CjAdminRiskType,
  severity: CjAdminSeverity,
  title: string,
  description: string,
  nextAction: string,
  actionKey: CjAdminRisk["actionKey"],
): CjAdminRisk => ({
  key: `order:${order._id || order.stripeSessionId || order.customerEmail}:${key}`,
  type,
  severity,
  title,
  description,
  nextAction,
  actionKey,
  orderId: order._id,
  createdAt: getLastActivityAt(order),
});

export const getCjOrderRisks = (order: CjAdminOrderInput, nowMs = Date.now()): CjAdminRisk[] => {
  if (!isCjFulfillmentOrder(order)) return [];

  const risks: CjAdminRisk[] = [];
  const pipelineState = getCjOrderPipelineState(order);
  const lastStepAge = ageMs(order.cjFulfillmentLastStepAt || order.updatedAt, nowMs);

  if (order.status === "cancelled" && order.cjOrderId && order.cjStatus !== "cancelled" && order.cjStatus !== "delivered") {
    risks.push(createOrderRisk(
      order,
      "refund-review",
      "refund",
      "critical",
      "Refund review needed",
      "This order is cancelled locally, but CJ may still be processing it.",
      "Open the CJ order and confirm fulfillment should stop.",
      "review_refund",
    ));
  }

  if (orderHasMissingCjMapping(order)) {
    risks.push(createOrderRisk(
      order,
      "mapping-missing",
      "mapping",
      "critical",
      "Product mapping missing",
      "One or more items are missing a CJ variant ID or SKU.",
      "Fix the product mapping before retrying CJ fulfillment.",
      "review_mapping",
    ));
  }

  if (!order.shippingAddress) {
    risks.push(createOrderRisk(
      order,
      "shipping-address-missing",
      "shipping",
      "critical",
      "Shipping address missing",
      "CJ cannot quote shipping or fulfill the order without a shipping address.",
      "Review the order shipping details before retrying.",
      "review_shipping",
    ));
  }

  if (order.cjError || order.cjStatus === "failed" || order.cjFulfillmentStep === "failed") {
    risks.push(createOrderRisk(
      order,
      "fulfillment-failed",
      "fulfillment",
      "critical",
      "CJ fulfillment failed",
      order.cjError || "CJ did not accept the fulfillment step.",
      "Retry CJ order after reviewing the error.",
      "retry_order",
    ));
  }

  if (order.cjAutoPaymentError || order.cjPaymentStatus === "failed") {
    risks.push(createOrderRisk(
      order,
      "payment-failed",
      "payment",
      "critical",
      "CJ payment failed",
      order.cjAutoPaymentError || "CJ payment did not complete.",
      "Check CJ balance and payment status before retrying.",
      "open_cj_payment",
    ));
  }

  if (pipelineState === "waiting_for_cj_payment" && lastStepAge > 2 * MS_PER_HOUR) {
    risks.push(createOrderRisk(
      order,
      "payment-waiting",
      "payment",
      "critical",
      "CJ payment not complete",
      "The payment order exists, but CJ has not been paid yet.",
      "Open the CJ payment page or confirm balance payment is enabled.",
      "open_cj_payment",
    ));
  }

  if (pipelineState === "waiting_for_tracking" && lastStepAge > 3 * MS_PER_DAY) {
    risks.push(createOrderRisk(
      order,
      "tracking-missing",
      "tracking",
      "warning",
      "Tracking is late",
      "CJ is paid or processing, but no tracking number is saved yet.",
      "Sync tracking for this order.",
      "sync_order_tracking",
    ));
  }

  if (["sending_to_cj", "cj_order_created", "cj_cart_confirmed"].includes(pipelineState) && lastStepAge > 6 * MS_PER_HOUR) {
    risks.push(createOrderRisk(
      order,
      "step-stuck",
      "fulfillment",
      "warning",
      "Order has not moved",
      "This order has stayed in the same CJ step longer than expected.",
      "Retry CJ order or check CJ directly.",
      "retry_order",
    ));
  }

  if (hasValue(order.trackingNumber) && order.trackingNotificationSentFor !== order.trackingNumber) {
    risks.push(createOrderRisk(
      order,
      "tracking-email-missing",
      "notification",
      "warning",
      "Customer tracking update not confirmed",
      "Tracking exists, but the matching customer notification is not confirmed.",
      "Resend the customer tracking update after confirming the tracking number.",
      "resend_customer_update",
    ));
  }

  if ((order.cjPricingWarnings?.length ?? 0) > 0) {
    risks.push(createOrderRisk(
      order,
      "pricing-warning",
      "pricing",
      "warning",
      "Cost or margin needs review",
      order.cjPricingWarnings?.join(" ") || "CJ pricing has warnings.",
      "Review product cost, shipping cost, and margin.",
      "none",
    ));
  }

  return sortRisks(risks);
};

export const getCjControlRoomOrder = (order: CjAdminOrderInput, nowMs = Date.now()): CjControlRoomOrder => {
  const risks = getCjOrderRisks(order, nowMs);
  const pipelineState = getCjOrderPipelineState(order);
  const primaryRisk = risks[0];
  const nextAction = getNextAction(order, pipelineState, primaryRisk);

  return {
    orderId: order._id,
    customerName: order.customerName || order.customerEmail,
    customerEmail: order.customerEmail,
    total: order.total,
    currency: order.currency,
    status: order.status,
    pipelineState,
    pipelineLabel: PIPELINE_LABELS[pipelineState],
    pipelineRank: PIPELINE_RANKS[pipelineState],
    needsReview: risks.some((risk) => risk.severity === "critical") || pipelineState === "needs_review",
    nextAction: nextAction.label,
    nextActionKey: nextAction.key,
    cjOrderId: order.cjOrderId,
    cjParentOrderId: order.cjParentOrderId,
    cjPaymentStatus: order.cjPaymentStatus,
    cjFulfillmentStep: order.cjFulfillmentStep,
    cjStatus: order.cjStatus,
    cjError: order.cjError || order.cjAutoPaymentError,
    cjPaymentUrl: order.cjPaymentUrl,
    trackingNumber: order.trackingNumber,
    trackingUrl: order.trackingUrl,
    carrier: order.carrier,
    cjTrackingStatus: order.cjTrackingStatus,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    lastActivityAt: getLastActivityAt(order),
    risks,
  };
};

export const getCjControlRoomSummary = (orders: CjControlRoomOrder[]): CjControlRoomSummary => ({
  totalCjOrders: orders.filter((order) => order.pipelineState !== "not_cj").length,
  needsReview: orders.filter((order) => order.needsReview).length,
  readyForCj: orders.filter((order) => order.pipelineState === "ready_for_cj").length,
  waitingForPayment: orders.filter((order) => order.pipelineState === "waiting_for_cj_payment").length,
  waitingForTracking: orders.filter((order) => order.pipelineState === "waiting_for_tracking").length,
  inTransit: orders.filter((order) => order.pipelineState === "in_transit").length,
  delivered: orders.filter((order) => order.pipelineState === "delivered").length,
  criticalRisks: orders.flatMap((order) => order.risks).filter((risk) => risk.severity === "critical").length,
  warningRisks: orders.flatMap((order) => order.risks).filter((risk) => risk.severity === "warning").length,
});

export const getProductRisks = (products: CjAdminProductInput[], nowMs = Date.now()): CjAdminRisk[] =>
  sortRisks(products.flatMap((product) => {
    const risks: CjAdminRisk[] = [];
    const productId = product._id;
    const createdAt = product.cjInventoryLastCheckedAt || new Date(nowMs).toISOString();
    const isCjLinkedProduct =
      hasValue(product.cjProductId) ||
      hasValue(product.cjVariantId) ||
      hasValue(product.cjSku) ||
      hasValue(product.sourceUrl) ||
      ["pending", "approved", "rejected"].includes(product.cjSourcingStatus || "");

    if (!isCjLinkedProduct) return risks;

    if (product.cjSourcingStatus === "approved" && !hasValue(product.cjProductId)) {
      risks.push({
        key: `product:${productId || product.name}:product-id-missing`,
        type: "mapping",
        severity: "critical",
        title: "CJ product ID missing",
        description: `${product.name} is approved for CJ, but no CJ product ID is saved.`,
        nextAction: "Fix the product mapping before publishing or fulfilling orders.",
        actionKey: "review_mapping",
        productId,
        createdAt,
      });
    }

    const variants = product.variants || [];
    const missingVariantMapping = variants.some((variant) => variant.inStock !== false && (!hasValue(variant.cjVariantId) || !hasValue(variant.cjSku)));
    if (product.cjSourcingStatus === "approved" && missingVariantMapping) {
      risks.push({
        key: `product:${productId || product.name}:variant-mapping-missing`,
        type: "mapping",
        severity: "critical",
        title: "Variant mapping missing",
        description: `${product.name} has a sellable variant without a CJ variant ID or SKU.`,
        nextAction: "Update the product variant mapping before allowing checkout.",
        actionKey: "review_mapping",
        productId,
        createdAt,
      });
    }

    if (["out_of_stock", "error"].includes(product.cjInventoryStatus || "")) {
      risks.push({
        key: `product:${productId || product.name}:inventory-${product.cjInventoryStatus}`,
        type: "inventory",
        severity: "critical",
        title: product.cjInventoryStatus === "out_of_stock" ? "CJ inventory is out" : "CJ inventory check failed",
        description: product.cjInventoryError || `${product.name} cannot be confirmed as fulfillable right now.`,
        nextAction: "Refresh inventory and review the product before fulfilling orders.",
        actionKey: "refresh_inventory",
        productId,
        createdAt,
      });
    }

    if (product.cjInventoryStatus === "low_stock" || product.cjInventoryStatus === "partial") {
      risks.push({
        key: `product:${productId || product.name}:inventory-${product.cjInventoryStatus}`,
        type: "inventory",
        severity: "warning",
        title: product.cjInventoryStatus === "low_stock" ? "CJ inventory is low" : "CJ inventory is partial",
        description: `${product.name} may still be fulfillable, but inventory should be watched closely.`,
        nextAction: "Refresh inventory before approving new orders.",
        actionKey: "refresh_inventory",
        productId,
        createdAt,
      });
    }

    return risks;
  }));

export const getAutomationRisks = (automation: CjAdminAutomationState, nowMs = Date.now()): CjAdminRisk[] => {
  const createdAt = new Date(nowMs).toISOString();
  const risks: CjAdminRisk[] = [];

  if (!automation.apiKeyConfigured) {
    risks.push({
      key: "automation:cj-api-key-missing",
      type: "automation",
      severity: "critical",
      title: "CJ API key missing",
      description: "CJ cannot be contacted until the API key is configured.",
      nextAction: "Add CJ_API_KEY in the production environment.",
      actionKey: "none",
      createdAt,
    });
  }

  if (!automation.fulfillmentAutomationReady) {
    risks.push({
      key: "automation:fulfillment-not-ready",
      type: "automation",
      severity: "critical",
      title: "CJ fulfillment automation is off",
      description: "Paid orders will not be fully hands-off until fulfillment automation is enabled.",
      nextAction: "Confirm environment variables and enable fulfillment automation.",
      actionKey: "none",
      createdAt,
    });
  }

  if (automation.autoFulfillmentEnabled && !automation.webhookUrlConfigured) {
    risks.push({
      key: "automation:webhook-url-missing",
      type: "automation",
      severity: "critical",
      title: "CJ webhook URL missing",
      description: "CJ updates cannot reach Louie Mae without a registered webhook URL.",
      nextAction: "Set the webhook URL and run Configure webhooks.",
      actionKey: "configure_webhooks",
      createdAt,
    });
  }

  if (automation.autoBalancePayEnabled && !automation.balancePaymentReady) {
    risks.push({
      key: "automation:balance-payment-not-ready",
      type: "payment",
      severity: "critical",
      title: "CJ balance payment is not ready",
      description: "Automatic CJ payment is enabled but the safety checks are not all passing.",
      nextAction: "Check webhook signature verification, API key, and webhook URL.",
      actionKey: "none",
      createdAt,
    });
  }

  if (!automation.autoBalancePayEnabled && automation.fulfillmentAutomationReady) {
    risks.push({
      key: "automation:manual-payment-mode",
      type: "payment",
      severity: "warning",
      title: "CJ payment is manual",
      description: "Orders can be prepared in CJ, but payment still needs human review.",
      nextAction: "Enable balance payment only after dry-run and CJ balance funding pass.",
      actionKey: "none",
      createdAt,
    });
  }

  return sortRisks(risks);
};

export const getRiskSummary = (risks: CjAdminRisk[]): CjRiskSummary => ({
  totalRisks: risks.length,
  critical: risks.filter((risk) => risk.severity === "critical").length,
  warning: risks.filter((risk) => risk.severity === "warning").length,
  info: risks.filter((risk) => risk.severity === "info").length,
  orderRisks: risks.filter((risk) => hasValue(risk.orderId)).length,
  productRisks: risks.filter((risk) => hasValue(risk.productId)).length,
});

export const sortRisks = (risks: CjAdminRisk[]): CjAdminRisk[] =>
  [...risks].sort((a, b) => {
    const severityDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return toTime(b.createdAt) - toTime(a.createdAt);
  });

export const applyReviewedRiskAudits = (
  risks: CjAdminRisk[],
  audits: CjReviewedRiskAudit[],
  includeReviewed = false,
): CjAdminRisk[] => {
  const latestReviewByRiskKey = new Map<string, CjReviewedRiskAudit>();

  audits.forEach((audit) => {
    if (!hasValue(audit.riskKey)) return;
    const previous = latestReviewByRiskKey.get(audit.riskKey);
    const auditTime = toTime(audit.reviewedAt || audit.createdAt);
    const previousTime = toTime(previous?.reviewedAt || previous?.createdAt);
    if (!previous || auditTime >= previousTime) {
      latestReviewByRiskKey.set(audit.riskKey, audit);
    }
  });

  const decoratedRisks = risks.map((risk) => {
    const review = latestReviewByRiskKey.get(risk.key);
    if (!review) return risk;

    return {
      ...risk,
      reviewed: {
        reviewedAt: review.reviewedAt || review.createdAt,
        note: review.note,
        actorEmail: review.actorEmail,
      },
    };
  });

  return sortRisks(includeReviewed
    ? decoratedRisks
    : decoratedRisks.filter((risk) => !risk.reviewed));
};

const getNextAction = (
  order: CjAdminOrderInput,
  pipelineState: CjAdminPipelineState,
  primaryRisk: CjAdminRisk | undefined,
): { label: string; key: CjControlRoomOrder["nextActionKey"] } => {
  if (primaryRisk) {
    switch (primaryRisk.actionKey) {
      case "review_mapping":
        return { label: "Fix product mapping", key: "review_mapping" };
      case "review_shipping":
        return { label: "Review shipping address", key: "review_shipping" };
      case "review_refund":
        return { label: "Review refund in CJ", key: "review_refund" };
      case "open_cj_payment":
        return { label: "Check CJ payment", key: "open_cj_payment" };
      case "sync_order_tracking":
        return { label: "Sync tracking", key: "sync_order_tracking" };
      case "refresh_inventory":
        return { label: "Refresh inventory", key: "refresh_inventory" };
      case "retry_order":
        return { label: "Retry CJ order", key: "retry_order" };
      default:
        break;
    }
  }

  if (pipelineState === "waiting_for_cj_payment" && hasValue(order.cjPaymentUrl)) {
    return { label: "Open CJ payment", key: "open_cj_payment" };
  }
  if (pipelineState === "waiting_for_tracking" || pipelineState === "in_transit") {
    return { label: "Sync tracking", key: "sync_order_tracking" };
  }
  if (["ready_for_cj", "sending_to_cj", "cj_order_created", "cj_cart_confirmed", "needs_review"].includes(pipelineState)) {
    return { label: "Retry CJ order", key: "retry_order" };
  }
  return { label: "No action needed", key: "none" };
};
