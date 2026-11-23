// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { commissionReserve } from './dlvCommission';
import { categoryAtClick } from './prgRateHistory';
import { CONFIG_SEED } from '../lib/config/seed';
import { ATTRIBUTION_WINDOW_MS } from '../lib/attribution';
import { isCommerceError } from '../lib/errors';
import { TIER_ORDER } from '../lib/tiers';
import type { CommissionCategory, CommissionSchedule } from '../lib/config';
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const now = Date.UTC(2026, 10, 23), day = 86400000;
beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now }));
afterEach(() => vi.useRealTimers());
async function setup() {
  const t = convexTest(schema, modules);
  const value = globalThis.structuredClone(CONFIG_SEED.find(r => r.kind === 'commissionSchedule')!.value) as CommissionSchedule;
  const ids = await t.run(async ctx => {
    const productId = await ctx.db.insert('commerceProducts', { provider: 'zuo', sourceKey: 'zuo:fixture', draft: { name:'Fixture',description:'',category:'sofa',images:[],referenceImages:[],sourceUrl:'',supplierName:'',supplierContact:'',facts:'',packaging:'',currency:'USD',usdRate:1,variants:[],conflicts:[],factsApproved:true,imagesApproved:true,referencePermission:true }, revision:1,updatedAt:now });
    const userId = await ctx.db.insert('users', { email:'partner@example.com' });
    const beneficiaryId = await ctx.db.insert('prgBeneficiaries', { kind:'person',userId,displayName:'Partner',payoutReadiness:'not_started',taxReadiness:'none',tierKey:'elite',status:'active',createdAt:now,updatedAt:now });
    const scheduleId = await ctx.db.insert('sysConfig', {kind:'commissionSchedule',key:'commission-schedule',version:2,status:'approved',value,note:'fixture',approvedAt:now-60*day,approvedBy:'fixture',createdAt:now-60*day,createdBy:'fixture',effectiveFrom:0,source:'fixture'});
    return { productId, beneficiaryId, scheduleId };
  });
  const click = (at = now - 10*day, expiresAt = at + ATTRIBUTION_WINDOW_MS, eligible = true) => t.run(ctx => ctx.db.insert('prgReferralClicks', {clickId:`click-${at}`,beneficiaryId:ids.beneficiaryId,membershipSource:'creator',visitorKeyHash:'fixture',consent:'granted',eligible,rateSnapshot:{tierKey:'elite',scheduleVersion:2},at,expiresAt}));
  const exception = (rateBps = 500, effectiveFrom = now - 40*day, effectiveTo?: number) => t.run(ctx => ctx.db.insert('prgSkuCommissionExceptions', {productId:ids.productId,rates:TIER_ORDER.map(tierKey=>({tierKey,rateBps})),visibleNote:'Visible exception',effectiveFrom,...(effectiveTo===undefined?{}:{effectiveTo}),createdAt:effectiveFrom,approvedBy:'fixture',version:1}));
  const reserve = (category: CommissionCategory = 'furniture', at = now, eligible: boolean|undefined = true) => t.run(ctx => commissionReserve(ctx,ids.productId,category,eligible,at));
  const audit = (at: number, before: string|null, after: string, action='category.commit') => t.run(ctx => ctx.db.insert('sysAuditEvents', {actor:'fixture',action,entityTable:'commerceProducts',entityId:ids.productId,before,after,at}));
  return {t,value,...ids,click,exception,reserve,audit};
}
it('funds a stable visible 5% exception rather than adding the standard 18% schedule',async()=>{
  const s=await setup();await s.click();const id=await s.exception();
  const result=await s.reserve();expect(result.bps).toBe(500);expect(result.versions).toContain(id);
});
it('retains 18% for pre-change visits, then releases it exactly at the 30-day boundary',async()=>{
  const s=await setup();await s.click(now-20*day);await s.exception(500,now-5*day);
  expect((await s.reserve()).bps).toBe(1800);
  expect((await s.reserve('furniture',now+10*day)).bps).toBe(500);
});
it('does not manufacture pre-launch history when there are no eligible visits',async()=>{
  const s=await setup();await s.t.run(ctx=>ctx.db.patch(s.scheduleId,{approvedAt:now,effectiveFrom:0}));await s.exception();
  expect((await s.reserve()).bps).toBe(500);
  await s.click(now-1);await expect(s.reserve()).rejects.toSatisfy(e=>isCommerceError(e,'COST_REVIEW_REQUIRED'));
});
it('preserves the furniture maximum after a change to décor, without changing the current category',async()=>{
  const s=await setup();await s.click();await s.audit(now-day,'furniture','decor');
  expect((await s.reserve('decor')).bps).toBe(1800);
  expect((await s.reserve('decor',now+21*day)).bps).toBe(1200);
});
it('preserves both sides of a category change at the exact click timestamp',async()=>{
  const s=await setup();await s.click(now-day);await s.audit(now-day,'furniture','decor');
  expect((await s.reserve('decor')).bps).toBe(1800);
});
it('uses the historical schedule ceiling for exception rates',async()=>{
  const s=await setup();await s.click();await s.exception(2000);
  await s.t.run(ctx=>ctx.db.patch(s.scheduleId,{value:{...s.value,ceilingBps:1900}}));
  expect((await s.reserve()).bps).toBe(1900);
});
it('expires estimates at a future exception start and at the active exception end',async()=>{
  const s=await setup();await s.exception(500,now-40*day,now+day);
  expect(await s.reserve()).toMatchObject({bps:500,validUntil:now+day});
  await s.exception(1000,now+day,now+2*day);
  expect(await s.reserve()).toMatchObject({bps:500,validUntil:now+day});
  expect((await s.reserve('furniture',now+2*day)).bps).toBe(1800);
});
it('bounds a quote at an approved future commission schedule change',async()=>{
  const s=await setup();await s.t.run(async ctx=>{
    await ctx.db.patch(s.scheduleId,{effectiveTo:now+day});
    const old=(await ctx.db.get(s.scheduleId))!;
    const {_id,_creationTime,...record}=old;void _id;void _creationTime;
    await ctx.db.insert('sysConfig',{...record,version:3,effectiveFrom:now+day,effectiveTo:undefined,approvedAt:now,value:{...s.value,tiers:s.value.tiers.map(t=>({...t,rates:{...t.rates,furniture:2000}}))}});
  });
  expect(await s.reserve()).toMatchObject({bps:1800,validUntil:now+day});
  expect((await s.reserve('furniture',now+day)).bps).toBe(2000);
});
it('ignores ineligible, future and expired visits when choosing the protected interval',async()=>{
  const s=await setup();await s.exception();
  await s.click(now-20*day,now,false);await s.click(now+day);await s.click(now-ATTRIBUTION_WINDOW_MS,now+day);
  expect((await s.reserve()).bps).toBe(500);
});
it('fails explicitly if an expired prefix hides a still-valid protected visit',async()=>{
  const s=await setup();for(let i=0;i<200;i++)await s.click(now-20*day+i,now);
  await s.click(now-day);await expect(s.reserve()).rejects.toSatisfy(e=>isCommerceError(e,'COST_REVIEW_REQUIRED'));
});
it.each(['incomplete','overlap','reversed','backdated'] as const)('rejects %s exception evidence',async kind=>{
  const s=await setup();const id=await s.exception();
  if(kind==='overlap')await s.exception(600,now-day);
  else await s.t.run(ctx=>ctx.db.patch(id,kind==='incomplete'?{rates:[{tierKey:'base',rateBps:500}]}:kind==='reversed'?{effectiveTo:now-41*day}:{createdAt:now}));
  await expect(s.reserve()).rejects.toSatisfy(e=>isCommerceError(e,'COST_REVIEW_REQUIRED'));
});
it('does not let unrelated product audits exhaust category history',async()=>{
  const s=await setup();await s.click();await s.audit(now-day,'furniture','decor');
  for(let i=0;i<110;i++)await s.audit(now-i,'unrelated','unrelated','price.approve');
  expect((await s.reserve('decor')).bps).toBe(1800);
  expect(await s.t.run(ctx=>categoryAtClick(ctx,s.productId,'decor',now-10*day))).toBe('furniture');
});
it('rejects broken category lineage instead of assuming a lower rate',async()=>{
  const s=await setup();await s.click();await s.audit(now-day,'furniture','clothing');
  await expect(s.reserve('decor')).rejects.toSatisfy(e=>isCommerceError(e,'COST_REVIEW_REQUIRED'));
});
it('leaves disabled referral products at zero and rejects unresolved eligibility',async()=>{
  const s=await setup();expect((await s.reserve('furniture',now,false)).bps).toBe(0);
  await expect(s.t.run(ctx=>commissionReserve(ctx,s.productId,'furniture',undefined,now))).rejects.toSatisfy(e=>isCommerceError(e,'COST_REVIEW_REQUIRED'));
});
it('retains a retired higher schedule only while an older visit remains valid',async()=>{
  const s=await setup();await s.click(now-20*day);
  await s.t.run(async ctx=>{
    await ctx.db.patch(s.scheduleId,{status:'retired',effectiveTo:now-5*day});
    const {_id,_creationTime,...old}=(await ctx.db.get(s.scheduleId))!;void _id;void _creationTime;
    await ctx.db.insert('sysConfig',{...old,status:'approved',version:3,effectiveFrom:now-5*day,effectiveTo:undefined,approvedAt:now-5*day,value:{...s.value,tiers:s.value.tiers.map(t=>({...t,rates:{...t.rates,furniture:1000}}))}});
  });
  expect((await s.reserve()).bps).toBe(1800);
  expect((await s.reserve('furniture',now+10*day)).bps).toBe(1000);
});
it('rejects a gap in protected approved schedule coverage',async()=>{
  const s=await setup();await s.click();
  await s.t.run(ctx=>ctx.db.patch(s.scheduleId,{approvedAt:now-day,effectiveFrom:now-day}));
  await expect(s.reserve()).rejects.toSatisfy(e=>isCommerceError(e,'COST_REVIEW_REQUIRED'));
});
it('fails explicitly at the exception history bound instead of dropping older rates',async()=>{
  const s=await setup();
  for(let i=0;i<101;i++)await s.exception(500,now+(i+1)*day,now+(i+2)*day);
  await expect(s.reserve()).rejects.toSatisfy(e=>isCommerceError(e,'COST_REVIEW_REQUIRED'));
});
it('does not lose a linked-product rate at an exception replacement timestamp',async()=>{
  const s=await setup();await s.click(now-day);await s.exception(1500,now-40*day,now-day);await s.exception(500,now-day);
  expect((await s.reserve()).bps).toBe(1500);
});
