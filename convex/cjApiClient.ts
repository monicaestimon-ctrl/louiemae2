export const CJ_API_BASE = "https://developers.cjdropshipping.com/api2.0/v1";
export const CJ_DEFAULT_TIMEOUT_MS = 10_000;
const CJ_API_BASE_URL = new URL(`${CJ_API_BASE}/`);

type CjHttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
type CjQueryValue = string | number | boolean | null | undefined | Array<string | number | boolean>;
type CjFetch = typeof fetch;

export type CjApiEnvelope<T> = {
    code?: number;
    result?: boolean;
    success?: boolean;
    message?: string;
    data: T;
    requestId?: string;
};

export type CjApiErrorDetails = {
    message: string;
    code?: number;
    requestId?: string;
    httpStatus?: number;
    cause?: string;
};

export type CjApiResult<T> =
    | {
        ok: true;
        data: T;
        raw: CjApiEnvelope<T>;
        code?: number;
        requestId?: string;
        httpStatus: number;
    }
    | {
        ok: false;
        error: CjApiErrorDetails;
        raw?: unknown;
        httpStatus?: number;
    };

export type CjApiCallOptions = {
    timeoutMs?: number;
    fetchFn?: CjFetch;
    platformToken?: string;
};

export type CjApiRequestOptions<TBody> = CjApiCallOptions & {
    accessToken: string;
    method?: CjHttpMethod;
    path: string;
    query?: Record<string, CjQueryValue>;
    body?: TBody;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

const appendQuery = (url: URL, query?: Record<string, CjQueryValue>) => {
    if (!query) return;

    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        const values = Array.isArray(value) ? value : [value];
        for (const item of values) {
            url.searchParams.append(key, String(item));
        }
    }
};

const buildCjUrl = (path: string, query?: Record<string, CjQueryValue>) => {
    const url = path.startsWith("http")
        ? new URL(path)
        : new URL(path.replace(/^\/+/, ""), CJ_API_BASE_URL);

    if (url.origin !== CJ_API_BASE_URL.origin || !url.pathname.startsWith(CJ_API_BASE_URL.pathname)) {
        throw new Error("CJ API URL must target the configured CJ API base.");
    }

    appendQuery(url, query);
    return url.toString();
};

const parseEnvelope = <T>(raw: unknown): CjApiEnvelope<T> | null => {
    if (!isRecord(raw)) return null;
    const hasEnvelopeShape =
        Object.prototype.hasOwnProperty.call(raw, "data") ||
        Object.prototype.hasOwnProperty.call(raw, "result") ||
        Object.prototype.hasOwnProperty.call(raw, "success") ||
        Object.prototype.hasOwnProperty.call(raw, "message") ||
        Object.prototype.hasOwnProperty.call(raw, "code") ||
        Object.prototype.hasOwnProperty.call(raw, "requestId");
    if (!hasEnvelopeShape) return null;

    return {
        code: typeof raw.code === "number" ? raw.code : undefined,
        result: typeof raw.result === "boolean" ? raw.result : undefined,
        success: typeof raw.success === "boolean" ? raw.success : undefined,
        message: typeof raw.message === "string" ? raw.message : undefined,
        data: raw.data as T,
        requestId: typeof raw.requestId === "string" ? raw.requestId : undefined,
    };
};

export const formatCjApiError = (error: CjApiErrorDetails): string => {
    const parts = [error.message];
    if (error.code !== undefined) parts.push(`code=${error.code}`);
    if (error.requestId) parts.push(`requestId=${error.requestId}`);
    if (error.httpStatus !== undefined) parts.push(`httpStatus=${error.httpStatus}`);
    if (error.cause) parts.push(`cause=${error.cause}`);
    return parts.join(" | ");
};

export const cjApiRequest = async <TData = unknown, TBody = unknown>(
    options: CjApiRequestOptions<TBody>,
): Promise<CjApiResult<TData>> => {
    const {
        accessToken,
        body,
        fetchFn = fetch,
        method = body === undefined ? "GET" : "POST",
        path,
        platformToken,
        query,
        timeoutMs = CJ_DEFAULT_TIMEOUT_MS,
    } = options;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const headers: Record<string, string> = {
            "CJ-Access-Token": accessToken,
        };
        if (platformToken) headers.platformToken = platformToken;
        if (body !== undefined) headers["Content-Type"] = "application/json";

        const response = await fetchFn(buildCjUrl(path, query), {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal,
        });

        const responseText = await response.text();
        let raw: unknown = {};
        try {
            raw = responseText ? JSON.parse(responseText) : {};
        } catch (error) {
            return {
                ok: false,
                httpStatus: response.status,
                error: {
                    message: "CJ API returned malformed JSON",
                    httpStatus: response.status,
                    cause: error instanceof Error ? error.message : "JSON parse failed",
                },
                raw: responseText,
            };
        }

        const envelope = parseEnvelope<TData>(raw);
        const hasDataField = isRecord(raw) && Object.prototype.hasOwnProperty.call(raw, "data");
        if (!response.ok) {
            return {
                ok: false,
                httpStatus: response.status,
                raw,
                error: {
                    message: envelope?.message || response.statusText || "CJ API HTTP error",
                    code: envelope?.code,
                    requestId: envelope?.requestId,
                    httpStatus: response.status,
                },
            };
        }

        if (!envelope || (!hasDataField && envelope.result !== true && envelope.success !== true)) {
            return {
                ok: false,
                httpStatus: response.status,
                raw,
                error: {
                    message: "CJ API returned an unexpected response envelope",
                    httpStatus: response.status,
                },
            };
        }

        if (envelope.result === false || envelope.success === false) {
            return {
                ok: false,
                httpStatus: response.status,
                raw,
                error: {
                    message: envelope.message || "CJ API request failed",
                    code: envelope.code,
                    requestId: envelope.requestId,
                    httpStatus: response.status,
                },
            };
        }

        return {
            ok: true,
            data: envelope.data,
            raw: envelope,
            code: envelope.code,
            requestId: envelope.requestId,
            httpStatus: response.status,
        };
    } catch (error) {
        const isAbort = error instanceof Error && error.name === "AbortError";
        return {
            ok: false,
            error: {
                message: isAbort ? `CJ API request timed out after ${timeoutMs}ms` : "CJ API request failed",
                cause: error instanceof Error ? error.message : String(error),
            },
        };
    } finally {
        clearTimeout(timeout);
    }
};

export type CjOrderProductPayload = {
    vid?: string;
    sku?: string;
    quantity: number;
    unitPrice?: number;
    storeLineItemId?: string;
    storeProductId?: string;
    storeProductImg?: string;
};

export type CjCreateOrderV2Payload = {
    orderNumber: string;
    shippingZip?: string;
    shippingCountry: string;
    shippingCountryCode: string;
    shippingProvince: string;
    shippingCity: string;
    shippingCounty?: string;
    shippingPhone?: string;
    shippingCustomerName: string;
    shippingAddress: string;
    shippingAddress2?: string;
    houseNumber?: string;
    email?: string;
    taxId?: string;
    remark?: string;
    consigneeID?: string;
    payType?: 1 | 2 | 3;
    shopAmount?: number;
    logisticName: string;
    fromCountryCode: string;
    platform?: string;
    shopLogisticsType?: 1 | 2 | 3;
    storageId?: string;
    iossType?: number;
    iossNumber?: string;
    storeName?: string;
    storeOrderTime?: number;
    orderFlow?: 1 | 2;
    products: CjOrderProductPayload[];
};

export type CjCreateOrderV2Data = {
    orderId?: string;
    orderNumber?: string;
    shipmentOrderId?: string;
    cjPayUrl?: string;
    orderAmount?: string | number;
    actualPayment?: string | number;
    orderStatus?: string;
    logisticsMiss?: boolean;
    productInfoList?: unknown[];
    interceptOrderReasons?: unknown[];
};

export type CjAddCartData = {
    successCount?: number;
    addSuccessOrders?: string[];
    unInterceptAddressCount?: number;
    interceptOrders?: unknown[];
};

export type CjAddCartConfirmData = {
    successCount?: number;
    submitSuccess?: boolean;
    shipmentsId?: string;
    result?: number;
    interceptOrders?: unknown[];
};

export type CjSaveGenerateParentOrderData = {
    orderMoney?: number;
    payExpireTime?: string;
    payId?: string;
    result?: number;
    submitSuccess?: boolean;
    unMatchOrderCodes?: string[];
    successOrders?: string[];
    unMatchProductCodes?: string[];
    paymentInformation?: {
        actualPayment?: number;
        payableAmount?: number;
        freight?: number;
        serviceFee?: number;
        [key: string]: unknown;
    };
    interceptOrders?: unknown[];
};

export type CjOrderDetailData = {
    orderId?: string;
    orderNum?: string;
    cjOrderId?: string | null;
    orderStatus?: string;
    trackNumber?: string | null;
    trackingProvider?: string | null;
    trackingUrl?: string | null;
    paymentDate?: string | null;
    productList?: unknown[];
    [key: string]: unknown;
};

export type CjListOrderData = {
    pageNum?: number;
    pageSize?: number;
    total?: number;
    list?: CjOrderDetailData[];
};

export type CjInventoryRow = {
    vid?: string;
    areaId?: string | number;
    areaEn?: string;
    countryCode?: string;
    countryNameEn?: string;
    totalInventoryNum?: number;
    cjInventoryNum?: number;
    factoryInventoryNum?: number;
    stock?: Array<{
        stockId?: string;
        inventory?: number;
        factoryInventory?: number;
    }> | null;
};

export type CjTrackingInfoData = unknown;

export const createOrderV2 = (
    accessToken: string,
    payload: CjCreateOrderV2Payload,
    options?: CjApiCallOptions,
) => cjApiRequest<CjCreateOrderV2Data, CjCreateOrderV2Payload>({
    accessToken,
    path: "shopping/order/createOrderV2",
    method: "POST",
    body: payload,
    ...options,
});

export const addCart = (
    accessToken: string,
    cjOrderIdList: string[],
    options?: CjApiCallOptions,
) => cjApiRequest<CjAddCartData, { cjOrderIdList: string[] }>({
    accessToken,
    path: "shopping/order/addCart",
    method: "POST",
    body: { cjOrderIdList },
    ...options,
});

export const addCartConfirm = (
    accessToken: string,
    cjOrderIdList: string[],
    options?: CjApiCallOptions,
) => cjApiRequest<CjAddCartConfirmData, { cjOrderIdList: string[] }>({
    accessToken,
    path: "shopping/order/addCartConfirm",
    method: "POST",
    body: { cjOrderIdList },
    ...options,
});

export const saveGenerateParentOrder = (
    accessToken: string,
    shipmentOrderId: string,
    options?: CjApiCallOptions,
) => cjApiRequest<CjSaveGenerateParentOrderData, { shipmentOrderId: string }>({
    accessToken,
    path: "shopping/order/saveGenerateParentOrder",
    method: "POST",
    body: { shipmentOrderId },
    ...options,
});

export const payBalanceV2 = (
    accessToken: string,
    payload: { shipmentOrderId: string; payId?: string; orderType?: number },
    options?: CjApiCallOptions,
) => cjApiRequest<null, typeof payload>({
    accessToken,
    path: "shopping/pay/payBalanceV2",
    method: "POST",
    body: payload,
    ...options,
});

export const confirmOrder = (
    accessToken: string,
    orderId: string,
    options?: CjApiCallOptions,
) => cjApiRequest<string, { orderId: string }>({
    accessToken,
    path: "shopping/order/confirmOrder",
    method: "PATCH",
    body: { orderId },
    ...options,
});

export const listOrders = (
    accessToken: string,
    query?: {
        pageNum?: number;
        pageSize?: number;
        orderIds?: string[];
        shipmentOrderId?: string;
        status?: string;
    },
    options?: CjApiCallOptions,
) => cjApiRequest<CjListOrderData>({
    accessToken,
    path: "shopping/order/list",
    query,
    ...options,
});

export const getOrderDetail = (
    accessToken: string,
    orderId: string,
    features?: string[],
    options?: CjApiCallOptions,
) => cjApiRequest<CjOrderDetailData>({
    accessToken,
    path: "shopping/order/getOrderDetail",
    query: { orderId, features },
    ...options,
});

export const getInventoryByVid = (
    accessToken: string,
    vid: string,
    options?: CjApiCallOptions,
) => cjApiRequest<CjInventoryRow[]>({
    accessToken,
    path: "product/stock/queryByVid",
    query: { vid },
    ...options,
});

export const getInventoryBySku = (
    accessToken: string,
    sku: string,
    options?: CjApiCallOptions,
) => cjApiRequest<CjInventoryRow[]>({
    accessToken,
    path: "product/stock/queryBySku",
    query: { sku },
    ...options,
});

export const getInventoryByPid = (
    accessToken: string,
    pid: string,
    options?: CjApiCallOptions,
) => cjApiRequest<{ inventories?: CjInventoryRow[] }>({
    accessToken,
    path: "product/stock/getInventoryByPid",
    query: { pid },
    ...options,
});

export const getTrackingInfo = (
    accessToken: string,
    orderId: string,
    options?: CjApiCallOptions,
) => cjApiRequest<CjTrackingInfoData>({
    accessToken,
    path: "logistic/getTrackInfo",
    query: { orderId },
    ...options,
});
