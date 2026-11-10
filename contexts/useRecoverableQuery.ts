import { useMemo, useState } from 'react';
import { useQueries } from 'convex/react';
import { getFunctionName, type FunctionReference, type FunctionArgs, type FunctionReturnType } from 'convex/server';
import { convexToJson } from 'convex/values';
import { usePendingTimeout } from './usePendingTimeout';

/** Keep a failed subscription local, with a per-request time budget and explicit manual retry. */
export function useRecoverableQuery<Query extends FunctionReference<'query'>>(query: Query, args: FunctionArgs<Query> | 'skip') {
  const [attempt, setAttempt] = useState(0);
  const skip = args === 'skip';
  const queryName = getFunctionName(query);
  const encoded = JSON.stringify(convexToJson(skip ? {} : args));
  // Match the installed SDK useQuery identity contract: fresh argument objects
  // with equal Convex values must not restart useQueries during every render.
  const queries = useMemo(() => skip ? {} : { result: { query, args } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryName, encoded, skip, attempt]);
  const values = useQueries(queries);
  const result = values.result as FunctionReturnType<Query> | Error | undefined;
  const timedOut = usePendingTimeout(!skip && result === undefined, `${queryName}:${encoded}:${attempt}`);
  const status = skip ? 'idle' : result instanceof Error || timedOut ? 'unavailable' : result === undefined ? 'loading' : 'ready';
  return {
    status,
    data: status === 'ready' ? result as FunctionReturnType<Query> : undefined,
    retry: () => setAttempt(value => value + 1),
  } as const;
}
