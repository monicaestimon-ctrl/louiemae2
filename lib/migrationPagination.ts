/** Bounded migration walks must finish, never silently certify an exhausted prefix. */
export class MigrationPaginationError extends Error {
  constructor(message: string, readonly cursor: string | null, readonly pages: number) { super(message); }
}
export async function walkMigrationPages<T extends { isDone: boolean; continueCursor: string }>(
  read: (cursor: string | null) => Promise<T>, visit: (page: T) => void, maxPages = 10000,
) {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw new MigrationPaginationError('Invalid page limit', null, 0);
  const seen = new Set<string>(); let cursor: string | null = null;
  for (let pages = 1; pages <= maxPages; pages++) {
    const result = await read(cursor);
    visit(result);
    if (result.isDone) return { pages, complete: true as const };
    if (!result.continueCursor || seen.has(result.continueCursor)) throw new MigrationPaginationError('Migration cursor did not advance', cursor, pages);
    seen.add(result.continueCursor); cursor = result.continueCursor;
  }
  throw new MigrationPaginationError('Migration page budget exhausted', cursor, maxPages);
}
