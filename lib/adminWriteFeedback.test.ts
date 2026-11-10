import { expect, it, vi } from 'vitest';
import { withAdminWriteFeedback } from './adminWriteFeedback';

it('reports synchronous guards without claiming a save succeeded', async () => {
  const notify = vi.fn();
  const write = withAdminWriteFeedback(() => { throw new Error('Reload verified settings before saving changes.'); }, notify);
  expect(await write()).toBe(false);
  expect(notify).toHaveBeenCalledWith('Reload verified settings before saving changes.');
});
it('handles rejected backend writes and forwards successful writes once', async () => {
  const notify = vi.fn();
  const action = vi.fn().mockRejectedValueOnce(new Error('Write failed')).mockResolvedValueOnce(null);
  const write = withAdminWriteFeedback(action, notify);
  expect(await write('home', { title: 'Draft' })).toBe(false);
  expect(notify).toHaveBeenCalledWith('Write failed');
  expect(await write('home', { title: 'Saved' })).toBe(true);
  expect(action).toHaveBeenLastCalledWith('home', { title: 'Saved' });
  expect(notify).toHaveBeenCalledTimes(1);
});
