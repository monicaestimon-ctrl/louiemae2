import { useEffect, useMemo, useState } from 'react';
import { useQueries } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../convex/_generated/api';

export type EditorialStatus = 'loading' | 'ready' | 'empty' | 'unavailable';
type Posts = FunctionReturnType<typeof api.blogPosts.list>;

/** Optional public editorial data must never throw through the shopping shell. */
export function usePublicEditorialPosts(enabled: boolean) {
  const results = useQueries(enabled ? { posts: { query: api.blogPosts.list, args: {} } } : {});
  const result = results.posts as Posts | Error | undefined;
  const pending = enabled && result === undefined;
  const request = useMemo(() => ({ pending }), [pending]);
  const [expiredRequest, setExpiredRequest] = useState<typeof request | null>(null);
  useEffect(() => {
    if (!request.pending) return;
    const timer = window.setTimeout(() => setExpiredRequest(request), 10_000);
    return () => window.clearTimeout(timer);
  }, [request]);

  // Do not retain data across owner/public transitions or convert an error to
  // a confirmed empty dataset. A later successful subscription can recover.
  const posts = enabled && !(result instanceof Error) ? result : undefined;
  const status: EditorialStatus = !enabled ? 'empty'
    : result instanceof Error || (pending && expiredRequest === request) ? 'unavailable'
    : result === undefined ? 'loading'
    : result.length ? 'ready' : 'empty';
  return { posts, status };
}
