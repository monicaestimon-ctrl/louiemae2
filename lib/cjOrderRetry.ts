type RetryShippingAddress = {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
};

type RetryOrderItem = {
  cjVariantId?: string;
  cjSku?: string;
  quantity: number;
  price: number;
  cjProductCost?: number;
};

export type CjRetryOrderSource = {
  stripeSessionId: string;
  customerName?: string;
  customerEmail: string;
  customerPhone?: string;
  shippingAddress?: RetryShippingAddress;
  items: RetryOrderItem[];
  shipping?: number;
  subtotal: number;
};

export type CjRetryOrderPayload = {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  shippingAddress: RetryShippingAddress;
  products: Array<{
    vid?: string;
    sku?: string;
    quantity: number;
    productCost?: number;
    retailPrice?: number;
  }>;
  customerShippingCollected?: number;
  orderSubtotal: number;
};

export type CjRetryOrderPayloadResult =
  | { ok: true; payload: CjRetryOrderPayload }
  | { ok: false; error: string };

const hasCjMapping = (item: RetryOrderItem) => Boolean(item.cjVariantId || item.cjSku);

export const buildCjRetryOrderPayload = (order: CjRetryOrderSource): CjRetryOrderPayloadResult => {
  if (!order.shippingAddress) {
    return { ok: false, error: "Order is missing a shipping address" };
  }

  const products = order.items
    .filter(hasCjMapping)
    .map((item) => ({
      vid: item.cjVariantId || undefined,
      sku: item.cjSku || undefined,
      quantity: item.quantity,
      productCost: item.cjProductCost,
      retailPrice: item.price,
    }));

  if (products.length === 0) {
    return { ok: false, error: "Order has no CJ-mapped items to fulfill" };
  }

  return {
    ok: true,
    payload: {
      orderNumber: order.stripeSessionId.slice(-12).toUpperCase(),
      customerName: order.customerName || "Customer",
      customerPhone: order.customerPhone || "",
      customerEmail: order.customerEmail,
      shippingAddress: order.shippingAddress,
      products,
      customerShippingCollected: order.shipping,
      orderSubtotal: order.subtotal,
    },
  };
};
