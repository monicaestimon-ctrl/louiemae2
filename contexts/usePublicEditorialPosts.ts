import { useQueries } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../convex/_generated/api';
import { readPublicInitialData } from '../lib/publicInitialData';
import { useInitialPublicValue } from './useInitialPublicValue';

export type EditorialStatus = 'loading' | 'ready' | 'empty' | 'unavailable';
type Posts = FunctionReturnType<typeof api.blogPosts.publicSummaries>;
const PUBLIC_POSTS = { posts: { query: api.blogPosts.publicSummaries, args: {} } };
const NO_QUERIES = {};

/** Optional public editorial data must never throw through the shopping shell. */
export function usePublicEditorialPosts(enabled: boolean) {
  const results = useQueries(enabled ? PUBLIC_POSTS : NO_QUERIES);
  const result = results.posts as Posts | Error | undefined;
  const initial = useInitialPublicValue<Posts>(
    result,
    () => readPublicInitialData()?.posts,
    enabled
  );

  // Do not retain data across owner/public transitions or convert an error to
  // a confirmed empty dataset. A later successful subscription can recover.
  const posts = initial.value;
  const status: EditorialStatus = !enabled
    ? 'empty'
    : initial.unavailable
      ? 'unavailable'
      : posts === undefined
        ? 'loading'
        : posts.length
          ? 'ready'
          : 'empty';
  return { posts, status };
}
