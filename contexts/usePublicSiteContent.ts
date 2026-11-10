import { useQueries } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../convex/_generated/api';
import { usePendingTimeout } from './usePendingTimeout';

export type PublicContentStatus = 'loading' | 'ready' | 'unavailable';
const CONTENT_QUERIES = {
  settings: { query: api.siteContent.get, args: {} },
  pages: { query: api.customPages.list, args: {} },
};

/** Preserve the static navigation shell when optional public configuration fails. */
export function usePublicSiteContent() {
  const results = useQueries(CONTENT_QUERIES);
  const settings = results.settings as FunctionReturnType<typeof api.siteContent.get> | Error | undefined;
  const pages = results.pages as FunctionReturnType<typeof api.customPages.list> | Error | undefined;
  const settingsTimeout = usePendingTimeout(settings === undefined);
  const pagesTimeout = usePendingTimeout(pages === undefined);
  const siteContentStatus: PublicContentStatus = settings instanceof Error || settingsTimeout
    ? 'unavailable' : settings === undefined ? 'loading' : 'ready';
  const customPagesStatus: PublicContentStatus = pages instanceof Error || pagesTimeout
    ? 'unavailable' : pages === undefined ? 'loading' : 'ready';
  return {
    // Unknown is not a confirmed null: owner seeding must never run on failure.
    siteContent: settings instanceof Error ? undefined : settings,
    customPages: pages instanceof Error ? undefined : pages,
    siteContentStatus,
    customPagesStatus,
  };
}
