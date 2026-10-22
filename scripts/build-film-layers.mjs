// Cuts the layers the hero's build sequence is composited from, one set per film.
//
//   node scripts/build-film-layers.mjs [film-key ...]
//
// The films crossfade between finished stages (plan, clay, empty room, furnished room), so the
// furniture pops in and out. The hero now builds the room itself instead: walls rise from the
// plan, each piece is framed, formed in clay and finished in place. Everything is derived from
// three frames of the film: the plan, the finished room before the furniture arrives and the
// furnished room. The difference between the last two is each piece's silhouette.
//
// Writes public/trade/f/<film>/b/{plan,room,full}.webp, mask.png (R = piece number, G = alpha)
// and meta.json. Needs Google Chrome or Microsoft Edge (H.264 decode); set CHROME to override.
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { URL } from 'node:url';

// Node 22+ ships a browser-compatible WebSocket client; it talks to Chrome's DevTools port.
const { WebSocket } = globalThis;

const root = path.resolve('public/trade/f');
const app = readFileSync(path.resolve('trade/app.ts'), 'utf8');
const films = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'scenes').map((d) => d.name);

/** Reads a film's timeline straight out of FILMS in trade/app.ts. */
function timeline(fk) {
  const m = app.match(new RegExp(`'?${fk}'?:\\{space:[^\\n]*?TL:(\\{.*?"reg":\\{[^}]*\\}\\})`));
  if (!m) throw new Error(`No timeline for ${fk} in trade/app.ts`);
  return JSON.parse(m[1]);
}

const chrome = process.env.CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => existsSync(p));
if (!chrome) throw new Error('Chrome or Edge not found; set CHROME to its path.');

// ---------- the page that does the work, in the browser ----------
const PAGE = `<!doctype html><meta charset="utf-8"><script>
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function frames(src,times){
  const v=document.createElement('video');v.src=src;v.muted=true;v.preload='auto';document.body.appendChild(v);
  await new Promise((r,j)=>{v.onloadeddata=r;v.onerror=()=>j(new Error('video failed to load'))});
  const W=v.videoWidth,H=v.videoHeight,out=[];
  for(const t of times){v.currentTime=t;await new Promise(r=>v.addEventListener('seeked',r,{once:true}));
    await Promise.race([new Promise(r=>v.requestVideoFrameCallback?v.requestVideoFrameCallback(()=>r()):r()),sleep(400)]);
    const c=new OffscreenCanvas(W,H);c.getContext('2d').drawImage(v,0,0);out.push(c)}
  return out;
}
const lum=d=>{const L=new Float32Array(d.length/4);for(let i=0;i<L.length;i++)L[i]=(.3*d[i*4]+.59*d[i*4+1]+.11*d[i*4+2]);return L};
function boxBlur(a,W,H,r){const t=new Float32Array(a.length),o=new Float32Array(a.length),n=2*r+1;
  for(let y=0;y<H;y++){let s=0;for(let x=-r;x<=r;x++)s+=a[y*W+Math.min(W-1,Math.max(0,x))];for(let x=0;x<W;x++){t[y*W+x]=s/n;s+=a[y*W+Math.min(W-1,x+r+1)]-a[y*W+Math.max(0,x-r)]}}
  for(let x=0;x<W;x++){let s=0;for(let y=-r;y<=r;y++)s+=t[Math.min(H-1,Math.max(0,y))*W+x];for(let y=0;y<H;y++){o[y*W+x]=s/n;s+=t[Math.min(H-1,y+r+1)*W+x]-t[Math.max(0,y-r)*W+x]}}
  return o}
const ss=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t)};
async function save(film,name,blob){const r=await fetch('/out/'+film+'/'+name,{method:'PUT',body:blob});if(!r.ok)throw new Error('save '+name+' '+r.status)}
window.build=async(film,T)=>{
  const [plan,room,full]=await frames('/'+film+'/film.mp4',[T.plan,T.room,T.full]);
  const W=room.width,H=room.height,N=W*H;
  const a=room.getContext('2d').getImageData(0,0,W,H).data,b=full.getContext('2d').getImageData(0,0,W,H).data;
  // Difference in hue more than in brightness: the floor's gloss and the sun patches shift
  // between the two frames, but upholstery, leather and planting change the colour.
  const ch=(s,k)=>{const o=new Float32Array(N);for(let i=0;i<N;i++)o[i]=s[i*4+k];return boxBlur(o,W,H,4)};
  const ar=ch(a,0),ag=ch(a,1),ab=ch(a,2),br=ch(b,0),bg=ch(b,1),bb=ch(b,2);
  let m=new Float32Array(N);
  for(let i=0;i<N;i++){const la=.3*ar[i]+.59*ag[i]+.11*ab[i],lb=.3*br[i]+.59*bg[i]+.11*bb[i];
    const dc=Math.hypot((ar[i]-la)-(br[i]-lb),(ab[i]-la)-(bb[i]-lb));m[i]=dc+T.lumaW*Math.abs(la-lb)>T.thresh?1:0}
  // close small gaps (dilate then erode), then drop specks
  const R=Math.round(W/T.close);m=boxBlur(m,W,H,R).map(x=>x>.02?1:0);m=boxBlur(m,W,H,R).map(x=>x>.98?1:0);
  // Leather can match a wooden floor closely enough to leave holes inside a piece. Fill
  // anything the background can't reach from the edge of the frame.
  {const out=new Uint8Array(N),q=[];const push=i=>{if(!m[i]&&!out[i]){out[i]=1;q.push(i)}};
    for(let x=0;x<W;x++){push(x);push((H-1)*W+x)}for(let y=0;y<H;y++){push(y*W);push(y*W+W-1)}
    while(q.length){const p=q.pop(),x=p%W;if(x>0)push(p-1);if(x<W-1)push(p+1);if(p>=W)push(p-W);if(p<N-W)push(p+W)}
    for(let i=0;i<N;i++)if(!m[i]&&!out[i])m[i]=1}
  // round off the blocky corners the box filters leave
  {const r=Math.round(W/256);m=boxBlur(boxBlur(m,W,H,r),W,H,r).map(x=>x>.5?1:0)}
  // Pieces that touch (chairs round a table, a sofa on its rug) form one blob. Erode hard so
  // they come apart at the narrow joins, label those cores, then grow each core back out over
  // the full mask so every pixel belongs to the nearest piece.
  const core=boxBlur(m,W,H,T.split).map(x=>x>.97?1:0);
  const nb=(p,x)=>[x>0?p-1:-1,x<W-1?p+1:-1,p-W,p+W];
  const lab=new Int32Array(N),seeds=[];let id=0;const st=new Int32Array(N);
  for(let i=0;i<N;i++){if(!core[i]||lab[i])continue;id++;let sp=0,n=0;st[sp++]=i;lab[i]=id;const px=[];
    while(sp){const p=st[--sp];n++;px.push(p);for(const q of nb(p,p%W)){if(q<0||q>=N||lab[q]||!core[q])continue;lab[q]=id;st[sp++]=q}}
    if(n<N*T.minCore)for(const p of px)lab[p]=-1;else for(const p of px)seeds.push(p)}
  for(let i=0;i<N;i++)if(lab[i]<0)lab[i]=0;
  let front=seeds;while(front.length){const nx=[];for(const p of front)for(const q of nb(p,p%W)){if(q<0||q>=N||lab[q]||!m[q])continue;lab[q]=lab[p];nx.push(q)}front=nx}
  // Rugs still tie whole seating groups together. Split any oversized group by position and
  // material colour (k-means), which separates a sofa from its rug and the chairs beside it.
  {const size=new Map();for(let i=0;i<N;i++)if(lab[i])size.set(lab[i],(size.get(lab[i])||0)+1);
    let next=id+1;
    for(const [l,n] of size){if(n<N*T.bigGroup)continue;const k=Math.min(6,Math.max(2,Math.round(n/(N*T.bigGroup*.6))));
      const idx=[];for(let i=0;i<N;i++)if(lab[i]===l)idx.push(i);
      const f=i=>{const x=i%W,y=(i/W)|0,L=.3*br[i]+.59*bg[i]+.11*bb[i];return [x/W*2,y/H*2,(br[i]-L)/40*T.colourW,(bb[i]-L)/40*T.colourW,L/255*T.colourW]};
      const cs=[];for(let j=0;j<k;j++)cs.push(f(idx[Math.floor((j+.5)/k*idx.length)]));
      const as=new Uint8Array(idx.length);
      for(let it=0;it<12;it++){const sum=cs.map(()=>[0,0,0,0,0,0]);
        for(let s=0;s<idx.length;s++){const v=f(idx[s]);let best=0,bd=1e9;for(let j=0;j<k;j++){let d=0;for(let e=0;e<5;e++)d+=(v[e]-cs[j][e])**2;if(d<bd){bd=d;best=j}}as[s]=best;const S=sum[best];for(let e=0;e<5;e++)S[e]+=v[e];S[5]++}
        sum.forEach((S,j)=>{if(S[5])cs[j]=S.slice(0,5).map(x=>x/S[5])})}
      const ids=cs.map((_,j)=>j?next++:l);for(let s=0;s<idx.length;s++)lab[idx[s]]=ids[as[s]]}
    // tidy: each label keeps only its largest connected part, the scraps join a neighbour
    const part=new Int32Array(N),best=new Map();let pid=0;const partSize=[0];
    for(let i=0;i<N;i++){if(!lab[i]||part[i])continue;pid++;const l=lab[i];let sp=0,n=0;st[sp++]=i;part[i]=pid;
      while(sp){const p=st[--sp];n++;for(const q of nb(p,p%W)){if(q<0||q>=N||part[q]||lab[q]!==l)continue;part[q]=pid;st[sp++]=q}}
      partSize[pid]=n;const b=best.get(l);if(!b||n>partSize[b])best.set(l,pid)}
    const keepPart=new Set(best.values());const holes=[];
    for(let i=0;i<N;i++)if(lab[i]&&!keepPart.has(part[i])){lab[i]=0;holes.push(i)}
    let fr=[];for(let i=0;i<N;i++)if(lab[i])fr.push(i);
    while(fr.length){const nx=[];for(const p of fr)for(const q of nb(p,p%W)){if(q<0||q>=N||lab[q]||!m[q])continue;lab[q]=lab[p];nx.push(q)}fr=nx}
  }
  const comps=new Map();
  for(let i=0;i<N;i++){const l=lab[i];if(!l)continue;const x=i%W,y=(i/W)|0;let c=comps.get(l);if(!c)comps.set(l,c={id:l,n:0,x0:W,y0:H,x1:0,y1:0});c.n++;if(x<c.x0)c.x0=x;if(x>c.x1)c.x1=x;if(y<c.y0)c.y0=y;if(y>c.y1)c.y1=y}
  const all=[...comps.values()].map(c=>({id:c.id,n:c.n,x:c.x0,y:c.y0,w:c.x1-c.x0+1,h:c.y1-c.y0+1}));
  let keep=all.filter(c=>c.n>=N*T.minArea);const comps2=all;
  // build order: back of the room first (highest bottom edge), then forward
  keep.sort((p,q)=>(p.y+p.h)-(q.y+q.h)||p.x-q.x);
  const remap=new Map(keep.map((c,i)=>[c.id,i+1]));
  // soft edge: feather the kept mask, and give the feather pixels their nearest piece's number
  const hard=new Float32Array(N);for(let i=0;i<N;i++)hard[i]=remap.has(lab[i])?1:0;
  const soft=boxBlur(boxBlur(hard,W,H,3),W,H,3);const L2=new Uint8Array(N);for(let i=0;i<N;i++)L2[i]=remap.get(lab[i])||0;
  for(let pass=0;pass<7;pass++)for(let i=0;i<N;i++){if(L2[i])continue;const x=i%W;const n=(x>0&&L2[i-1])||(x<W-1&&L2[i+1])||(i>=W&&L2[i-W])||(i<N-W&&L2[i+W]);if(n)L2[i]=n}
  // B: the object alone, at full detail. The piece mask above is deliberately generous (it
  // takes in the floor, reflections and shadows the furniture brings), which is right for the
  // reveal of the real piece but turns a clay model into a slab. Same colour test with almost
  // no blur, gaps closed and enclosed holes filled, so the clay follows the real outline.
  const fch=(s,k)=>{const o=new Float32Array(N);for(let i=0;i<N;i++)o[i]=s[i*4+k];return boxBlur(o,W,H,1)};
  const fr=fch(a,0),fg=fch(a,1),fb=fch(a,2),gr=fch(b,0),gg=fch(b,1),gb=fch(b,2);
  let ob=new Float32Array(N);
  for(let i=0;i<N;i++){if(!L2[i])continue;const la=.3*fr[i]+.59*fg[i]+.11*fb[i],lb=.3*gr[i]+.59*gg[i]+.11*gb[i];
    const dc=Math.hypot((fr[i]-la)-(gr[i]-lb),(fb[i]-la)-(gb[i]-lb));ob[i]=dc+T.lumaW*Math.abs(la-lb)>T.thresh*1.15?1:0}
  {const r=Math.round(W/320);ob=boxBlur(ob,W,H,r).map(x=>x>.02?1:0);ob=boxBlur(ob,W,H,r).map(x=>x>.98?1:0);
    const out=new Uint8Array(N),q=[];const push=i=>{if(!ob[i]&&!out[i]){out[i]=1;q.push(i)}};
    for(let x=0;x<W;x++){push(x);push((H-1)*W+x)}for(let y=0;y<H;y++){push(y*W);push(y*W+W-1)}
    while(q.length){const p=q.pop(),x=p%W;if(x>0)push(p-1);if(x<W-1)push(p+1);if(p>=W)push(p-W);if(p<N-W)push(p+W)}
    for(let i=0;i<N;i++)if(!ob[i]&&!out[i]&&L2[i])ob[i]=1;
    ob=boxBlur(ob,W,H,1)}
  const mk=new OffscreenCanvas(W,H),mg=mk.getContext('2d'),md=mg.createImageData(W,H);
  for(let i=0;i<N;i++){const k=i*4;md.data[k]=L2[i];md.data[k+1]=Math.round(soft[i]*255);md.data[k+2]=L2[i]?Math.round(Math.min(ob[i],soft[i])*255):0;md.data[k+3]=255}
  mg.putImageData(md,0,0);
  const pad=Math.round(W/128);
  const pieces=keep.map(c=>{const x=Math.max(0,c.x-pad),y=Math.max(0,c.y-pad);return {x,y,w:Math.min(W,c.x+c.w+pad)-x,h:Math.min(H,c.y+c.h+pad)-y}});
  const webp=c=>c.convertToBlob({type:'image/webp',quality:.86});
  await save(film,'plan.webp',await webp(plan));await save(film,'room.webp',await webp(room));await save(film,'full.webp',await webp(full));
  await save(film,'mask.png',await mk.convertToBlob({type:'image/png'}));
  const meta={w:W,h:H,full:T.full,pieces};
  await save(film,'meta.json',new Blob([JSON.stringify(meta)]));
  return {pieces:pieces.length,dropped:comps2.length-keep.length};
};
</script>`;

// ---------- static server + sink ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/build') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
  if (req.method === 'PUT' && url.pathname.startsWith('/out/')) {
    const [, , film, name] = url.pathname.split('/');
    const dir = path.join(root, film, 'b');mkdirSync(dir, { recursive: true });
    const chunks = [];for await (const c of req) chunks.push(c);
    writeFileSync(path.join(dir, name), Buffer.concat(chunks));res.writeHead(200);return res.end();
  }
  const p = path.join(root, decodeURIComponent(url.pathname));
  if (!p.startsWith(root) || !existsSync(p)) { res.writeHead(404); return res.end(); }
  // Chrome can only seek a video served with byte ranges
  const buf = readFileSync(p), type = p.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (!range) { res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': buf.length });return res.end(buf); }
  const start = range[1] ? +range[1] : buf.length - +range[2], end = range[1] && range[2] ? +range[2] : buf.length - 1;
  res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${buf.length}`, 'content-length': end - start + 1 });
  res.end(buf.subarray(start, end + 1));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const profile = mkdtempSync(path.join(os.tmpdir(), 'film-layers-'));
const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--autoplay-policy=no-user-gesture-required', '--mute-audio', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';proc.stderr.on('data', (c) => { buf += c;const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);if (m) resolve(m[1]); });
  proc.on('exit', () => reject(new Error('Chrome exited early')));
});
const ws = new WebSocket(wsUrl);await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;const waiting = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data);if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m);waiting.delete(m.id); } });
const send = (method, params = {}, sessionId) => new Promise((r) => { const id = ++seq;waiting.set(id, r);ws.send(JSON.stringify({ id, method, params, sessionId })); });

try {
  const { result: { targetId } } = await send('Target.createTarget', { url: `http://127.0.0.1:${port}/build` });
  const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  for (let i = 0; i < 50; i++) { const r = await send('Runtime.evaluate', { expression: 'typeof window.build', returnByValue: true }, sessionId);if (r.result?.result?.value === 'function') break;await sleep(100); }
  for (const fk of films) {
    const TL = timeline(fk);
    // the room is complete but empty just before the furniture arrives; it is furnished and still once the first hotspots show
    const T = { plan: Math.min(1, TL.ch[1] * 0.4), room: TL.ch[3] - 0.25, full: TL.hot[0][0] + 0.4, thresh: 28, lumaW: 0.35, minArea: 0.002, minCore: 0.0006, split: 9, bigGroup: 0.05, colourW: 1.2, close: 110 };
    const r = await send('Runtime.evaluate', { expression: `build(${JSON.stringify(fk)},${JSON.stringify(T)})`, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(`${fk}: ${r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text}`);
    const v = r.result.result.value;
    console.log(`${fk}: ${v.pieces} pieces (${v.dropped} specks dropped)`);
  }
} finally {
  ws.close();proc.kill();server.close();
  // Chrome can still hold the profile for a moment after exit; a leftover temp folder is harmless
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}
