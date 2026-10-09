import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { internalMutation, internalQuery } from './_generated/server';
import { catalogPageOptions } from '../lib/catalogPagination';
import { INVENTORY_TARGET_KEY, getInventoryTargetState, inventoryTargets, syncInventoryTargets, targetKey } from './cjInventoryTargetMaintenance';
export const status = internalQuery({ args: {}, handler: getInventoryTargetState });
export const begin = internalMutation({ args: {}, handler: async ctx => {
  const old = await getInventoryTargetState(ctx);
  if (old?.enabled) throw new Error('Disable explicitly before rebuilding inventory targets.');
  const state = { key: INVENTORY_TARGET_KEY, enabled: false, phase: 'backfill' as const, cursor: null, checked: 0, mismatchIds: [], updatedAt: Date.now() };
  if (old) await ctx.db.replace(old._id, state); else await ctx.db.insert('cjInventoryTargetState',state);
  return state;
} });
export const advance = internalMutation({ args: { expectedPhase: v.union(v.literal('backfill'),v.literal('source'),v.literal('orphans')), expectedCursor: v.union(v.string(),v.null()) }, handler: async (ctx,args) => {
  const state=await getInventoryTargetState(ctx); if(!state) throw new Error('Begin first.');
  if(state.phase!==args.expectedPhase||state.cursor!==args.expectedCursor) return {...state,advanced:false};
  const mismatches:string[]=[];let cursor:string|null;let done:boolean;let checked:number;
  if(state.phase==='backfill'||state.phase==='source') {
    // Two near-limit product records bound source reads; targets contain only IDs.
    const page=await ctx.db.query('products').paginate(catalogPageOptions({cursor:state.cursor,numItems:2},2,2_000_000));
    for(const product of page.page){
      if(state.phase==='backfill')await syncInventoryTargets(ctx,product._id,product);
      else {
        const rows=await ctx.db.query('cjInventoryTargets').withIndex('by_product',q=>q.eq('productId',product._id)).collect();
        const actual=rows.map(targetKey).sort();const expected=inventoryTargets(product).map(targetKey).sort();
        if(JSON.stringify(actual)!==JSON.stringify(expected))mismatches.push(product._id);
      }
    }
    cursor=page.continueCursor;done=page.isDone;checked=page.page.length;
  } else {
    // Advance by distinct product ID, not by mapping row. A product with hundreds
    // of variants must not be reread hundreds of times during the orphan pass.
    cursor=state.cursor;done=false;checked=0;
    for(let n=0;n<2;n++) {
      const after=cursor as Id<'products'>|null;
      const row=await ctx.db.query('cjInventoryTargets').withIndex('by_product',q=>after?q.gt('productId',after):q).first();
      if(!row){done=true;break;}
      if(!await ctx.db.get(row.productId))mismatches.push(row.productId);
      cursor=row.productId;checked++;
    }
  }
  const phase=mismatches.length?'failed' as const:done?(state.phase==='backfill'?'source' as const:state.phase==='source'?'orphans' as const:'verified' as const):state.phase;
  const next={phase,cursor:done||mismatches.length?null:cursor,checked:state.checked+checked,mismatchIds:mismatches,updatedAt:Date.now()};
  await ctx.db.patch(state._id,next);return {...state,...next,advanced:true};
} });
export const setEnabled = internalMutation({args:{enabled:v.boolean()},handler:async(ctx,args)=>{
  const state=await getInventoryTargetState(ctx);if(!state)throw new Error('Build and verify inventory targets first.');
  if(args.enabled&&state.phase!=='verified')throw new Error('Verify inventory targets before enabling.');
  await ctx.db.patch(state._id,{enabled:args.enabled,updatedAt:Date.now()});
}});
