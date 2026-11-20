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
  const records:any[]=[]; const audits:any[]=[]; const tables:Record<string,any[]>={commerceProducts:records,commerceAudit:audits};
  const ctx:any={db:{query:(table:string)=>({withIndex:(_index:string, filter:any)=>{
    const eqs:[string,any][]=[];const q:any={eq:(k:string,v:any)=>{eqs.push([k,v]);return q;}};filter(q);
    return {unique:async()=>(tables[table]??[]).find(r=>eqs.every(([k,v])=>r[k]===v))??null};
  }}),insert:vi.fn(async(table:string,doc:any)=>{const id=table+':'+(tables[table]?.length??0);(tables[table]??=[]).push({...doc,_id:id});return id;})}};
  return {ctx,records,audits,tables};
}
const args=(r=row())=>({runId:'review-20261107',manifestSha256:'a'.repeat(64),rows:[r]});
describe('Zuo staging foundation',()=>{
  it('preserves excluded evidence, exact sellable-pack prices and pack without creating listings; repeat is idempotent',async()=>{
    const {ctx,records,audits}=context();const a=args(row(true));await run(ctx,a);await run(ctx,a);
    expect(records[0].sourceKey).toBe('zuo:123456');
    expect(records).toHaveLength(1);expect(audits).toHaveLength(1);
    expect(records[0].draft.variants[0]).toMatchObject({minimum:1,increment:1,retail:30000,commercial:28501});
    expect(records[0].zuoStaging).toMatchObject({unitsPerSellUnit:2,excluded:true,exclusionReasons:['DISCONTINUED'],holdReasons:['Freight unverified'],status:'staged_not_orderable'});
    expect(ctx.db.insert.mock.calls.map((c:any)=>c[0])).toEqual(['commerceProducts','catSuppliers','catProductMeta','commerceAudit']);
  });
  it('creates Phase C metadata once and keeps later reviewed metadata intact',async()=>{
    const {ctx,tables}=context();await run(ctx,args());
    expect(tables.catSuppliers[0]).toMatchObject({code:'zuo',publicAttributionAllowed:false,fulfillmentRoute:'manual_dealer_zuo',freshnessKey:'freshness-default'});
    expect(tables.catProductMeta[0]).toMatchObject({stage:'imported_draft',commissionCategory:'review_required',holds:['CATEGORY_REVIEW','MANUAL'],supplierProductRef:'123456'});
    tables.catProductMeta[0].louieMaeName='Owner revision';await run(ctx,args());
    expect(tables.catProductMeta).toHaveLength(1);expect(tables.catProductMeta[0].louieMaeName).toBe('Owner revision');
    expect(tables.catVariants).toBeUndefined();
  });
  it('preserves an explicit decor category for lighting without a category hold',async()=>{
    const {ctx,tables}=context();const a=args();a.rows[0].draft.facts=JSON.stringify({commissionCategory:'decor',supplierName:'Original Supplier Lamp'});
    await run(ctx,a);expect(tables.catProductMeta[0]).toMatchObject({commissionCategory:'decor',supplierName:'Original Supplier Lamp',holds:['MANUAL']});
  });
  it('uses original product name from source evidence when facts omit it',async()=>{
    const {ctx,tables}=context();const a=args();a.rows[0].sourceEvidence=JSON.stringify({originalSupplierName:'Supplier Dining Chair'});
    await run(ctx,a);expect(tables.catProductMeta[0].supplierName).toBe('Supplier Dining Chair');
  });
  it('refuses legacy staging identities instead of duplicating products',async()=>{
    const {ctx,records}=context();records.push({_id:'old',sourceKey:'zuo:sku:123456'});
    await expect(run(ctx,args())).rejects.toThrow('requires migration');expect(ctx.db.insert).not.toHaveBeenCalled();
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
