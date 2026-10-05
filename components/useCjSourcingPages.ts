import { useState } from 'react';
import { usePaginatedQuery, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';

const approvalCutoff = () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
export function useCjSourcingPages() {
  const readiness = useQuery(api.catalogReadiness.status, {});
  const ready = readiness?.ready === true;
  const [since, setSince] = useState(approvalCutoff);
  const pending = usePaginatedQuery(api.catalog.sourcingPage, ready ? { status: 'pending' } : 'skip', { initialNumItems: 25 });
  const rejected = usePaginatedQuery(api.catalog.sourcingPage, ready ? { status: 'rejected' } : 'skip', { initialNumItems: 25 });
  const approved = usePaginatedQuery(api.catalog.recentApprovalsPage, ready ? { since } : 'skip', { initialNumItems: 25 });
  return { ready, pending, rejected, approved, since, refreshApprovals: () => setSince(approvalCutoff()) };
}
