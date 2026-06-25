export const CJ_ORDER_STATUSES = [
  "pending",
  "sending",
  "confirmed",
  "processing",
  "shipped",
  "failed",
  "cancelled",
  "delivered",
] as const;

export type CjOrderStatus = typeof CJ_ORDER_STATUSES[number];

export type CjStatusResolution = {
  status?: CjOrderStatus;
  changed: boolean;
  ignored: boolean;
};

const CJ_STATUS_SET = new Set<string>(CJ_ORDER_STATUSES);

const CJ_STATUS_RANK: Record<CjOrderStatus, number> = {
  pending: 0,
  sending: 1,
  confirmed: 2,
  processing: 3,
  cancelled: 4,
  shipped: 5,
  failed: 6,
  delivered: 7,
};

const SHIPPED_DOWNGRADES = new Set<CjOrderStatus>([
  "pending",
  "sending",
  "confirmed",
  "processing",
  "cancelled",
]);

export const isCjOrderStatus = (status: string | undefined): status is CjOrderStatus =>
  Boolean(status && CJ_STATUS_SET.has(status));

export const resolveMonotonicCjStatus = (
  currentStatus: string | undefined,
  incomingStatus: string | undefined,
): CjStatusResolution => {
  if (!isCjOrderStatus(incomingStatus)) {
    return { status: isCjOrderStatus(currentStatus) ? currentStatus : undefined, changed: false, ignored: true };
  }

  if (!isCjOrderStatus(currentStatus)) {
    return { status: incomingStatus, changed: true, ignored: false };
  }

  if (currentStatus === incomingStatus) {
    return { status: currentStatus, changed: false, ignored: false };
  }

  if (currentStatus === "delivered") {
    return { status: currentStatus, changed: false, ignored: true };
  }

  if (incomingStatus === "delivered") {
    return { status: incomingStatus, changed: true, ignored: false };
  }

  if (currentStatus === "shipped" && SHIPPED_DOWNGRADES.has(incomingStatus)) {
    return { status: currentStatus, changed: false, ignored: true };
  }

  if (CJ_STATUS_RANK[incomingStatus] >= CJ_STATUS_RANK[currentStatus]) {
    return { status: incomingStatus, changed: true, ignored: false };
  }

  return { status: currentStatus, changed: false, ignored: true };
};
