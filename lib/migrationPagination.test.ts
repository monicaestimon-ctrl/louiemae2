import { expect, it } from 'vitest';
import { MigrationPaginationError, walkMigrationPages } from './migrationPagination';
it('visits every page and finishes exactly at the budget boundary', async () => {
  const cursors: (string | null)[] = [], visited: string[] = [];
  const result = await walkMigrationPages(async cursor => { cursors.push(cursor); return { isDone: cursor === 'next', continueCursor: cursor ? 'end' : 'next' }; }, page => { visited.push(page.continueCursor); }, 2);
  expect(result).toEqual({ pages: 2, complete: true }); expect(cursors).toEqual([null, 'next']); expect(visited).toEqual(['next', 'end']);
});
it.each(['repeat', 'empty', 'budget'] as const)('refuses %s truncation with a resumable cursor', async kind => {
  let calls = 0;
  const run = walkMigrationPages(async () => ({ isDone: false, continueCursor: kind === 'empty' ? '' : kind === 'repeat' ? 'same' : `cursor-${++calls}` }), () => {}, 2);
  await expect(run).rejects.toBeInstanceOf(MigrationPaginationError);
  await expect(run).rejects.toMatchObject({ pages: kind === 'empty' ? 1 : 2 });
});
it('does not hide source failures', async () => {
  await expect(walkMigrationPages(async () => { throw Error('source unavailable'); }, () => {})).rejects.toThrow('source unavailable');
});
