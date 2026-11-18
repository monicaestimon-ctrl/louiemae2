import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '../../lib/serverHttp.js';
import handler from '../../api/sitemap';
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock); vi.stubEnv('VITE_CONVEX_URL', 'https://fixture.convex.cloud'); vi.stubEnv('VITE_PRELAUNCH_MODE', 'false'); fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url, options) => {
    const {path,args} = JSON.parse(options.body);
    const value = path === 'siteContent:get' ? {collections:[{id:'decor',title:'Home Decor'}], privateCost:99}
      : path === 'blogPosts:sitemapPage' ? {page:['/blog/published'],isDone:true,continueCursor:''}
      : args.paginationOpts.cursor === null ? {page:[],isDone:false,continueCursor:'next'}
      : {page:['/products/visible','/products/visible'],isDone:true,continueCursor:''};
    return {ok:true,json:async()=>({status:'success',value})};
  });
});
afterEach(() => {vi.unstubAllGlobals();vi.unstubAllEnvs();});
async function request(method='GET') {
  const result = {status:0,body:'',headers:{} as Record<string,string>};
  const res = {setHeader:(k:string,v:string)=>{result.headers[k]=v;},status(code:number){result.status=code;return this;},send(body:string){result.body=body;}};
  await handler({method,query:{}} as VercelRequest,res as unknown as VercelResponse);return result;
}
it('includes only public canonical paths, follows empty candidate pages and deduplicates identities',async()=>{
  const result=await request();expect(result.status).toBe(200);
  expect(result.headers['Cache-Control']).toBe('no-store');
  expect(result.body).toContain('https://www.louiemae.com/collection/decor');
  expect(result.body).toContain('https://www.louiemae.com/blog/published');
  expect(result.body.match(/\/products\/visible/g)).toHaveLength(1);
  expect(result.body).not.toMatch(/privateCost|lastmod|\/admin|\/checkout|ref=/);
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(fetchMock.mock.calls.every(([,options])=>options.headers.Authorization===undefined)).toBe(true);
});
it('supports HEAD and rejects methods before querying',async()=>{
  expect((await request('HEAD')).body).toBe('');fetchMock.mockClear();
  const result=await request('POST');expect(result.status).toBe(405);expect(result.headers.Allow).toBe('GET, HEAD');expect(fetchMock).not.toHaveBeenCalled();
});
it('never turns an unavailable source into a partial successful sitemap',async()=>{
  fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({status:'success',value:null})});
  const result=await request();expect(result.status).toBe(503);expect(result.headers['Retry-After']).toBe('60');expect(result.body).not.toContain('urlset');
});
it('rejects private or cross-origin paths and loops in source cursors',async()=>{
  for(const value of [{page:['https://private.example'],isDone:true,continueCursor:''},{page:[],isDone:false,continueCursor:'same'}]) {
    fetchMock.mockImplementation(async(_url,options)=>({ok:true,json:async()=>({status:'success',value:JSON.parse(options.body).path==='siteContent:get'?{collections:[]}:value})}));
    expect((await request()).status).toBe(503);
  }
});
it('does not expose the full catalog during prelaunch',async()=>{
  vi.stubEnv('VITE_PRELAUNCH_MODE','true');expect((await request()).status).toBe(503);expect(fetchMock).not.toHaveBeenCalled();
});

it('fails closed on required splits even when the page claims completion',async()=>{
  fetchMock.mockImplementation(async(_url,options)=>({ok:true,json:async()=>({status:'success',value:JSON.parse(options.body).path==='siteContent:get'?{collections:[]}:{page:['/products/partial'],isDone:true,continueCursor:'',pageStatus:'SplitRequired',splitCursor:'split'}})}));
  const result=await request();expect(result.status).toBe(503);expect(result.body).not.toContain('/products/partial');
});
it('rereads a recommended split with a smaller page before accepting URLs',async()=>{
  fetchMock.mockImplementation(async(_url,options)=>{
    const {path,args}=JSON.parse(options.body);
    const value=path==='siteContent:get'?{collections:[]}:path==='blogPosts:sitemapPage'?{page:[],isDone:true,continueCursor:''}:args.paginationOpts.numItems>1?{page:['/products/discard'],isDone:true,continueCursor:'',pageStatus:'SplitRecommended',splitCursor:'split'}:{page:['/products/verified'],isDone:true,continueCursor:''};
    return {ok:true,json:async()=>({status:'success',value})};
  });
  const result=await request();expect(result.status).toBe(200);expect(result.body).toContain('/products/verified');expect(result.body).not.toContain('/products/discard');
});
