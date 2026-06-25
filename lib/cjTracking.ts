export type LocalOrderStatus = "pending" | "paid" | "processing" | "shipped" | "delivered" | "cancelled";
export type LocalCjStatus = "pending" | "sending" | "confirmed" | "processing" | "shipped" | "delivered" | "failed" | "cancelled";

export type CjOrderTrackingSource = {
  orderStatus?: unknown;
  trackNumber?: unknown;
  trackingNumber?: unknown;
  trackingProvider?: unknown;
  trackingUrl?: unknown;
};

export type CjTrackingSource = {
  trackingNumber?: unknown;
  logisticName?: unknown;
  trackingStatus?: unknown;
  lastMileCarrier?: unknown;
  lastTrackNumber?: unknown;
  deliveryTime?: unknown;
  trackingUrl?: unknown;
};

export type CjTrackingReconciliation = {
  trackingNumber?: string;
  trackingUrl?: string;
  carrier?: string;
  cjTrackingStatus?: string;
  estimatedDelivery?: string;
  cjStatus?: LocalCjStatus;
  orderStatus?: LocalOrderStatus;
};

const firstString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
};

export const normalizeCjOrderStatus = (status: unknown): LocalCjStatus | undefined => {
  const normalized = firstString(status)?.toUpperCase();
  if (!normalized) return undefined;

  if (["CREATED", "IN_CART", "UNPAID"].includes(normalized)) return "confirmed";
  if (normalized === "UNSHIPPED") return "processing";
  if (normalized === "SHIPPED") return "shipped";
  if (normalized === "DELIVERED") return "delivered";
  if (normalized === "CANCELLED" || normalized === "CANCELED") return "cancelled";
  return undefined;
};

export const normalizeCjTrackingStatus = (status: unknown): LocalCjStatus | undefined => {
  const normalized = firstString(status)?.toLowerCase();
  if (!normalized) return undefined;

  if (normalized.includes("deliver")) return "delivered";
  if (normalized.includes("cancel")) return "cancelled";
  if (normalized.includes("exception") || normalized.includes("fail")) return "failed";
  return "shipped";
};

export const orderStatusFromCjStatus = (status: LocalCjStatus | undefined): LocalOrderStatus | undefined => {
  if (status === "processing") return "processing";
  if (status === "shipped") return "shipped";
  if (status === "delivered") return "delivered";
  if (status === "cancelled") return "cancelled";
  return undefined;
};

export const buildTrackingUrl = (trackingNumber: string, carrier?: string): string => {
  const carrierLower = (carrier || "").toLowerCase();

  if (carrierLower.includes("usps")) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`;
  }
  if (carrierLower.includes("fedex")) {
    return `https://www.fedex.com/apps/fedextrack/?tracknumbers=${trackingNumber}`;
  }
  if (carrierLower.includes("ups")) {
    return `https://www.ups.com/track?tracknum=${trackingNumber}`;
  }
  if (carrierLower.includes("dhl")) {
    return `https://www.dhl.com/en/express/tracking.html?AWB=${trackingNumber}`;
  }
  return `https://t.17track.net/en#nums=${trackingNumber}`;
};

export const getTrackNumberFromOrderDetail = (detail: CjOrderTrackingSource): string | undefined =>
  firstString(detail.trackNumber, detail.trackingNumber);

export const reconcileCjTracking = (
  detail: CjOrderTrackingSource,
  trackingRows: CjTrackingSource[] = [],
): CjTrackingReconciliation => {
  const primaryRow = trackingRows[0] ?? {};
  const trackingNumber = firstString(
    primaryRow.lastTrackNumber,
    primaryRow.trackingNumber,
    detail.trackNumber,
    detail.trackingNumber,
  );
  const carrier = firstString(primaryRow.lastMileCarrier, detail.trackingProvider, primaryRow.logisticName);
  const cjTrackingStatus = firstString(primaryRow.trackingStatus);
  const statusFromTracking = normalizeCjTrackingStatus(cjTrackingStatus);
  const statusFromOrder = normalizeCjOrderStatus(detail.orderStatus);
  const cjStatus = statusFromTracking ?? statusFromOrder;

  return {
    trackingNumber,
    trackingUrl: trackingNumber
      ? firstString(primaryRow.trackingUrl, detail.trackingUrl) ?? buildTrackingUrl(trackingNumber, carrier)
      : firstString(detail.trackingUrl),
    carrier,
    cjTrackingStatus,
    estimatedDelivery: firstString(primaryRow.deliveryTime),
    cjStatus,
    orderStatus: orderStatusFromCjStatus(cjStatus),
  };
};
