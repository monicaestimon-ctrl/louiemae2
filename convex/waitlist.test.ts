import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { register, list, unsubscribe } from './waitlist';

vi.mock('./cjAdminAccess', () => ({ requireCjAdminIdentity: vi.fn(async () => {throw new Error('Unauthorized');}) }));

function database() {
  const rows: Record<string, any[]> = {waitlistSignups:[], subscribers:[], waitlistRateLimits:[], klaviyoWaitlistJobs:[]};
  let next=0;
  const ctx = {
    scheduler:{runAfter:vi.fn()},
    db: {
      query(table: string) {
        let selection=rows[table];
        const query = {
          withIndex(_index: string, fn: (q: any) => any) {
            fn({eq:(key: string,value: unknown) => {selection=selection.filter(r => r[key]===value);},lt:(key: string,value: number) => {selection=selection.filter(r => r[key]<value);}});
            return query;
          },
          unique:async () => selection[0]??null, first:async () => selection[0]??null,
          take:async (count: number) => selection.slice(0,count), collect:async () => selection,
        }; return query;
      },
      insert:async (table: string,data: any) => {const _id=String(++next);rows[table].push({...data,_id});return _id;},
      patch:async (id: string,data: any) => {Object.assign(Object.values(rows).flat().find(r=>r._id===id)!,data);},
      get:async (id: string) => Object.values(rows).flat().find(r=>r._id===id),
      delete:async (id: string) => {for(const table of Object.keys(rows)) rows[table]=rows[table].filter(r=>r._id!==id);},
    },
  }; return {ctx,rows};
}
const args={secret:'test-only-secret',email:'Mae@Example.com',rateKey:'a'.repeat(64),consent:true};
describe('persistent waitlist intake', () => {
  beforeEach(() => {vi.stubEnv('WAITLIST_INTAKE_SECRET',args.secret);});
  afterEach(() => vi.unstubAllEnvs());
  it('saves consent and source, mirrors the subscriber and deduplicates normalized emails', async () => {
    const {ctx,rows}=database();
    await (register as any)._handler(ctx,args);
    await (register as any)._handler(ctx,{...args,email:'  mae@example.com '});
    expect(rows.waitlistSignups).toHaveLength(1);
    expect(rows.waitlistSignups[0]).toMatchObject({email:'mae@example.com',source:'prelaunch',status:'active',consentVersion:'2026-09-13'});
    expect(rows.subscribers).toHaveLength(1);
    expect(rows.klaviyoWaitlistJobs).toHaveLength(1);
    expect(rows.subscribers[0].tags).toContain('prelaunch-waitlist');
    expect(ctx.scheduler.runAfter).toHaveBeenCalledOnce();
  });
  it('does not reactivate an unsubscribed email', async () => {
    const {ctx,rows}=database();
    await ctx.db.insert('subscribers',{email:'mae@example.com',status:'unsubscribed',tags:[]});
    await (register as any)._handler(ctx,args);
    expect(rows.waitlistSignups[0].status).toBe('unsubscribed');
    expect(rows.subscribers[0].status).toBe('unsubscribed');
    expect(rows.klaviyoWaitlistJobs).toHaveLength(0);
  });
  it('rejects direct unauthenticated intake and malformed input without storing data', async () => {
    const {ctx,rows}=database();
    for (const invalid of [{...args,secret:'wrong'},{...args,email:'invalid'},{...args,consent:false}]) await expect((register as any)._handler(ctx,invalid)).rejects.toThrow();
    expect(rows.waitlistSignups).toHaveLength(0);
  });
  it('limits repeated requests and denies anonymous reads and changes', async () => {
    const {ctx,rows}=database();
    for(let i=0;i<10;i++) await (register as any)._handler(ctx,args);
    expect(await (register as any)._handler(ctx,args)).toEqual({ok:false});
    expect(rows.waitlistSignups).toHaveLength(1);
    await expect((list as any)._handler(ctx,{paginationOpts:{numItems:10,cursor:null}})).rejects.toThrow('Unauthorized');
    await expect((unsubscribe as any)._handler(ctx,{id:'1'})).rejects.toThrow('Unauthorized');
  });
});
