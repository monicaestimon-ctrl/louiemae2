import { useQueries } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../convex/_generated/api';
import { usePendingTimeout } from './usePendingTimeout';

const SESSION = { session: { query: api.cjAdminAccess.session, args: {} } };
const NONE = {};
export type AccountStatus = 'anonymous' | 'loading' | 'ready' | 'unavailable';

/** Resolve staff permissions without letting account failures replace public navigation. */
export function useSiteAccount(authenticated: boolean, authLoading: boolean) {
  const enabled = authenticated && !authLoading;
  const queries = useQueries(enabled ? SESSION : NONE);
  const session = queries.session as FunctionReturnType<typeof api.cjAdminAccess.session> | Error | undefined;
  const timedOut = usePendingTimeout(authLoading || (enabled && session === undefined));
  const status: AccountStatus = timedOut || (enabled && session instanceof Error) ? 'unavailable'
    : authLoading || (enabled && session === undefined) ? 'loading'
    : !authenticated ? 'anonymous' : 'ready';
  return { status, session: status === 'ready' && !(session instanceof Error) ? session : undefined };
}
