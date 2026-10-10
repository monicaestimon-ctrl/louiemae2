// @vitest-environment node
/// <reference types="vite/client" />
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from './schema';
import { requireCjAdminIdentity } from './cjAdminAccess';
import type { Id } from './_generated/dataModel';

vi.mock('./cjAdminAccess', () => ({ requireCjAdminIdentity: vi.fn(async () => ({ email:'admin@example.test' })) }));
const modules=import.meta.glob(['./**/*.ts','./_generated/*.js']);
const create=makeFunctionReference<'mutation'>('products:createBatch');
const mark=makeFunctionReference<'mutation'>('batchImports:markImported');
const latest=makeFunctionReference<'query'>('batchImports:getLatest');
const payload={product:{title:'Supplier chair',images:['source.jpg']}};
const product=(itemId:Id<'batchImportItems'>,name='Asterelle Ashwood Barstool')=>({
  name,price:90,description:'A hidden supplier import',category:'Barstools',collection:'furniture',
  storefrontStatus:'hidden',cjSourcingStatus:'none',batchImportItemId:itemId,
  sourceUrl:'https://detail.1688.com/offer/999860531975.html',
  images:Array.from({length:6},(_,i)=>`https://example.test/image-${i}.jpg`),
  variants:Array.from({length:10},(_,i)=>({id:`v-${i}`,name:`Style ${i}`,priceAdjustment:i,inStock:true})),
  sourceProperties:[{key:'尺寸',value:'50–70 cm'},{key:'材质',value:'Ash wood'}],
});
async function setup() {
  const t=convexTest(schema,modules);
  const ids=await t.run(async ctx=>{
    const now=Date.now();
    const job=await ctx.db.insert('batchImportJobs',{status:'ready',total:2,fetchConcurrency:3,reviewBatchSize:12,createdAt:now,updatedAt:now});
    const items:Id<'batchImportItems'>[]=[];
    for(let i=0;i<2;i++){
      const item=await ctx.db.insert('batchImportItems',{jobId:job,position:i,inputUrl:'https://example.test/'+i,normalizedUrl:'https://example.test/'+i,status:'ready',stage:'Ready',attempts:1,createdAt:now,updatedAt:now,resultBytes:100,...(i===1?{result:payload}:{})});
      items.push(item);
      if(i===0)await ctx.db.insert('batchImportPayloads',{itemId:item,jobId:job,version:1,byteLength:100,result:payload,createdAt:now,expiresAt:now+72*3600000});
    }
    return {job,items};
  });
  return {t,...ids};
}
beforeEach(()=>vi.mocked(requireCjAdminIdentity).mockResolvedValue({email:'admin@example.test'}));

describe('reviewed batch completion',()=>{
  it('retries a saved group without duplication, releases only its payload, and completes after the final group',async()=>{
    const {t,job,items}=await setup();
    const args={products:[product(items[0])]};
    const saved=await t.mutation(create,args);
    expect(await t.run(ctx=>ctx.db.get(items[0]))).toMatchObject({status:'imported',resultBytes:0});
    expect(await t.mutation(create,args)).toEqual(saved);
    expect(await t.run(ctx=>ctx.db.query('products').collect())).toHaveLength(1);
    await t.mutation(mark,{itemIds:[items[0],items[0]]});
    await t.mutation(mark,{itemIds:[items[0]]});
    expect(await t.run(ctx=>ctx.db.get(items[0]))).toMatchObject({status:'imported',resultBytes:0});
    expect(await t.run(ctx=>ctx.db.query('batchImportPayloads').collect())).toEqual([]);
    expect(await t.run(ctx=>ctx.db.get(items[1]))).toMatchObject({status:'ready',result:payload,resultBytes:100});
    expect(await t.query(latest,{})).toMatchObject({_id:job,status:'ready'});
    const stored=await t.run(ctx=>ctx.db.query('products').first());
    expect(stored?.images).toHaveLength(6);expect(stored?.variants).toHaveLength(10);
    expect(stored?.sourceProperties).toEqual(args.products[0].sourceProperties);
    expect(await t.run(ctx=>ctx.db.query('productCatalog').first())).toMatchObject({productId:saved[0],visible:false});
    await t.mutation(create,{products:[product(items[1],'Clovelia Ashwood Barstool')]});
    await t.mutation(mark,{itemIds:[items[1]]});
    const finalItem=await t.run(ctx=>ctx.db.get(items[1]));
    expect(finalItem).toMatchObject({status:'imported',resultBytes:0});expect(finalItem?.result).toBeUndefined();
    expect(await t.run(ctx=>ctx.db.get(job))).toMatchObject({status:'completed'});
    expect(await t.query(latest,{})).toBeNull();
    expect(await t.run(ctx=>ctx.db.query('products').collect())).toHaveLength(2);
    expect(await t.mutation(create,args)).toEqual(saved);
    expect(await t.run(ctx=>ctx.db.query('products').collect())).toHaveLength(2);
  });

  it('keeps review payloads intact when product validation fails',async()=>{
    const {t,job,items}=await setup();
    await expect(t.mutation(create,{products:[{...product(items[0]),name:''}]})).rejects.toThrow();
    expect(await t.run(ctx=>ctx.db.query('products').collect())).toEqual([]);
    expect(await t.run(ctx=>ctx.db.query('batchImportPayloads').collect())).toHaveLength(1);
    expect(await t.run(ctx=>ctx.db.get(items[0]))).toMatchObject({status:'ready',resultBytes:100});
    expect(await t.query(latest,{})).toMatchObject({_id:job,status:'ready'});
  });

  it('rolls product and summary writes back when batch completion cannot commit',async()=>{
    const {t,job,items}=await setup();
    await t.run(ctx=>ctx.db.patch(job,{status:'cancelled'}));
    await expect(t.mutation(create,{products:[product(items[0])]})).rejects.toThrow('IMPORT_ITEM_NOT_READY');
    expect(await t.run(ctx=>ctx.db.query('products').collect())).toEqual([]);
    expect(await t.run(ctx=>ctx.db.query('productCatalog').collect())).toEqual([]);
    expect(await t.run(ctx=>ctx.db.query('productNameClaims').collect())).toEqual([]);
    expect(await t.run(ctx=>ctx.db.query('batchImportPayloads').collect())).toHaveLength(1);
    expect(await t.run(ctx=>ctx.db.get(items[0]))).toMatchObject({status:'ready',resultBytes:100});
  });

  it('refuses legacy completion before the product was saved',async()=>{
    const {t,items}=await setup();
    await expect(t.mutation(mark,{itemIds:[items[0]]})).rejects.toThrow('IMPORT_NOT_SAVED');
    expect(await t.run(ctx=>ctx.db.query('batchImportPayloads').collect())).toHaveLength(1);
    expect(await t.run(ctx=>ctx.db.get(items[0]))).toMatchObject({status:'ready'});
  });

  it('does not release payloads or mark items when authorization fails',async()=>{
    const {t,items}=await setup();
    vi.mocked(requireCjAdminIdentity).mockRejectedValueOnce(new Error('Not an admin'));
    await expect(t.mutation(mark,{itemIds:items})).rejects.toThrow('Not an admin');
    expect(await t.run(ctx=>ctx.db.query('batchImportPayloads').collect())).toHaveLength(1);
    expect(await t.run(ctx=>ctx.db.get(items[0]))).toMatchObject({status:'ready'});
  });
});
