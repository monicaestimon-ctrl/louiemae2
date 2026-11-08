import { describe, it, expect, vi } from 'vitest';
vi.mock('./cjAdminAccess', () => ({ requireCjAdminIdentity: vi.fn(async () => ({email:'admin@example.com'})) }));
import { importBatch, generateUploadUrls, resolveUploadedMedia } from './zuoStaging';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { blankCommerceDraft, listingSnapshot } from '../lib/commerce';
import { listingReady } from './commerceReadiness';
const run = (importBatch as any)._handler;
function row(excluded = false) {
  return { sku:'123456', pack:2, excluded, exclusionReasons:excluded ? ['DISCONTINUED'] : [], holdReasons:['Freight unverified'], sourceEvidence:'Install row 25; approved manifest',
    draft:{...blankCommerceDraft(), name:'Zuo chair', supplierName:'Zuo', sourceUrl:'https://zuomod.com/chair',
      variants:[{id:'123456',name:'Default',sku:'123456',cost:100,minimum:1,increment:1,retail:30000,commercial:28501}]}};
}
function context() {
  const records:any[]=[]; const audits:any[]=[];
  const ctx:any={db:{query:()=>({withIndex:()=>({unique:async()=>records[0]??null})}),insert:vi.fn(async(table:string,doc:any)=>{if(table==='commerceProducts') records.push({...doc,_id:'product'});else audits.push(doc);return 'product';})}};
  return {ctx,records,audits};
}
const args=(r=row())=>({runId:'review-20261107',manifestSha256:'a'.repeat(64),rows:[r]});
describe('Zuo staging foundation',()=>{
  it('preserves excluded evidence, exact sellable-pack prices and pack without creating listings; repeat is idempotent',async()=>{
    const {ctx,records,audits}=context();const a=args(row(true));await run(ctx,a);await run(ctx,a);
    expect(records).toHaveLength(1);expect(audits).toHaveLength(1);
    expect(records[0].draft.variants[0]).toMatchObject({minimum:1,increment:1,retail:30000,commercial:28501});
    expect(records[0].zuoStaging).toMatchObject({unitsPerSellUnit:2,excluded:true,exclusionReasons:['DISCONTINUED'],holdReasons:['Freight unverified'],status:'staged_not_orderable'});
    expect(ctx.db.insert.mock.calls.map((c:any)=>c[0])).toEqual(['commerceProducts','commerceAudit']);
  });
  it('rejects changed repeat instead of overwriting approvals',async()=>{const {ctx}=context();await run(ctx,args());const a=args();a.rows[0].draft.variants[0].retail++;await expect(run(ctx,a)).rejects.toThrow('revision review');});
  it('rejects broken pack and exclusion metadata',async()=>{const {ctx}=context();const a=args();a.rows[0].draft.variants[0].increment=2;await expect(run(ctx,a)).rejects.toThrow('pack');const b=args();b.rows[0].excluded=true;await expect(run(ctx,b)).rejects.toThrow('Exclusion');expect(ctx.db.insert).not.toHaveBeenCalled();});
  it('requires authenticated admin before writing',async()=>{const {ctx}=context();vi.mocked(requireCjAdminIdentity).mockRejectedValueOnce(new Error('Unauthorized'));await expect(run(ctx,args())).rejects.toThrow('Unauthorized');expect(ctx.db.insert).not.toHaveBeenCalled();});
  it('never publishes or passes readiness even with a forged published listing',async()=>{expect(()=>listingSnapshot(row().draft,'zuo','retail')).toThrow('not approved');expect(()=>listingSnapshot(row().draft,'zuo','house')).toThrow('not approved');expect(await listingReady({} as any,{provider:'zuo'} as any,{published:true,channel:'house'} as any)).toBe(false);});
});


describe('Zuo staging media', () => {
  const handler = (fn: any) => fn._handler;
  it('bounds upload batches and requires admin', async () => {
    const ctx = { storage: { generateUploadUrl: vi.fn(async () => 'https://upload.example') } };
    await expect(handler(generateUploadUrls)(ctx, { count: 21 })).rejects.toThrow('1-20');
    expect(ctx.storage.generateUploadUrl).not.toHaveBeenCalled();
    expect(await handler(generateUploadUrls)(ctx, { count: 2 })).toHaveLength(2);
    vi.mocked(requireCjAdminIdentity).mockRejectedValueOnce(new Error('Unauthorized'));
    await expect(handler(generateUploadUrls)(ctx, { count: 1 })).rejects.toThrow('Unauthorized');
  });
  it('resolves only existing bounded image uploads without publication writes', async () => {
    const get = vi.fn(async () => ({ contentType: 'image/webp', size: 100 }));
    const ctx = { db: { system: { get } }, storage: { getUrl: vi.fn(async () => 'https://storage.example/image') } };
    expect(await handler(resolveUploadedMedia)(ctx, { storageIds: ['image'] })).toEqual([{ storageId: 'image', url: 'https://storage.example/image', contentType: 'image/webp', size: 100 }]);
    get.mockResolvedValueOnce({ contentType: 'text/html', size: 100 });
    await expect(handler(resolveUploadedMedia)(ctx, { storageIds: ['image'] })).rejects.toThrow('JPEG');
    get.mockResolvedValueOnce({ contentType: 'image/png', size: 20 * 1024 * 1024 + 1 });
    await expect(handler(resolveUploadedMedia)(ctx, { storageIds: ['image'] })).rejects.toThrow('20MB');
  });
});
