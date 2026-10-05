import { paginationOptsValidator } from 'convex/server';
import { ConvexError, type Infer } from 'convex/values';

// Convex 1.31.7 exposes budgets in its validator and forwards them in the
// deployed paginate implementation, but strips @internal fields from the
// PaginationOptions interface. Derive the complete contract from the validator.
export function catalogPageOptions(options: Infer<typeof paginationOptsValidator>, rows = 50, bytes = 500_000) {
  if (!Number.isFinite(options.numItems) || options.numItems < 1) throw new ConvexError('Page size must be positive.');
  return { ...options, numItems: Math.min(rows, Math.floor(options.numItems)), maximumRowsRead: rows, maximumBytesRead: bytes };
}
