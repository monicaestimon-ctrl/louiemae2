import { describe, expect, it, vi } from 'vitest';
import {
  addCart,
  cjApiRequest,
  createOrderV2,
  formatCjApiError,
  getOrderDetail,
  getTrackingInfo,
} from './cjApiClient';

function jsonResponse(body: unknown, init?: ConstructorParameters<typeof Response>[1]) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function createFetch(response: Response): typeof fetch {
  return vi.fn(async () => response) as unknown as typeof fetch;
}

describe('CJ API client', () => {
  it('rejects a non-200 CJ code even when HTTP and result look successful', async () => {
    const result = await cjApiRequest({
      accessToken: 'token',
      path: 'product/sourcing/create',
      method: 'POST',
      body: { productName: 'Example' },
      fetchFn: createFetch(jsonResponse({
        code: 1603001,
        result: true,
        message: 'Provider rejected the request',
        data: null,
      })),
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 1603001, message: 'Provider rejected the request' },
    });
  });

  it('sends authenticated JSON requests and unwraps successful CJ responses', async () => {
    const fetchFn = createFetch(jsonResponse({
      code: 200,
      result: true,
      message: 'Success',
      data: { orderId: 'CJ-123', shipmentOrderId: 'SHIP-123' },
      requestId: 'req-1',
    }));

    const result = await createOrderV2('token-123', {
      orderNumber: 'LM-1',
      shippingCountry: 'United States',
      shippingCountryCode: 'US',
      shippingProvince: 'TX',
      shippingCity: 'Austin',
      shippingCustomerName: 'A Customer',
      shippingAddress: '123 Main',
      logisticName: 'CJ Packet Ordinary',
      fromCountryCode: 'CN',
      products: [{ vid: 'VID-1', quantity: 1 }],
      payType: 3,
    }, { fetchFn });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.orderId).toBe('CJ-123');
      expect(result.requestId).toBe('req-1');
    }

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, request] = vi.mocked(fetchFn).mock.calls[0];
    expect(String(url)).toBe('https://developers.cjdropshipping.com/api2.0/v1/shopping/order/createOrderV2');
    expect(request?.method).toBe('POST');
    expect((request?.headers as Record<string, string>)['CJ-Access-Token']).toBe('token-123');
    expect(JSON.parse(String(request?.body))).toMatchObject({ orderNumber: 'LM-1', payType: 3 });
  });

  it('returns structured errors for CJ business failures', async () => {
    const fetchFn = createFetch(jsonResponse({
      code: 1603001,
      result: false,
      message: 'order confirm fail',
      data: null,
      requestId: 'req-fail',
    }));

    const result = await addCart('token-123', ['CJ-123'], { fetchFn });

    expect(result.ok).toBe(false);
    if ('error' in result) {
      expect(result.error).toMatchObject({
        code: 1603001,
        message: 'order confirm fail',
        requestId: 'req-fail',
        httpStatus: 200,
      });
      expect(formatCjApiError(result.error)).toContain('requestId=req-fail');
    }
  });

  it('returns structured errors for malformed JSON', async () => {
    const fetchFn = createFetch(new Response('not-json', { status: 200 }));

    const result = await cjApiRequest({
      accessToken: 'token-123',
      path: 'shopping/order/list',
      fetchFn,
    });

    expect(result.ok).toBe(false);
    if ('error' in result) {
      expect(result.error.message).toBe('CJ API returned malformed JSON');
      expect(result.raw).toBe('not-json');
    }
  });

  it('does not treat empty 2xx responses as successful CJ envelopes', async () => {
    const fetchFn = createFetch(jsonResponse({}));

    const result = await cjApiRequest({
      accessToken: 'token-123',
      path: 'shopping/order/list',
      fetchFn,
    });

    expect(result.ok).toBe(false);
    if ('error' in result) {
      expect(result.error.message).toBe('CJ API returned an unexpected response envelope');
    }
  });

  it('returns structured errors for network failures', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('socket closed');
    }) as unknown as typeof fetch;

    const result = await cjApiRequest({
      accessToken: 'token-123',
      path: 'shopping/order/list',
      fetchFn,
    });

    expect(result.ok).toBe(false);
    if ('error' in result) {
      expect(result.error.message).toBe('CJ API request failed');
      expect(result.error.cause).toBe('socket closed');
    }
  });

  it('returns timeout errors when a request exceeds its timeout', async () => {
    const fetchFn = vi.fn((_url: Parameters<typeof fetch>[0] | URL, init?: Parameters<typeof fetch>[1]) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })
    ) as unknown as typeof fetch;

    const result = await cjApiRequest({
      accessToken: 'token-123',
      path: 'shopping/order/list',
      fetchFn,
      timeoutMs: 1,
    });

    expect(result.ok).toBe(false);
    if ('error' in result) {
      expect(result.error.message).toBe('CJ API request timed out after 1ms');
    }
  });

  it('encodes repeated query params for endpoint helpers that accept arrays', async () => {
    const fetchFn = createFetch(jsonResponse({
      code: 200,
      result: true,
      message: 'Success',
      data: { orderId: 'CJ-123' },
    }));

    await getOrderDetail('token-123', 'CJ-123', ['LOGISTICS_TIMELINESS', 'POD'], { fetchFn });

    const [url] = vi.mocked(fetchFn).mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe('/api2.0/v1/shopping/order/getOrderDetail');
    expect(parsed.searchParams.get('orderId')).toBe('CJ-123');
    expect(parsed.searchParams.getAll('features')).toEqual(['LOGISTICS_TIMELINESS', 'POD']);
  });

  it('uses CJ logistic trackInfo with repeated trackNumber params', async () => {
    const fetchFn = createFetch(jsonResponse({
      code: 200,
      result: true,
      message: 'Success',
      data: [{ trackingNumber: 'CJPKL7160102171YQ', trackingStatus: 'In transit' }],
    }));

    await getTrackingInfo('token-123', ['CJPKL7160102171YQ', '926112903032124'], { fetchFn });

    const [url] = vi.mocked(fetchFn).mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe('/api2.0/v1/logistic/trackInfo');
    expect(parsed.searchParams.getAll('trackNumber')).toEqual([
      'CJPKL7160102171YQ',
      '926112903032124',
    ]);
  });

  it('rejects absolute non-CJ URLs before attaching CJ credentials', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;

    const result = await cjApiRequest({
      accessToken: 'token-123',
      path: 'https://example.com/api2.0/v1/shopping/order/list',
      fetchFn,
    });

    expect(result.ok).toBe(false);
    if ('error' in result) {
      expect(result.error.cause).toBe('CJ API URL must target the configured CJ API base.');
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
