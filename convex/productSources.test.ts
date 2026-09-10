import { describe, it, expect, vi } from 'vitest';
vi.mock('./cjAdminAccess', () => ({ requireCjAdminIdentity: vi.fn().mockResolvedValue({ email: 'admin' }) }));
import { requireCjAdminIdentity } from './cjAdminAccess';
import { acquire, finish, preview, attachRecovered } from './productSources';
const handler = (fn: unknown) => (fn as { _handler: (ctx: any, args: any) => Promise<any> })._handler;
function context(entry: any = null) {
    return { db: { get: vi.fn(), patch: vi.fn(), insert: vi.fn().mockResolvedValue('snapshot'), query: vi.fn().mockReturnValue({ withIndex: () => ({ unique: async () => entry, first: async () => null }) }) } };
}
describe('supplier evidence storage boundaries', () => {
    it('reuses a saved snapshot without acquiring a fetch lease', async () => {
        const ctx = context({ snapshotId: 'saved' });
        expect(await handler(acquire)(ctx, { sourceKey: 'url', token: 't', refresh: false })).toEqual({ snapshotId: 'saved' });
        expect(ctx.db.patch).not.toHaveBeenCalled();
    });
    it('deduplicates concurrent fetches and permits expired lease recovery', async () => {
        const ctx = context({ _id: 'cache', leaseUntil: Date.now() + 60_000 });
        expect(await handler(acquire)(ctx, { sourceKey: 'url', token: 't', refresh: true })).toEqual({ busy: true });
        const expired = context({ _id: 'cache', leaseUntil: 1 });
        expect(await handler(acquire)(expired, { sourceKey: 'url', token: 't', refresh: true })).toEqual({ acquired: true });
    });
    it('retains saved evidence on provider failure and rejects superseded writes', async () => {
        const ctx = context({ _id: 'cache', leaseToken: 't', snapshotId: 'saved' });
        expect(await handler(finish)(ctx, { sourceKey: 'url', token: 't', error: 'unavailable' })).toBe('saved');
        expect(ctx.db.patch).toHaveBeenCalledWith('cache', expect.not.objectContaining({ snapshotId: undefined }));
        await expect(handler(finish)(ctx, { sourceKey: 'url', token: 'other', snapshot: {} })).rejects.toThrow('superseded');
        expect(ctx.db.insert).not.toHaveBeenCalled();
    });
    it('blocks public snapshot access before reading evidence', async () => {
        vi.mocked(requireCjAdminIdentity).mockRejectedValueOnce(new Error('Unauthorized'));
        const ctx = context();
        await expect(handler(preview)(ctx, { id: 'source' })).rejects.toThrow('Unauthorized');
        expect(ctx.db.get).not.toHaveBeenCalled();
    });
    it('does not attach recovered data after a concurrent product edit', async () => {
        const ctx = context(); ctx.db.get.mockResolvedValue({ productRevision: 4 });
        expect(await handler(attachRecovered)(ctx, { productId: 'p', sourceSnapshotId: 's', expectedRevision: 3 })).toBe('changed');
        expect(ctx.db.patch).not.toHaveBeenCalled();
    });
});
