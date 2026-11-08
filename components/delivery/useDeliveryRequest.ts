import { useAuthToken } from '@convex-dev/auth/react';
import { useCallback } from 'react';
import type { FunctionArgs, FunctionReturnType } from 'convex/server';
import type { api } from '../../convex/_generated/api';
import { CommerceError, commerceErrorData } from '../../lib/errors';

type Methods = {
  estimate: typeof api.dlvTaxActions.estimate;
  quote: typeof api.dlvTaxActions.requestQuote;
};
/** Browser sends only customer input. Trusted context is created by the same-origin server. */
export function useDeliveryRequest<K extends keyof Methods>(operation: K) {
  const token = useAuthToken();
  return useCallback(
    async (
      input: Omit<FunctionArgs<Methods[K]>, 'proof'>
    ): Promise<FunctionReturnType<Methods[K]>> => {
      let response: Response;
      try {
        response = await fetch('/api/delivery', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ operation, input }),
          signal: globalThis.AbortSignal.timeout(20000),
        });
      } catch {
        throw new CommerceError('TEMPORARILY_UNAVAILABLE');
      }
      let payload: { result?: FunctionReturnType<Methods[K]>; error?: unknown };
      try {
        payload = await response.json();
      } catch {
        throw new CommerceError('TEMPORARILY_UNAVAILABLE');
      }
      if (!response.ok) {
        const data = commerceErrorData({ data: payload.error });
        throw new CommerceError(
          data?.code ?? 'TEMPORARILY_UNAVAILABLE',
          undefined,
          undefined,
          data?.requestId
        );
      }
      if (!payload.result) throw new CommerceError('TEMPORARILY_UNAVAILABLE');
      return payload.result;
    },
    [operation, token]
  );
}
