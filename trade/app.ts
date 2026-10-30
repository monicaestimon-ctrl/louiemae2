/* eslint-disable */
// @ts-nocheck
import React, { useState, useEffect, useRef, useMemo, startTransition } from 'react';
import htm from 'htm';
import type { HolmProduct } from './catalog';
import { useQuery, useMutation, useAction } from 'convex/react';
import { deliveryCents, DELIVERY_TIERS } from '../lib/holmDelivery';
import { useAuthActions } from '@convex-dev/auth/react';
import { api } from '../convex/_generated/api';
import { phoneCut } from './phoneCut.mjs';
export const html = htm.bind(React.createElement);

/* ================= data ================= */
const MAT = {leather:'Leather',velvet:'Velvet',boucle:'Bouclé',rattan:'Rattan',brass:'Brass'};
const TYPE = {sofa:'Sofas',sectional:'Sectionals',ottoman:'Ottomans',bench:'Benches',lighting:'Lighting'};
// The catalog comes from the live House listings (see catalog.ts). Curated pieces keep
// their numeric ids so hero films, scenes and cutouts stay attached to the right product.
let PRODUCTS: HolmProduct[] = [];
const BY_ID = new Map<number, HolmProduct>();
export function setProducts(list: HolmProduct[]) { PRODUCTS = list; BY_ID.clear(); list.forEach(p => BY_ID.set(p.id, p)); }
const byId = (id: number): HolmProduct => BY_ID.get(id) || PRODUCTS[0];
const has = (id: number) => BY_ID.has(id);
const TRADE = 0.75, COMMISSION = 0.12; // illustrative only (trade section demo); real prices come from the server
const tp = (p: HolmProduct) => p.trade ?? p.price;
const pr = (p: HolmProduct, mode: string) => (mode === 'trade' ? tp(p) : p.price);
const cut = (id: number) => (id < 100 && has(id) ? `c/${id}.webp` : byId(id).img);
const pinItUrl=(media,desc,link='https://www.louiemae.com/retail-furniture')=>`https://www.pinterest.com/pin/create/button/?url=${encodeURIComponent(link)}&media=${encodeURIComponent(media)}&description=${encodeURIComponent(desc)}`;
const PIN_BOARDS=[];
// three.js loads on demand, the first time a 3D view mounts, so other pages never pay for it.
let threeP=null;
const loadThree=()=>window.THREE?Promise.resolve(window.THREE):(threeP||=import('three').then(m=>(window.THREE=m),e=>{threeP=null;throw e}));
// Light values below were tuned in three's legacy units; r155+ lights are physical, so they scale by pi.
const LX=Math.PI;
function useThree(){const [T,setT]=useState(()=>window.THREE||null);const [failed,setFailed]=useState(false);
  useEffect(()=>{if(T)return;let live=true;loadThree().then(m=>live&&setT(m),()=>live&&setFailed(true));return()=>{live=false}},[]);return [T,failed]}
const INSPO_SEED=[];

const SPACES = {
  cafe:{label:'Café',head:['For cafés that keep',' the block ','awake.'],em:1,lede:'Banquettes, benches and warm leather that hold up to a full Saturday and still look good at closing.',picks:[2,13,12,9],bg:'#EADCC6',fg:'#2B211A',accent:'#A65F2C',line:'rgba(43,33,26,.22)',mats:['leather','rattan']},
  coffee:{label:'Coffee bar',head:['Counter seats, slow mornings, ','a line out the door.',''],em:1,lede:'Compact ottomans and strap benches for tight floor plans, with rattan light hung over the bar.',picks:[21,15,8,24],bg:'#E3D3BC',fg:'#2B211A',accent:'#8A5530',line:'rgba(43,33,26,.22)',mats:['leather','rattan']},
  restaurant:{label:'Restaurant',head:['Dining rooms people ','book twice.',''],em:1,lede:'Olive velvet, walnut and pendant light for rooms built around a long dinner.',picks:[4,12,20,23],bg:'#DCD9C3',fg:'#25221A',accent:'#5F5C3C',line:'rgba(37,34,26,.22)',mats:['velvet','leather']},
  bar:{label:'Bar & lounge',head:['After hours, in ','cognac and brass.',''],em:1,lede:'Low sectionals and tufted ottomans that turn a back room into the reason people stay for one more.',picks:[5,17,11,16],bg:'#211812',fg:'#F3E8D8',accent:'#D9A66C',line:'rgba(243,232,216,.24)',mats:['velvet','leather','brass']},
  work:{label:'Workspace',head:['Lounges that make the office ','worth the commute.',''],em:1,lede:'Bouclé corners and benches for lobbies, lounges and the meeting nobody books a room for.',picks:[7,18,19,3],bg:'#ECE7DE',fg:'#2B2620',accent:'#7D6B52',line:'rgba(43,38,32,.2)',mats:['boucle','leather']},
  staging:{label:'Model home',head:['Staging that sells ','the square footage.',''],em:1,lede:'For agents, builders and developers: ivory bouclé, brass light and pieces that photograph well in daylight.',picks:[7,10,22,11],bg:'#EFE6D6',fg:'#2B211A',accent:'#A27C45',line:'rgba(43,33,26,.2)',mats:['boucle','brass']},
};
const SPACE_KEYS = Object.keys(SPACES);

const COMMUNITY = [];
const TRENDS = [
  {id:'t1',name:'Cognac channels',up:'',img:2,ids:[2,5,6,17,9,21],copy:'Channel tufting in cognac leather and velvet is showing up across café banquettes and hotel lounges. Designers are pairing it with rattan light and limewash walls.'},
  {id:'t2',name:'Bouclé in the lobby',up:'',img:7,ids:[7,10,18,19,22],copy:'Ivory and grey bouclé moved from living rooms into lobbies and model homes. It reads soft in photos and warm in daylight.'},
  {id:'t3',name:'Rattan over the bar',up:'',img:12,ids:[12,8,21,15,24],copy:'Woven pendants hung low over counters and bar tops. Coffee shops are using them to make a narrow room feel tall.'},
];
const BOARD_SEED = [{id:'b1',title:'Saved pieces',secret:true,collab:0,sections:[],pins:[],t:1}];
const TRAY_SEED = {active:'p1',taxExempt:false,projects:[{id:'p1',name:'My first project',target:20,zones:['Main room'],items:[]}]};

/* ================= utils ================= */
// The header and hero read their ink from these root variables. Changing anything on the root
// restyles the whole page, so write only when the value really changes.
const setHeroInk=(fg,inv)=>{const r=document.documentElement.style;if(r.getPropertyValue('--hero-fg')!==fg)r.setProperty('--hero-fg',fg);if(r.getPropertyValue('--hero-inv')!==inv)r.setProperty('--hero-inv',inv)};
const fmt = (n,dec=false)=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:dec?2:0,maximumFractionDigits:dec?2:0});
const load=(k,d)=>{try{const v=localStorage.getItem('hol:'+k);return v?JSON.parse(v):d}catch(e){return d}};
const store=(k,v)=>{try{localStorage.setItem('hol:'+k,JSON.stringify(v))}catch(e){}};
const hex2rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const cdist=(a,b)=>{const[x,y,z]=hex2rgb(a),[p,q,r]=hex2rgb(b);return Math.hypot(x-p,y-q,z-r)};
const rgb2hex=(r,g,b)=>'#'+[r,g,b].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
// The screen height trade/index.html measured once (see --app-h), so scroll effects don't jump
// when a phone's toolbar slides away mid-scroll.
const appH=()=>parseFloat(document.documentElement.style.getPropertyValue('--app-h'))||innerHeight;
const uid=()=>Math.random().toString(36).slice(2,9);
const palOf=img=>{const c=document.createElement('canvas');c.width=c.height=48;const g=c.getContext('2d');g.drawImage(img,0,0,48,48);const d=g.getImageData(0,0,48,48).data;const bk={};for(let i=0;i<d.length;i+=4){const k=[d[i]>>5,d[i+1]>>5,d[i+2]>>5].join();const B=(bk[k]=bk[k]||{n:0,r:0,g:0,b:0});B.n++;B.r+=d[i];B.g+=d[i+1];B.b+=d[i+2]}return Object.values(bk).sort((a,b)=>b.n-a.n).slice(0,5).map(B=>rgb2hex(B.r/B.n,B.g/B.n,B.b/B.n))};
const fileToInspo=f=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>{const img=new Image();img.onload=()=>{const s=Math.min(1,900/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);c.getContext('2d').drawImage(img,0,0,c.width,c.height);res({id:uid(),src:c.toDataURL('image/jpeg',.82),title:(f.name||'Pasted image').replace(/\.[^.]+$/,'').replace(/[-_]+/g,' ').slice(0,40),source:'upload',pal:palOf(img),ar:img.width/img.height,t:Date.now()})};img.onerror=rej;img.src=r.result};r.onerror=rej;r.readAsDataURL(f)});
const copyText=async(t,toast)=>{try{await navigator.clipboard.writeText(t);toast('Link copied')}catch(e){toast('Copy blocked here. Select the link and copy it.')}};
const COLOR_WORDS={cognac:'#A0612F',tan:'#B07A4A',brown:'#6B4A33',olive:'#5E6338',green:'#5E6338',ivory:'#E7DFD0',cream:'#E7DFD0',white:'#E7DFD0',grey:'#CFCBC4',gray:'#CFCBC4',black:'#2A2522',brass:'#B58D52',gold:'#B58D52',natural:'#C9A46C',warm:'#A0612F',light:'#E7DFD0',dark:'#2A2522'};
function matchPrompt(q){
  const w=q.toLowerCase();
  let scored=PRODUCTS.map(p=>{let s=0;
    if(w.includes(p.mat)||(p.mat==='boucle'&&w.includes('bouc')))s+=5;
    if(w.includes(p.type)||w.includes(p.type.replace(/s$/,'')))s+=3;
    if(w.includes('light')&&p.type==='lighting')s+=2;
    if(w.includes('seat')&&p.seats>0)s+=1;
    Object.entries(COLOR_WORDS).forEach(([k,c])=>{if(w.includes(k)&&cdist(c,p.tone)<60)s+=3});
    SPACE_KEYS.forEach(k=>{const sp=SPACES[k];if(w.includes(k)||w.includes(sp.label.toLowerCase().split(' ')[0])){if(sp.picks.includes(p.id))s+=4;if(sp.mats.includes(p.mat))s+=1}});
    if(w.includes(p.name.toLowerCase()))s+=8;
    return {p,s}});
  const top=Math.max(0,...scored.map(x=>x.s));
  scored=scored.filter(x=>x.s>0&&x.s>=top*.5).sort((a,b)=>b.s-a.s||a.p.id-b.p.id);
  return scored.map(x=>x.p);
}

/* ================= icons ================= */
const ICONS={
 play:'<path d="M8.5 5.5v13l10-6.5z"/>',
 clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
 calendar:'<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
 download:'<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
 search:'<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
 mic:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
 cam:'<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 minus:'<path d="M5 12h14"/>',
 heart:'<path d="M12 20s-7-4.3-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.7-7 10-7 10z"/>',
 share:'<path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6"/>',
 dots:'<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
 tray:'<path d="M3 13h5l1.5 2.5h5L16 13h5"/><path d="M5.5 6h13L21 13v6H3v-6z"/>',
 x:'<path d="M6 6l12 12M18 6 6 18"/>',
 arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
 back:'<path d="M19 12H5M11 6l-6 6 6 6"/>',
 down:'<path d="m6 9 6 6 6-6"/>',
 up:'<path d="m6 15 6-6 6 6"/>',
 layers:'<path d="m12 4 9 5-9 5-9-5z"/><path d="m3 14 9 5 9-5"/>',
 text:'<path d="M5 6h14M12 6v13"/>',
 img:'<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
 copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
 trash:'<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
 lock:'<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
 unlock:'<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
 eye:'<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
 eyeoff:'<path d="M3 3l18 18M10.5 6c.5-.1 1-.1 1.5-.1 6 0 9.5 6.1 9.5 6.1a17 17 0 0 1-3 3.6M6.4 7.4A16 16 0 0 0 2.5 12s3.5 6.5 9.5 6.5c1.6 0 3-.4 4.3-1"/>',
 undo:'<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
 redo:'<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
 grid:'<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
 rows:'<rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/>',
 menu:'<path d="M4 9h16M4 15h10"/>',
 home:'<path d="M4 11 12 4l8 7v9h-5v-6h-6v6H4z"/>',
 compass:'<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
 brush:'<path d="M14 4l6 6-8.5 8.5a3 3 0 0 1-4.2 0l-1.8-1.8a3 3 0 0 1 0-4.2z"/><path d="M4 20c1.5 0 3-1 3-2.5"/>',
 board:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 4v16M4 12h8"/>',
 link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
 check:'<path d="m5 12.5 4.5 4.5L19 7"/>',
 upload:'<path d="M12 16V4M7 9l5-5 5 5M4 16v4h16v-4"/>',
 cube:'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
 frame:'<rect x="4" y="4" width="16" height="16" rx="2"/>',
 chart:'<path d="M4 20V4M4 20h16"/><path d="m7 15 4-4 3 3 5-6"/>',
 user:'<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
 pin:'<path d="M12 21s-6-6.2-6-11a6 6 0 0 1 12 0c0 4.8-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
 sliders:'<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
 wand:'<path d="m4 20 11-11M14 4v2M19 9h2M17.5 5.5 19 4M18 14l1.5 1.5"/>',
 seat:'<path d="M6 11V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5M4 11h16v5H4zM6 16v4M18 16v4"/>',
 send:'<path d="M4 12 20 4l-6 16-3-7z"/>',
 pint:'<circle cx="12" cy="12" r="9"/><path d="M10.6 20.2 12.4 12.6"/><path d="M11.7 15.3c.5.6 1.2.9 2 .9 2 0 3.3-1.9 3.3-4.3 0-2.4-1.9-4.1-4.6-4.1-3 0-4.9 2.1-4.9 4.4 0 1.1.4 2 1.1 2.4"/>',
};
const I=(n,extra={})=>html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" ...${extra} dangerouslySetInnerHTML=${{__html:ICONS[n]}}></svg>`;

/* ================= shared bits ================= */
function Price({p,mode,qty=1,big}){
  const r=p.price*qty, t=tp(p)*qty;
  if(mode==='trade') return html`<span className="num">${fmt(t,!big&&qty===1)}${big?null:html` <s className="mute" style=${{fontSize:'11px'}}>${fmt(r)}</s>`}</span>`;
  return html`<span className="num">${fmt(r,!big&&qty===1)}</span>`;
}
function Toast({t,onClose}){
  useEffect(()=>{if(!t)return;const id=setTimeout(onClose,3200);return()=>clearTimeout(id)},[t]);
  if(!t)return null;
  return html`<div className="toast" role="status"><span>${t.msg}</span>${t.action&&html`<button onClick=${()=>{t.action.fn();onClose()}}>${t.action.label}</button>`}</div>`;
}
function useOutside(ref,fn){useEffect(()=>{const h=e=>{if(ref.current&&!ref.current.contains(e.target))fn()};document.addEventListener('pointerdown',h);return()=>document.removeEventListener('pointerdown',h)},[fn])}

function SaveMenu({ctx,pid,onDone,align='right'}){
  const ref=useRef();const [q,setQ]=useState('');const [making,setMaking]=useState(false);const [name,setName]=useState('');
  useOutside(ref,onDone);
  const list=ctx.boards.filter(b=>b.title.toLowerCase().includes(q.toLowerCase()));
  return html`<div className="pop boardpick" ref=${ref} style=${align==='left'?{left:0,right:'auto',top:52}:{}} onClick=${e=>e.stopPropagation()}>
    ${making?html`<form onSubmit=${e=>{e.preventDefault();if(!name.trim())return;const id=ctx.createBoard(name.trim(),pid);onDone();}} style=${{display:'grid',gap:10,padding:6}}>
        <label className="lbl" htmlFor="nb-name">Board name</label>
        <input id="nb-name" className="field" autoFocus value=${name} onInput=${e=>setName(e.target.value)} placeholder="e.g. Fernwood Café, patio"/>
        <div className="row"><button type="button" className="btn btn-line btn-sm" onClick=${()=>setMaking(false)}>Back</button><button className="btn btn-ink btn-sm">Create and save</button></div>
      </form>`:html`
      <div style=${{padding:'4px 6px 8px'}}><input className="field" style=${{height:38}} placeholder="Search your boards" value=${q} onInput=${e=>setQ(e.target.value)} aria-label="Search your boards"/></div>
      <div className="st-h" style=${{padding:'2px 8px 6px'}}>Save to board</div>
      ${list.map(b=>html`<button key=${b.id} className="bp" onClick=${()=>{ctx.saveTo(pid,b.id);onDone()}}>
        <span className="th" style=${{backgroundImage:`url(${byId(b.pins[0]?.pid||1).img})`}}></span>
        <span><b style=${{fontWeight:500,fontSize:14}}>${b.title}</b><br/><small className="mute">${b.pins.length} pins${b.secret?' · Secret':''}</small></span>
        <span className="go btn btn-cog btn-sm">Save</span></button>`)}
      <button className="bp" onClick=${()=>setMaking(true)}><span className="th" style=${{display:'grid',placeItems:'center',background:'var(--plaster)'}}>${I('plus',{width:18})}</span><b style=${{fontWeight:500}}>Create board</b></button>`}
  </div>`;
}

function PinCard({p,ctx}){
  const [menu,setMenu]=useState(false);
  const saved=ctx.boards.some(b=>b.pins.some(x=>x.pid===p.id));
  const lastBoard=ctx.boards[0];
  return html`<div className="pin">
    <div className="pin-img" onClick=${()=>ctx.openPin(p.id)}>
      <img src=${p.img} alt=${p.name+' '+p.line} loading="lazy" style=${{aspectRatio:p.ar}}/>
      ${p.oos&&html`<span className="oos">Restock on request</span>`}
      <div className="pin-ov">
        <div className="r1" onClick=${e=>e.stopPropagation()}>
          <button className="pin-board" onClick=${()=>setMenu(!menu)} aria-label="Choose board"><span>${lastBoard?.title||'Boards'}</span>${I('down',{width:14})}</button>
          <button className=${'pin-save'+(saved?' saved':'')} onClick=${()=>saved?setMenu(true):ctx.saveTo(p.id,lastBoard.id)}>${saved?'Saved':'Save'}</button>
        </div>
        <div className="r2" onClick=${e=>e.stopPropagation()}>
          <span className="pin-board" style=${{fontFamily:'var(--mono)',fontSize:11.5}}>${ctx.mode==='trade'?fmt(tp(p)):fmt(p.price)}</span>
          <span className="row" style=${{gap:6}}>
            <a className="pin-act" title="Save to Pinterest" aria-label="Save to Pinterest" href=${pinItUrl(p.img,p.name+' '+p.line+' · Louie Mae')} target="_blank" rel="noopener">${I('pint')}</a>
            <button className="pin-act" title="Place in Studio" aria-label="Place in Studio" onClick=${()=>ctx.toStudio([p.id])}>${I('brush')}</button>
            <button className="pin-act" title="Add to project tray" aria-label="Add to project tray" onClick=${e=>ctx.addToTray(p.id,1,e.currentTarget.closest('.pin').querySelector('img'))}>${I('plus')}</button>
          </span>
        </div>
      </div>
    </div>
    ${menu&&html`<${SaveMenu} ctx=${ctx} pid=${p.id} align="left" onDone=${()=>setMenu(false)}/>`}
    <div className="pin-meta"><b>${p.name} <span className="mute" style=${{fontWeight:400}}>${p.line}</span></b></div>
  </div>`;
}
function BoardPin({b,ctx}){
  const imgs=b.items.slice(0,3).map(id=>byId(id).img);
  return html`<div className="pin bpin">
    <div className="mosaic" onClick=${()=>ctx.toStudio(b.items,b.title)} title="Remix in Studio">${imgs.map(s=>html`<div key=${s} style=${{backgroundImage:`url(${s})`}}></div>`)}</div>
    <h3>${b.title}</h3>
    <div className="who"><span className="role">${b.role}</span><span>${b.by}</span><span>· ${b.saves} saves</span></div>
    <div className="row" style=${{padding:'8px 4px 0'}}><button className="btn btn-line btn-sm" onClick=${()=>ctx.toStudio(b.items,b.title)}>${I('brush',{width:15})} Remix</button><button className="btn btn-line btn-sm" onClick=${()=>{b.items.forEach(id=>ctx.addToTray(id,1,null,true));ctx.toast(b.items.length+' pieces added to '+ctx.activeProject.name,{label:'Open tray',fn:()=>ctx.setTray(true)})}}>Add all to tray</button></div>
  </div>`;
}
function Wall({items,ctx,density='normal',mixBoards}){
  const out=[];items.forEach((p,i)=>{out.push(html`<${PinCard} key=${'p'+p.id} p=${p} ctx=${ctx}/>`);if(mixBoards?.length&&i%5===2){const b=mixBoards[Math.floor(i/5)%mixBoards.length];out.push(html`<${BoardPin} key=${'b'+b.id+i} b=${b} ctx=${ctx}/>`)}});
  return html`<div className=${'wall '+(density==='compact'?'compact':density==='wide'?'wide':'')}>${out}</div>`;
}

/* ================= header / menu / tabbar ================= */
function Header({ctx}){
  const [over,setOver]=useState(false);
  useEffect(()=>{const f=()=>{const h=document.querySelector('.rh');setOver(ctx.route==='home'&&!!h&&scrollY<h.offsetHeight-appH()*.9)};f();addEventListener('scroll',f,{passive:true});const t=setTimeout(f,60);return()=>{removeEventListener('scroll',f);clearTimeout(t)}},[ctx.route]);
  const [dial,setDial]=useState(false);const dref=useRef();useOutside(dref,()=>setDial(false));
  const [q,setQ]=useState('');const fileRef=useRef();
  const sp=SPACES[ctx.space];
  return html`<header className=${'top'+(over?' over':'')}><div className="top-in wrap">
    <button className="logo" onClick=${()=>ctx.go('home')} aria-label="House of Louie Mae home"><b>House of Louie Mae</b><span>Trade</span></button>
    <form className="search" role="search" onSubmit=${e=>{e.preventDefault();ctx.setQuery(q);ctx.setImgQ(null);ctx.go('discover')}}>
      ${I('search')}
      <input aria-label="Search pieces, materials, spaces" placeholder="Search cognac leather, café benches, bouclé…" value=${q} onInput=${e=>setQ(e.target.value)}/>
      
      <button type="button" className="ib" title="Search with a photo" aria-label="Search with a photo" onClick=${()=>fileRef.current.click()}>${I('cam')}</button>
      <input ref=${fileRef} type="file" accept="image/*" hidden onChange=${e=>{const f=e.target.files[0];if(f){ctx.imageSearch(f)}e.target.value=''}}/>
    </form>
    <div className="dial hide-sm" ref=${dref}>
      <button className="dial-btn" onClick=${()=>setDial(!dial)} aria-expanded=${dial}><i style=${{background:sp.accent}}></i><span className="mute">Furnishing</span> ${sp.label} ${I('down',{width:14})}</button>
      ${dial&&html`<div className="pop">${SPACE_KEYS.map(k=>html`<button key=${k} className=${'pop-item'+(k===ctx.space?' on':'')} onClick=${()=>{ctx.setSpace(k);setDial(false);ctx.go('home')}}>
        <span className="dot" style=${{width:22,height:22,background:SPACES[k].bg,boxShadow:`inset 0 0 0 5px ${SPACES[k].accent}`}}></span>
        <span><b style=${{fontWeight:500}}>${SPACES[k].label}</b><small>${SPACES[k].lede.split('.')[0]}</small></span></button>`)}</div>`}
    </div>
    <nav className="seg site-switch hide-sm" aria-label="Shop as">
      <a href="https://www.louiemae.com" title="Louie Mae, for your home">Retail</a>
      <a className="on" aria-current="page" href="#" onClick=${e=>{e.preventDefault();ctx.go('home')}} title="House of Louie Mae, for business">Trade</a>
    </nav>
    <button className="ib hide-sm" title="Studio" aria-label="Studio" onClick=${()=>ctx.go('studio')}>${I('brush')}</button>
    <button className="ib tray-btn" id="trayBtn" title="Project tray" aria-label="Open project tray" onClick=${()=>ctx.setTray(true)}>${I('tray')}${ctx.trayCount>0&&html`<span className="badge">${ctx.trayCount}</span>`}</button>
    ${ctx.me.signedIn?html`<button className="hide-sm" onClick=${()=>ctx.go('profile')} aria-label="Your profile"><span className="avatar">${(ctx.me.businessName||ctx.me.displayName||'?')[0].toUpperCase()}</span></button>`:html`<button className="btn btn-line btn-sm hide-sm" onClick=${()=>ctx.go('welcome')}>Sign in</button>`}
    <button className="ib" title="Menu" aria-label="Open menu" onClick=${()=>ctx.setMenu(true)}>${I('menu')}</button>
  </div></header>`;
}
const MENU = [
  ['home','The Floor','Start here',1],['discover','Discover','Search & trends',2],['studio','Studio','Collage & room',13],['room','Space Planner','Plan · model · render',7],
  ['boards','Boards','Your saved ideas',12],['inspo','My Inspo','Your uploads',4],['hub','Your quotes','Quotes, client links, trade pass',17],['trade','Trade Account','Apply & verify',3],['sourcing','Sourcing','Request any piece',9],['quiz','Style Quiz','Find your blend',4],
];
function TabBar({ctx}){
  const t=[['home','Home','home'],['discover','Discover','compass'],['studio','Studio','brush'],['boards','Boards','board']];
  return html`<nav className="tabbar" aria-label="Primary">${t.map(([r,l,i])=>html`<button key=${r} className=${ctx.route===r?'on':''} onClick=${()=>ctx.go(r)}>${I(i)}${l}</button>`)}
    <button onClick=${()=>ctx.setTray(true)}>${I('tray')}Tray${ctx.trayCount>0&&html`<span className="badge" style=${{right:'22%'}}>${ctx.trayCount}</span>`}</button></nav>`;
}

/* ================= ROOM HERO ================= */
const CUT_AR={1:[1031,308],2:[1084,368],3:[1057,352],4:[1100,379],5:[1100,375],6:[1100,370],7:[1100,552],8:[995,777],9:[941,673],10:[1100,551],11:[383,917],12:[944,889],13:[1100,726],14:[1100,520],15:[1046,641],16:[995,637],17:[1100,478],18:[1100,577],19:[1100,521],20:[1100,504],21:[1100,731],22:[1100,540],23:[956,426],24:[1100,688]};
const GLOW_AT={8:[50,80],11:[82,10],12:[50,92]};
const HORIZON=60;
const MOODS={
  morning:{scrimc:'rgba(250,246,238,.86)',fg:'#2B211A',sub:'rgba(43,33,26,.72)',scrim:'linear-gradient(90deg,rgba(250,246,238,.82),rgba(250,246,238,.42) 34%,rgba(250,246,238,0) 58%)',bright:1,sat:.96,grade:'linear-gradient(115deg,rgba(206,222,236,.32),rgba(255,250,240,0) 62%)',gmode:'soft-light',shaft:'rgba(255,252,244,.62)',side:'r',skew:30,shOp:.2,shLen:.3,glow:0,pf:'saturate(.93)',sky:'linear-gradient(180deg,#D3E0E6,#EEF0EA 60%,#F6EFE2)'},
  golden:{scrimc:'rgba(248,234,214,.86)',fg:'#2B211A',sub:'rgba(43,33,26,.72)',scrim:'linear-gradient(90deg,rgba(248,234,214,.84),rgba(248,234,214,.4) 34%,rgba(248,234,214,0) 58%)',bright:1,sat:1.06,grade:'linear-gradient(100deg,rgba(255,164,78,.46),rgba(150,72,22,.2) 72%)',gmode:'soft-light',shaft:'rgba(255,190,108,.66)',side:'l',skew:-60,shOp:.34,shLen:.42,glow:.2,pf:'saturate(1.04)',sky:'linear-gradient(180deg,#EFAE6C,#F6D7A8 55%,#F3E5CC)'},
  dusk:{scrimc:'rgba(24,22,34,.74)',fg:'#F4EADC',sub:'rgba(244,234,220,.78)',scrim:'linear-gradient(90deg,rgba(24,22,34,.7),rgba(24,22,34,.3) 38%,rgba(24,22,34,0) 60%)',bright:.72,sat:.9,grade:'linear-gradient(180deg,rgba(70,90,150,.42),rgba(40,36,70,.3))',gmode:'soft-light',shaft:'rgba(0,0,0,0)',side:'r',skew:12,shOp:.42,shLen:.2,glow:.85,pf:'brightness(.9) saturate(.95)',sky:'linear-gradient(180deg,#2C3D66,#6F6A8C 62%,#C7957A)'},
  night:{scrimc:'rgba(16,11,8,.8)',fg:'#F4EADC',sub:'rgba(244,234,220,.78)',scrim:'linear-gradient(90deg,rgba(16,11,8,.76),rgba(16,11,8,.32) 40%,rgba(16,11,8,0) 62%)',bright:.6,sat:.86,grade:'radial-gradient(ellipse 58% 52% at 56% 74%,rgba(0,0,0,0),rgba(8,5,3,.5) 100%)',gmode:'normal',shaft:'rgba(0,0,0,0)',side:'r',skew:6,shOp:.52,shLen:.16,glow:1,pf:'brightness(.95) sepia(.07) saturate(.95)',sky:'linear-gradient(180deg,#0F1422,#231E2A)'},
};
const DARK_UI={fg:'#F4EADC',sub:'rgba(244,234,220,.8)',scrimc:'rgba(22,15,10,.74)',scrim:'linear-gradient(90deg,rgba(22,15,10,.72),rgba(22,15,10,.3) 40%,rgba(22,15,10,0) 62%)'};
const moodOf=(room,m)=>room.dark?{...MOODS[m],...DARK_UI}:MOODS[m];
const MOOD_NAME={morning:'Morning',golden:'Golden hour',dusk:'Blue hour',night:'After hours'};
const ROOMS={
  cafe:{arch:'cafe',wall:'#E9DCC8',floor:'herring',scenes:[
    {mood:'morning',title:'Morning service',line:'North light across the arch and the first pour of the day.',items:[{id:2,x:53,b:84,cm:235,rug:1},{id:12,x:53,top:-1,cm:105},{id:15,x:84,b:92,cm:68}]},
    {mood:'golden',title:'Golden hour',line:'Low sun, woven cognac straps, a table for two by the window.',items:[{id:21,x:48,b:85,cm:150,rug:1},{id:8,x:48,top:0,cm:54},{id:14,x:77,b:91,cm:82}]},
    {mood:'night',title:'After close',line:'Chairs up, one pendant on, the last espresso of the night.',items:[{id:13,x:44,b:85,cm:150},{id:9,x:72,b:91,cm:86},{id:12,x:52,top:-1,cm:105}]}]},
  coffee:{arch:'coffee',wall:'#E3D3BC',floor:'terrazzo',scenes:[
    {mood:'morning',title:'Doors open',line:'A tufted bench under the round window, rattan overhead.',items:[{id:24,x:58,b:85,cm:135},{id:8,x:58,top:0,cm:54},{id:15,x:84,b:92,cm:66}]},
    {mood:'golden',title:'The 3pm lull',line:'Round leather seats for long, slow conversations.',items:[{id:14,x:52,b:86,cm:92},{id:15,x:73,b:90,cm:72},{id:12,x:60,top:-1,cm:105}]},
    {mood:'night',title:'Last call',line:'Grinder off, tufted leather, the street gone quiet.',items:[{id:23,x:55,b:86,cm:122},{id:8,x:55,top:0,cm:54}]}]},
  restaurant:{arch:'resto',dark:1,wall:'#ECE4D1',floor:'herringDark',scenes:[
    {mood:'morning',title:'Lunch seating',line:'Olive velvet banquette below a long oil painting.',items:[{id:4,x:54,b:85,cm:240,rug:1},{id:12,x:54,top:-1,cm:105}]},
    {mood:'golden',title:'Before the theatre',line:'Walnut and black leather along the window wall.',items:[{id:20,x:52,b:85,cm:150},{id:16,x:79,b:91,cm:82},{id:11,x:93,b:85,cm:64}]},
    {mood:'night',title:'Second seating',line:'Candlelight on olive velvet. Nobody is in a hurry.',items:[{id:4,x:52,b:85,cm:240,rug:1},{id:16,x:82,b:92,cm:78}]}]},
  bar:{arch:'bar',dark:1,wall:'#3B2A1E',floor:'marble',scenes:[
    {mood:'golden',title:'Early pour',line:'Velvet curves while the brass shelf still catches the sun.',items:[{id:5,x:52,b:85,cm:300,rug:1},{id:11,x:88,b:85,cm:64}]},
    {mood:'dusk',title:'Prime time',line:'A cognac corner built for a crowd of eight.',items:[{id:17,x:56,b:86,cm:270},{id:11,x:91,b:85,cm:64}]},
    {mood:'night',title:'After hours',line:'One lamp on and one more round.',items:[{id:1,x:52,b:85,cm:245,rug:1},{id:16,x:79,b:92,cm:78},{id:11,x:94,b:85,cm:64}]}]},
  work:{arch:'work',wall:'#EEEAE3',floor:'concrete',scenes:[
    {mood:'morning',title:'First in',line:'Steel windows, ivory bouclé, coffee still hot.',items:[{id:7,x:55,b:86,cm:290,rug:1},{id:10,x:86,b:93,cm:88}]},
    {mood:'golden',title:'Between meetings',line:'Two benches turn a corridor into the best room in the building.',items:[{id:18,x:44,b:85,cm:135},{id:19,x:72,b:89,cm:135}]},
    {mood:'dusk',title:'Late close',line:'Tan leather and a reading lamp at blue hour.',items:[{id:3,x:53,b:85,cm:250,rug:1},{id:11,x:86,b:85,cm:64}]}]},
  staging:{arch:'home',wall:'#F1E9DC',floor:'oak',scenes:[
    {mood:'morning',title:'Listing photos',line:'Ivory bouclé in full daylight. The room reads twice its size.',items:[{id:7,x:55,b:86,cm:290,rug:1},{id:11,x:93,b:85,cm:64},{id:10,x:79,b:95,cm:88}]},
    {mood:'golden',title:'Open house',line:'Warm leather that makes buyers stay a little longer.',items:[{id:1,x:54,b:85,cm:245,rug:1},{id:22,x:54,b:94,cm:122}]},
    {mood:'dusk',title:'Twilight shoot',line:'The hour agents book the photographer for.',items:[{id:6,x:54,b:85,cm:300,rug:1},{id:19,x:86,b:92,cm:125}]}]},
};

/* procedural textures, generated once */
const TEX={};
function rnd(s){return()=>{s=(s*16807)%2147483647;return (s-1)/2147483646}}
function texture(kind){
  if(TEX[kind])return TEX[kind];
  const c=document.createElement('canvas');const g=c.getContext('2d');const R=rnd(kind.length*977+13);
  const wood=(base,v)=>{const [r,gg,b]=hex2rgb(base);const k=(R()-.5)*v;return `rgb(${r+k},${gg+k*.85},${b+k*.7})`};
  const grain=(x,y,w,h,a)=>{g.save();g.beginPath();g.rect(x,y,w,h);g.clip();for(let i=0;i<7;i++){g.strokeStyle=`rgba(60,35,15,${a*R()})`;g.lineWidth=.6+R();g.beginPath();const yy=y+R()*h;g.moveTo(x,yy);for(let t=0;t<=w;t+=20)g.lineTo(x+t,yy+Math.sin(t/(30+R()*40)+R()*6)*2.2);g.stroke()}g.restore()};
  if(kind==='lime'){c.width=c.height=640;g.fillStyle='#fff';g.fillRect(0,0,640,640);for(let i=0;i<180;i++){const x=R()*640,y=R()*640,r=40+R()*190;const gr=g.createRadialGradient(x,y,0,x,y,r);const a=.025+R()*.05;gr.addColorStop(0,`rgba(${R()<.5?'110,90,70':'255,255,255'},${a})`);gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(0,0,640,640)}
    const d=g.getImageData(0,0,640,640);for(let i=0;i<d.data.length;i+=4){const n=(R()-.5)*4;d.data[i]+=n;d.data[i+1]+=n;d.data[i+2]+=n}g.putImageData(d,0,0)}
  if(/^oak/.test(kind)){const base={oak:'#CDAA7C',oakDark:'#6E4A2E',oakLight:'#E2C9A1',oakGrey:'#A79F94',oakWhite:'#E9E1D3'}[kind];c.width=1200;c.height=1040;const ph=130;for(let row=0;row<8;row++){const off=(row%2)*(R()*400+200);for(let x=-off;x<1200;x+=600){g.fillStyle=wood(base,12);g.fillRect(x,row*ph,600,ph);grain(x,row*ph,600,ph,.12);g.fillStyle='rgba(40,22,10,.35)';g.fillRect(x,row*ph,1.5,ph)}g.fillStyle='rgba(40,22,10,.38)';g.fillRect(0,row*ph,1200,1.4)}}
  if(kind==='herring'||kind==='herringDark'){const base=kind==='herring'?'#C9A273':'#5F4029';const cw=90,rh=34,cols=12,rows=40;c.width=cw*cols;c.height=rh*(rows/2);for(let col=0;col<cols;col++)for(let r=-4;r<rows;r++){const x0=col*cw,y0=r*rh+(col%2?0:rh/2);const up=col%2;g.beginPath();if(!up){g.moveTo(x0,y0);g.lineTo(x0+cw,y0+cw*.5);g.lineTo(x0+cw,y0+cw*.5+rh);g.lineTo(x0,y0+rh)}else{g.moveTo(x0,y0+cw*.5);g.lineTo(x0+cw,y0);g.lineTo(x0+cw,y0+rh);g.lineTo(x0,y0+cw*.5+rh)}g.closePath();g.fillStyle=wood(base,13);g.fill();g.strokeStyle='rgba(35,20,8,.22)';g.lineWidth=1;g.stroke()}}
  if(kind==='terrazzo'){c.width=c.height=700;g.fillStyle='#E7DCCB';g.fillRect(0,0,700,700);const cols=['#B4573A','#8C8378','#F4EEE4','#3B342E','#C99B57','#A7A49A'];for(let i=0;i<1700;i++){g.fillStyle=cols[Math.floor(R()*cols.length)];g.globalAlpha=.28+R()*.34;const x=R()*700,y=R()*700,s=1.5+R()*(R()<.08?14:6);g.beginPath();for(let k=0;k<5;k++){const a=k/5*6.28+R(),rr=s*(.6+R()*.6);g.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr)}g.fill()}g.globalAlpha=1}
  if(kind==='marble'){c.width=c.height=900;const gr=g.createLinearGradient(0,0,900,900);gr.addColorStop(0,'#24201C');gr.addColorStop(1,'#151210');g.fillStyle=gr;g.fillRect(0,0,900,900);for(let i=0;i<34;i++){g.strokeStyle=`rgba(225,205,180,${.04+R()*.14})`;g.lineWidth=.5+R()*2.4;g.shadowColor='rgba(225,205,180,.3)';g.shadowBlur=6;g.beginPath();let x=R()*900,y=0;g.moveTo(x,y);while(y<900){const nx=x+(R()-.5)*120,ny=y+40+R()*80;g.quadraticCurveTo(x+(R()-.5)*80,(y+ny)/2,nx,ny);x=nx;y=ny}g.stroke()}g.shadowBlur=0;g.strokeStyle='rgba(0,0,0,.4)';g.lineWidth=2;for(let k=0;k<=900;k+=450){g.beginPath();g.moveTo(k,0);g.lineTo(k,900);g.stroke();g.beginPath();g.moveTo(0,k);g.lineTo(900,k);g.stroke()}}
  if(kind==='marbleLight'){c.width=c.height=900;g.fillStyle='#F1EEE9';g.fillRect(0,0,900,900);for(let i=0;i<30;i++){g.strokeStyle=`rgba(120,115,110,${.05+R()*.16})`;g.lineWidth=.5+R()*2;g.beginPath();let x=R()*900,y=0;g.moveTo(x,y);while(y<900){const nx=x+(R()-.5)*120,ny=y+40+R()*80;g.quadraticCurveTo(x+(R()-.5)*80,(y+ny)/2,nx,ny);x=nx;y=ny}g.stroke()}g.strokeStyle='rgba(150,140,130,.45)';g.lineWidth=2;for(let k=0;k<=900;k+=450){g.beginPath();g.moveTo(k,0);g.lineTo(k,900);g.stroke();g.beginPath();g.moveTo(0,k);g.lineTo(900,k);g.stroke()}}
  if(kind==='tile'){c.width=c.height=800;for(let y=0;y<800;y+=400)for(let x=0;x<800;x+=400){g.fillStyle=wood('#E8E4DC',6);g.fillRect(x,y,400,400)}const d=g.getImageData(0,0,800,800);for(let i=0;i<d.data.length;i+=4){const n=(R()-.5)*7;d.data[i]+=n;d.data[i+1]+=n;d.data[i+2]+=n}g.putImageData(d,0,0);g.strokeStyle='rgba(120,112,100,.55)';g.lineWidth=4;for(let k=0;k<=800;k+=400){g.beginPath();g.moveTo(k,0);g.lineTo(k,800);g.stroke();g.beginPath();g.moveTo(0,k);g.lineTo(800,k);g.stroke()}}
  if(kind==='checker'){c.width=c.height=800;for(let y=0;y<4;y++)for(let x=0;x<4;x++){g.fillStyle=(x+y)%2?'#2B2622':'#ECE6DA';g.fillRect(x*200,y*200,200,200)}const d=g.getImageData(0,0,800,800);for(let i=0;i<d.data.length;i+=4){const n=(R()-.5)*8;d.data[i]+=n;d.data[i+1]+=n;d.data[i+2]+=n}g.putImageData(d,0,0)}
  if(kind==='carpet'){c.width=c.height=512;g.fillStyle='#D8D1C4';g.fillRect(0,0,512,512);const d=g.getImageData(0,0,512,512);for(let i=0;i<d.data.length;i+=4){const n=(R()-.5)*26;d.data[i]+=n;d.data[i+1]+=n;d.data[i+2]+=n}g.putImageData(d,0,0)}
  if(kind==='concrete'){c.width=c.height=600;g.fillStyle='#BDB6AC';g.fillRect(0,0,600,600);for(let i=0;i<90;i++){const x=R()*600,y=R()*600,r=30+R()*140;const gr=g.createRadialGradient(x,y,0,x,y,r);gr.addColorStop(0,`rgba(${R()<.5?'90,85,78':'230,226,218'},${.05+R()*.07})`);gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(0,0,600,600)}const d=g.getImageData(0,0,600,600);for(let i=0;i<d.data.length;i+=4){const n=(R()-.5)*16;d.data[i]+=n;d.data[i+1]+=n;d.data[i+2]+=n}g.putImageData(d,0,0);g.strokeStyle='rgba(60,55,50,.25)';g.lineWidth=1.5;g.beginPath();g.moveTo(0,300);g.lineTo(600,300);g.moveTo(300,0);g.lineTo(300,600);g.stroke()}
  if(kind==='grain'){c.width=c.height=180;const d=g.createImageData(180,180);for(let i=0;i<d.data.length;i+=4){const v=R()*255;d.data[i]=d.data[i+1]=d.data[i+2]=v;d.data[i+3]=26}g.putImageData(d,0,0)}
  if(kind==='jute'){c.width=c.height=240;g.fillStyle='#CDBB98';g.fillRect(0,0,240,240);for(let y=0;y<240;y+=6)for(let x=0;x<240;x+=6){g.fillStyle=`rgba(${(x/6+y/6)%2?'120,96,60':'240,226,196'},${.18+R()*.18})`;g.fillRect(x,y,6,3)}}
  const floorSize={oak:'760px',oakDark:'760px',oakLight:'760px',oakGrey:'760px',oakWhite:'760px',tile:'360px',checker:'360px',marbleLight:'900px',carpet:'300px',herring:'230px',herringDark:'230px',terrazzo:'360px',marble:'900px',concrete:'600px'};
  return TEX[kind]={url:c.toDataURL('image/jpeg',.86),size:floorSize[kind]||'auto'};
}

function Arch({type,mood,wall}){
  const M=MOODS[mood];const glow=M.glow;
  const sconce=(x)=>html`<span className="rh-sconce" style=${{left:x+'%'}}><i style=${{opacity:.25+glow*.75}}></i></span>`;
  if(type==='cafe')return html`
    <div className="rh-arch" style=${{left:'30%',width:'46%',top:'7%'}}><span className="rh-arch-in"></span></div>
    <div className="rh-window arch" style=${{left:'64.5%',width:'10.5%',top:'20%',bottom:(100-HORIZON+1)+'%',background:M.sky}}><span className="mull v"></span><span className="mull h" style=${{top:'40%'}}></span></div>
    
    ${sconce(22)}${sconce(84)}`;
  if(type==='coffee')return html`
    <div className="rh-window round" style=${{left:'64%',width:'20%',top:'9%',background:M.sky}}><span className="mull v"></span><span className="mull h" style=${{top:'50%'}}></span></div>
    <div className="rh-shelf long" style=${{left:'14%',width:'40%',top:'24%'}}>${[8,20,31,44,60,74,86].map((x,i)=>html`<i key=${i} style=${{left:x+'%',width:i%3?'14px':'24px',height:i%3?'20px':'14px',borderRadius:i%3?'3px 3px 6px 6px':'6px',background:['#EFE7DA','#A9634A','#3D3530','#D7C9B2'][i%4]}}></i>`)}</div>
    <div className="rh-shelf long" style=${{left:'14%',width:'40%',top:'38%'}}>${[12,27,52,70].map((x,i)=>html`<i key=${i} style=${{left:x+'%',width:'26px',height:'30px',borderRadius:'6px 6px 4px 4px',background:['#7C6247','#C9B79A','#E8DFD2','#5E5348'][i]}}></i>`)}</div>
    <div className="rh-counter" style=${{left:0,width:'13%'}}></div>`;
  if(type==='resto')return html`
    <div className="rh-wainscot" style=${{top:'34%'}}>${[0,1,2,3,4,5].map(i=>html`<span key=${i}></span>`)}</div>
    <div className="rh-art" style=${{left:'34%',width:'40%',top:'7%',height:'21%'}}><span></span></div>
    ${sconce(26)}${sconce(82)}`;
  if(type==='bar')return html`
    <div className="rh-flutes"></div>
    <div className="rh-mirror" style=${{left:'6%',width:'16%',top:'9%'}}></div>
    <div className="rh-backbar" style=${{left:'66%',width:'30%',top:'10%'}}>
      ${[0,1,2].map(r=>html`<div key=${r} className="rh-bshelf" style=${{top:(r*33)+'%'}}><span className="rh-bglow" style=${{opacity:.35+glow*.65}}></span>${[6,15,22,31,42,50,61,70,79,88].map((x,i)=>html`<i key=${i} style=${{left:x+'%',height:(46+((i*7+r*5)%5)*9)+'%',width:(i%3?5:7)+'%',background:['linear-gradient(#6A3B1C,#C27A3A)','linear-gradient(#2F3B2A,#6F8250)','linear-gradient(#8C6A2E,#E1B867)','linear-gradient(#3A1F1B,#8E3F35)'][(i+r)%4]}}></i>`)}</div>`)}
    </div>`;
  if(type==='work')return html`
    <div className="rh-window crittall" style=${{left:'30%',width:'62%',top:'5%',bottom:(100-HORIZON)+'%',background:M.sky}}><span className="rh-grid"></span></div>`;
  if(type==='home')return html`
    <div className="rh-crown"></div>
    <div className="rh-window tall" style=${{left:'8%',width:'16%',top:'6%',bottom:(100-HORIZON)+'%',background:M.sky}}><span className="mull v"></span><span className="rh-sheer"></span></div>
    <div className="rh-window tall" style=${{left:'78%',width:'16%',top:'6%',bottom:(100-HORIZON)+'%',background:M.sky}}><span className="mull v"></span><span className="rh-sheer"></span></div>
    <div className="rh-art" style=${{left:'40%',width:'26%',top:'12%',height:'25%'}}><span style=${{background:'radial-gradient(circle at 40% 45%,#C8B59A,transparent 55%),radial-gradient(circle at 70% 70%,#8E8A78,transparent 45%),#E9E1D2'}}></span></div>`;
  return null;
}

function RoomScene({room,scene,roomCm,onPick,refCb,idx}){
  const M=moodOf(room,scene.mood);const F=texture(room.floor);const L=texture('lime');
  const items=[...scene.items].sort((a,b)=>(a.top!=null?-1:a.b)-(b.top!=null?-1:b.b));
  const depth=b=>(b-HORIZON)/(85-HORIZON);
  const rugItem=scene.items.find(i=>i.rug);
  const vars={'--bright':M.bright,'--sat':M.sat,'--skew':M.skew+'deg','--shop':M.shOp,'--shlen':M.shLen,'--glow':M.glow,'--pf':M.pf};
  const wallBg=room.arch==='bar'?{backgroundColor:room.wall}:{backgroundColor:room.wall,backgroundImage:`url(${L.url})`,backgroundSize:'640px',backgroundBlendMode:'multiply'};
  return html`<div className="rh-scene" ref=${refCb} style=${{...vars,opacity:idx===0?1:0}} data-mood=${scene.mood}>
    <div className="rh-bg">
      <div className="rh-wall" style=${{...wallBg,height:HORIZON+'%'}}><${Arch} type=${room.arch} mood=${scene.mood} wall=${room.wall}/></div>
      <div className="rh-base" style=${{top:`calc(${HORIZON}% - 10px)`,background:room.arch==='bar'?'#241911':'color-mix(in oklab,'+room.wall+' 82%,#000)'}}></div>
      <div className="rh-floor" style=${{top:HORIZON+'%'}}><div className="rh-plane" style=${{backgroundImage:`url(${F.url})`,backgroundSize:F.size}}></div><span className="rh-floorshade"></span></div>
      ${rugItem&&(()=>{const w=rugItem.cm/roomCm*100*1.5;return html`<div className="rh-rug" style=${{left:rugItem.x+'%',width:w+'%',top:(rugItem.b-3.2)+'%',height:(100-rugItem.b+3.2)*.5+'%','--jute':`url(${texture('jute').url})`}}></div>`})()}
      ${scene.items.filter(i=>i.top!=null&&GLOW_AT[i.id]).map((i,k)=>html`<span key=${'pool'+k} className="rh-pool" style=${{left:i.x+'%'}}></span><span key=${'wpool'+k} className="rh-wpool" style=${{left:i.x+'%'}}></span>`)}${scene.items.filter(i=>i.id===11).map((i,k)=>html`<span key=${'lp'+k} className="rh-wpool lamp" style=${{left:(i.x+1.5)+'%'}}></span>`)}<div className="rh-shaft" style=${{background:`linear-gradient(${M.side==='r'?200:160}deg,${M.shaft},transparent 88%)`,clipPath:M.side==='r'?'polygon(80% 12%,92% 12%,74% 100%,38% 100%)':'polygon(4% 8%,18% 8%,66% 100%,22% 100%)'}}></div>
    </div>
    <div className="rh-objs">
      ${items.map((it,i)=>{const p=byId(it.id);const ar=CUT_AR[it.id];const hang=it.top!=null;const w=hang?it.cm/roomCm*100:it.cm/roomCm*100*depth(it.b);const g=GLOW_AT[it.id];
        const pos=hang?{left:it.x+'%',top:it.top+'%',width:w+'%'}:{left:it.x+'%',bottom:(100-it.b)+'%',width:w+'%'};
        return html`<button key=${i} className=${'rh-obj'+(hang?' hang':'')} style=${{...pos,zIndex:hang?50:Math.round(it.b)}} onClick=${e=>{e.stopPropagation();onPick(it,e.currentTarget)}} aria-label=${p.name+' '+p.line}>
          ${!hang&&html`<span className="rh-contact"></span><img className="rh-cast" src=${cut(it.id)} alt="" aria-hidden="true" draggable="false"/>`}
          <img className="rh-cut" src=${cut(it.id)} alt="" draggable="false" style=${{aspectRatio:ar[0]+'/'+ar[1]}}/>
          ${g&&html`<span className="rh-glow" style=${{left:g[0]+'%',top:g[1]+'%'}}></span>`}
        </button>`})}
    </div>
    <div className="rh-grade" style=${{background:M.grade,mixBlendMode:M.gmode}}></div>
    <div className="rh-scrim" style=${{'--scrim':M.scrim,'--scrimc':M.scrimc}}></div>
  </div>`;
}

function RoomHero({ctx}){
  const sp=SPACES[ctx.space];const room=ROOMS[ctx.space];const n=room.scenes.length;
  const secRef=useRef(),stageRef=useRef(),scenes=useRef([]),act=useRef(0);
  const [active,setActive]=useState(0);const [pick,setPick]=useState(null);const [roomCm,setRoomCm]=useState(560);const [scrolled,setScrolled]=useState(false);
  useEffect(()=>{const ro=new ResizeObserver(([e])=>{const {width:w,height:h}=e.contentRect;const a=w/h;setRoomCm(a>1.5?560:a>1.1?470:a>.8?390:265)});ro.observe(stageRef.current);return()=>ro.disconnect()},[]);
  useEffect(()=>{let raf=0;const run=()=>{raf=0;const sec=secRef.current,st=stageRef.current;if(!sec||!st)return;const r=sec.getBoundingClientRect();const total=Math.max(1,sec.offsetHeight-st.offsetHeight);const t=Math.min(1,Math.max(0,-r.top/total));const p=t*(n-1);
      scenes.current.forEach((el,i)=>{if(!el)return;const d=p-i;const o=Math.max(0,Math.min(1,1-Math.abs(d)*1.5));el.style.opacity=o;el.style.transform=`scale(${1+.075*Math.min(1,Math.max(0,(d+1)/2))})`;el.style.visibility=o<.01?'hidden':'visible';el.style.pointerEvents=Math.abs(d)<.5?'auto':'none'});
      const a=Math.round(p);if(a!==act.current){act.current=a;setActive(a);setPick(null)}setScrolled(t>.02)};
    const on=()=>{if(!raf)raf=requestAnimationFrame(run)};run();addEventListener('scroll',on,{passive:true});addEventListener('resize',on);return()=>{removeEventListener('scroll',on);removeEventListener('resize',on);cancelAnimationFrame(raf)}},[ctx.space,n]);
  useEffect(()=>{act.current=0;setActive(0);setPick(null)},[ctx.space]);
  const goScene=i=>{const sec=secRef.current,st=stageRef.current;const top=sec.getBoundingClientRect().top+scrollY;const total=sec.offsetHeight-st.offsetHeight;scrollTo({top:top+total*(i/(n-1))+2,behavior:'smooth'})};
  const onMove=e=>{const st=stageRef.current;if(!st)return;const r=st.getBoundingClientRect();st.style.setProperty('--mx',((e.clientX-r.left)/r.width-.5).toFixed(3));st.style.setProperty('--my',((e.clientY-r.top)/r.height-.5).toFixed(3))};
  const onPick=(it,el)=>{const r=el.getBoundingClientRect(),s=stageRef.current.getBoundingClientRect();const below=it.top!=null;setPick({it,below,x:(r.left+r.width/2-s.left)/s.width*100,y:((below?r.bottom:r.top)-s.top)/s.height*100,img:el.querySelector('.rh-cut')})};
  const sc=room.scenes[active];const M=moodOf(room,sc.mood);const P=pick&&byId(pick.it.id);
  useEffect(()=>setHeroInk(M.fg,M.fg==='#2B211A'?'#FBF8F2':'#1C1510'),[M.fg]);
  const pickSpace=k=>{ctx.setSpace(k);const sec=secRef.current;if(sec&&sec.getBoundingClientRect().top<0)scrollTo({top:sec.getBoundingClientRect().top+scrollY,behavior:'smooth'})};
  return html`<section className="rh" ref=${secRef} style=${{height:`calc(${n} * var(--app-h, 100svh) + 1px)`}}>
    <div className=${'rh-stage'+(pick?' focus':'')} ref=${stageRef} onPointerMove=${onMove} onClick=${()=>setPick(null)} style=${{'--fg':M.fg,'--sub':M.sub,'--inv':M.fg==='#2B211A'?'#FBF8F2':'#1C1510'}}>
      <div className="rh-scenes" key=${ctx.space}>${room.scenes.map((s,i)=>html`<${RoomScene} key=${i} idx=${i} room=${room} scene=${s} roomCm=${roomCm} onPick=${onPick} refCb=${el=>scenes.current[i]=el}/>`)}</div>
      <div className="rh-grainl" style=${{backgroundImage:`url(${texture('grain').url})`}}></div>

      <div className="rh-copy" onClick=${e=>e.stopPropagation()}>
        <span className="rh-eyebrow">House of Louie Mae · Furnishing for trade</span>
        <h1 key=${ctx.space}>${sp.head[0]}<em>${sp.head[1]}</em>${sp.head[2]}</h1>
      </div>

      <nav className="rh-index" aria-label="Choose your space" onClick=${e=>e.stopPropagation()}>
        ${SPACE_KEYS.map(k=>html`<button key=${k} className=${k===ctx.space?'on':''} aria-pressed=${k===ctx.space} onClick=${()=>pickSpace(k)}>${SPACES[k].label}<sup>${ROOMS[k].scenes.length} rooms</sup></button>`)}
      </nav>

      <div className="rh-caption" onClick=${e=>e.stopPropagation()}>
        <div className="rh-steps">${room.scenes.map((s,i)=>html`<button key=${i} className=${i===active?'on':i<active?'done':''} aria-label=${'Go to '+s.title} onClick=${()=>goScene(i)}><i></i></button>`)}<span>${String(active+1).padStart(2,'0')} / ${String(n).padStart(2,'0')} · ${MOOD_NAME[sc.mood]}</span></div>
        <div className="rh-mood" key=${ctx.space+active}><b>${sc.title}</b><p>${sc.line}</p></div>
        <div className="rh-cta">
          <button className="rh-pill solid" onClick=${()=>ctx.toStudio(sc.items.map(i=>i.id),sc.title+', '+sp.label.toLowerCase())}>Build this room ${I('arrow',{width:14})}</button>
          <button className="rh-pill" onClick=${()=>{ctx.setRoomSeed(sc.items.map(i=>i.id));ctx.go('room')}}>Walk it in 3D</button>
        </div>
      </div>

      <div className=${'rh-hint'+(scrolled?' gone':'')}><span>Scroll · tap any piece</span><i></i></div>

      ${P&&html`<div className=${'rh-card'+(pick.below?' below':'')} style=${{left:`clamp(160px, ${pick.x}%, calc(100% - 160px))`,top:pick.below?`min(${pick.y}%, calc(100% - 260px))`:`max(250px, ${pick.y}%)`}} onClick=${e=>e.stopPropagation()} role="dialog" aria-label=${P.name}>
        <button className="rh-x" aria-label="Close" onClick=${()=>setPick(null)}>${I('x',{width:14})}</button>
        <span className="mono">${P.sku} · ${MAT[P.mat]}</span>
        <h3>${P.name}</h3><p>${P.line}</p>
        <div className="rh-price"><b>${ctx.mode==='trade'?fmt(tp(P),true):fmt(P.price,true)}</b>${ctx.mode==='trade'&&html`<s>${fmt(P.price,true)}</s>`}${P.oos&&html`<em>Restock on request</em>`}</div>
        <div className="rh-card-act"><button className="rh-btn solid sm" onClick=${()=>ctx.addToTray(P.id,1,pick.img)}>${I('plus',{width:15})} Add to tray</button><button className="rh-btn sm" onClick=${()=>ctx.openPin(P.id)}>Details</button><button className="rh-btn sm icon" aria-label="Place in Studio" onClick=${()=>ctx.toStudio([P.id])}>${I('brush',{width:15})}</button></div>
      </div>`}
    </div>
  </section>`;
}

/* ================= ROOM STUDY: plan → shell → pieces → finish → light (three.js) ================= */
const STUDY={
  cafe:{W:9,D:6.4,H:3.4,openings:[{t:'arch',x:0,w:2.6,h:2.5,y:.55},{t:'win',x:3.3,w:1.2,h:1.8,y:.9}],props:[{k:'bistro',x:-2.3,z:-.2},{k:'bistro',x:2.4,z:-.5},{k:'shelf',x:-3.1,y:1.9,w:1.6}],
    items:[{id:2,x:0,z:-2.55},{id:12,x:0,z:-1.5,hang:1},{id:15,x:-2.3,z:.5},{id:15,x:2.4,z:.25},{id:21,x:-3.25,z:-2.75}]},
  coffee:{W:8,D:6,H:3.3,openings:[{t:'arch',x:1.8,w:2,h:2.1,y:.85}],props:[{k:'counter',x:-2.4,z:-1.9,w:2.6},{k:'shelf',x:-2.4,y:2,w:2.4},{k:'shelf',x:-2.4,y:2.45,w:2.4}],
    items:[{id:24,x:1.8,z:-2.35},{id:8,x:1.8,z:-1.4,hang:1},{id:15,x:-2.9,z:-.95},{id:15,x:-1.9,z:-.95},{id:14,x:.6,z:.4}]},
  restaurant:{W:9,D:6.4,H:3.5,openings:[{t:'win',x:-3.1,w:1.3,h:2.1,y:.8},{t:'win',x:3.1,w:1.3,h:2.1,y:.8}],props:[{k:'wainscot'},{k:'bistro',x:0,z:-1.35}],
    items:[{id:4,x:0,z:-2.55},{id:12,x:0,z:-1.35,hang:1},{id:20,x:-2.9,z:-.2},{id:16,x:2.7,z:.2}]},
  bar:{W:9,D:6.4,H:3.3,dark:1,openings:[{t:'arch',x:-3,w:1.6,h:2.2,y:.5}],props:[{k:'backbar',x:2.4,w:3.4}],
    items:[{id:5,x:-.5,z:-2.3},{id:11,x:3.6,z:-2.4},{id:16,x:.8,z:-.5},{id:9,x:-2,z:-.4}]},
  work:{W:10,D:7,H:3.6,openings:[-2.7,-.9,.9,2.7].flatMap(x=>[{t:'win',x,w:1.6,h:1.15,y:.7},{t:'win',x,w:1.6,h:1.15,y:2}]),props:[],
    items:[{id:7,x:0,z:-2.75},{id:10,x:1.7,z:-.6},{id:18,x:-3.5,z:-.8},{id:19,x:3.7,z:-1.2}]},
  staging:{W:9,D:6.4,H:3.6,openings:[{t:'win',x:-3.2,w:1.2,h:2.7,y:.35},{t:'win',x:3.2,w:1.2,h:2.7,y:.35}],props:[],
    items:[{id:7,x:0,z:-2.5},{id:11,x:2.6,z:-2.6},{id:10,x:0,z:-.5},{id:22,x:-3.1,z:-1.5}]},
};
const CHAPTERS=[
  ['The plan','Every room starts as a line.','We draw your floor at true scale: walls, openings and a footprint for every piece.'],
  ['The shell','The walls go up.','The plan extrudes into a clay model, with arches and windows cut where the light will come in.'],
  ['The pieces','Your pieces, placed at true scale.','Each Louie piece lands where it will live, sized from its real dimensions and casting real shadows.'],
  ['The finish','Plaster, oak, linen.','Materials wash over the clay: limewash walls, the floor you specify, a jute rug under the banquette.'],
  ['The light','Morning to last call.','Scroll through the day. Sun moves through the windows, then the pendants take over after dark.'],
];
const FLOOR_TILE={herring:1.3,herringDark:1.3,oak:2.6,oakDark:2.6,oakLight:2.6,oakGrey:2.6,oakWhite:2.6,terrazzo:1.8,marble:2.6,marbleLight:2.6,concrete:2.6,tile:1.2,checker:1.2,carpet:1.5};
const clamp01=v=>Math.max(0,Math.min(1,v));const ease=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;const seg=(p,a,b)=>ease(clamp01((p-a)/(b-a)));
const FOOT_D={sofa:.95,sectional:1.7,bench:.45,ottoman:0,lighting:0};

function RoomStudy({ctx}){
  const sp=SPACES[ctx.space];const cfg=STUDY[ctx.space];const room=ROOMS[ctx.space];
  const secRef=useRef(),cvRef=useRef(),stageRef=useRef(),labRef=useRef(),xhRef=useRef(),coordRef=useRef(),tipRef=useRef(),api=useRef({});
  const [chap,setChap]=useState(0);const [tod,setTod]=useState('');const [pick,setPick]=useState(null);const [night,setNight]=useState(false);const [ok,setOk]=useState(true);const [three,threeFailed]=useThree();const [scrolled,setScrolled]=useState(false);
  useEffect(()=>{
    if(threeFailed){setOk(false);return}if(!three)return;
    const T=three;const cv=cvRef.current,stage=stageRef.current;
    const renderer=new T.WebGLRenderer({canvas:cv,antialias:true,alpha:false});
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.75));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
    renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
    const scene=new T.Scene();const cam=new T.PerspectiveCamera(36,1,.05,200);
    const {W,D,H}=cfg;const loader=new T.TextureLoader();
    const tex=(url,rep)=>{const t=loader.load(url);t.colorSpace=T.SRGBColorSpace;if(rep){t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(rep[0],rep[1])}t.anisotropy=8;return t};
    const CLAY=new T.Color('#EEE9E1');
    const wallCol=new T.Color(cfg.dark?'#3B2A1E':room.wall);
    // ---------- ground + grid ----------
    const ground=new T.Mesh(new T.PlaneGeometry(80,80),new T.MeshStandardMaterial({color:'#EFE9DF',roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.002;ground.receiveShadow=true;scene.add(ground);
    const grid=new T.GridHelper(40,80,0x2B211A,0x2B211A);grid.material.transparent=true;grid.material.opacity=.08;grid.position.y=.001;scene.add(grid);
    // ---------- floor (clay + finished) ----------
    const fG=new T.PlaneGeometry(W,D);const floorClay=new T.Mesh(fG,new T.MeshStandardMaterial({color:CLAY,roughness:.95}));floorClay.rotation.x=-Math.PI/2;floorClay.receiveShadow=true;scene.add(floorClay);
    const ft=texture(room.floor),tile=FLOOR_TILE[room.floor]||2;
    const floorFin=new T.Mesh(fG,new T.MeshStandardMaterial({map:tex(ft.url,[W/tile,D/tile]),roughness:room.floor==='marble'?.35:.7,transparent:true,opacity:0,polygonOffset:true,polygonOffsetFactor:-2}));floorFin.rotation.x=-Math.PI/2;floorFin.position.y=.002;floorFin.receiveShadow=true;scene.add(floorFin);
    // ---------- walls with openings ----------
    const shapeWithHoles=(w,h,ops)=>{const s=new T.Shape();s.moveTo(-w/2,0);s.lineTo(w/2,0);s.lineTo(w/2,h);s.lineTo(-w/2,h);s.lineTo(-w/2,0);
      ops.forEach(o=>{const p=new T.Path();const l=o.x-o.w/2,r=o.x+o.w/2;if(o.t==='arch'){const top=o.y+o.h-o.w/2;p.moveTo(l,o.y);p.lineTo(r,o.y);p.lineTo(r,top);p.absarc(o.x,top,o.w/2,0,Math.PI,false);p.lineTo(l,o.y)}else{p.moveTo(l,o.y);p.lineTo(r,o.y);p.lineTo(r,o.y+o.h);p.lineTo(l,o.y+o.h);p.lineTo(l,o.y)}s.holes.push(p)});return s};
    const walls=new T.Group();scene.add(walls);const wallFins=[];
    const limeT=tex(texture('lime').url,[2,1]);limeT.colorSpace=T.NoColorSpace;
    const mkWall=(shape,place)=>{const g=new T.ExtrudeGeometry(shape,{depth:.22,bevelEnabled:false});const clay=new T.Mesh(g,new T.MeshStandardMaterial({color:CLAY,roughness:.95}));clay.castShadow=clay.receiveShadow=true;
      const fin=new T.Mesh(g,new T.MeshStandardMaterial({color:wallCol,bumpMap:cfg.dark?null:limeT,bumpScale:.012,roughness:.92,transparent:true,opacity:0,polygonOffset:true,polygonOffsetFactor:-2}));fin.receiveShadow=true;
      [clay,fin].forEach(m=>{place(m);walls.add(m)});wallFins.push(fin)};
    mkWall(shapeWithHoles(W+.44,H,cfg.openings),m=>{m.position.set(0,0,-D/2-.22)});
    mkWall(shapeWithHoles(D,H,[]),m=>{m.rotation.y=Math.PI/2;m.position.set(-W/2-.22,0,0)});
    mkWall(shapeWithHoles(D,H,[]),m=>{m.rotation.y=-Math.PI/2;m.position.set(W/2+.22,0,0)});
    // mullions in windows
    const mullMat=new T.MeshStandardMaterial({color:'#2E2620',roughness:.6});cfg.openings.forEach(o=>{if(o.t!=='win')return;const v=new T.Mesh(new T.BoxGeometry(.04,o.h,.05),mullMat);v.position.set(o.x,o.y+o.h/2,-D/2-.1);walls.add(v);const hz=new T.Mesh(new T.BoxGeometry(o.w,.04,.05),mullMat);hz.position.set(o.x,o.y+o.h*.62,-D/2-.1);walls.add(hz)});
    // ceiling (only once we're inside)
    const ceil=new T.Mesh(new T.PlaneGeometry(W+.44,D),new T.MeshStandardMaterial({color:'#F3EEE6',roughness:1,transparent:true,opacity:0,side:T.DoubleSide}));ceil.rotation.x=Math.PI/2;ceil.position.y=H;scene.add(ceil);
    // sky behind the back wall
    const sky=new T.Mesh(new T.PlaneGeometry(60,24),new T.MeshBasicMaterial({color:'#CFE0EA'}));sky.position.set(0,6,-D/2-4);scene.add(sky);
    // ---------- props (primitives; color lerps clay → finish) ----------
    const lerpMats=[];const pm=(fin,o={})=>{const m=new T.MeshStandardMaterial({color:CLAY.clone(),roughness:o.r??.7,metalness:o.m??0});lerpMats.push([m,new T.Color(fin),o.em]);return m};
    const propsG=new T.Group();scene.add(propsG);const add=(geo,mat,x,y,z,sh=true)=>{const m=new T.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=sh;m.receiveShadow=true;propsG.add(m);return m};
    const glowMats=[];
    cfg.props.forEach(p=>{
      if(p.k==='bistro'){add(new T.CylinderGeometry(.36,.36,.03,40),pm('#EDE7DD',{r:.35}),p.x,.75,p.z);add(new T.CylinderGeometry(.035,.035,.72,16),pm('#B58D52',{m:.7,r:.35}),p.x,.38,p.z);add(new T.CylinderGeometry(.22,.24,.03,32),pm('#B58D52',{m:.7,r:.35}),p.x,.015,p.z)}
      if(p.k==='shelf'){add(new T.BoxGeometry(p.w,.05,.28),pm('#9C7A55'),p.x,p.y,-D/2+.14);[-.5,-.15,.2,.45].forEach((dx,i)=>add(new T.CylinderGeometry(.06+i%2*.03,.07,.18+i%3*.08,20),pm(['#D9CBB5','#A9634A','#3D3530','#EFE7DA'][i]),p.x+dx*p.w*.8,p.y+.12,-D/2+.14))}
      if(p.k==='counter'){add(new T.BoxGeometry(p.w,1.02,.7),pm('#8E6C4C'),p.x,.51,p.z);add(new T.BoxGeometry(p.w+.06,.05,.76),pm('#ECE6DB',{r:.3}),p.x,1.045,p.z)}
      if(p.k==='wainscot'){add(new T.BoxGeometry(W,1.15,.04),pm('#6C6A4B',{r:.8}),0,.575,-D/2+.02,false);add(new T.BoxGeometry(W,.05,.07),pm('#5A583D'),0,1.17,-D/2+.035,false)}
      if(p.k==='backbar'){for(let r=0;r<3;r++){add(new T.BoxGeometry(p.w,.04,.3),pm('#B58D52',{m:.6,r:.4}),p.x,1.25+r*.55,-D/2+.15);const strip=new T.MeshStandardMaterial({color:'#2a1a10',emissive:new T.Color('#FFB25A'),emissiveIntensity:0});glowMats.push(strip);add(new T.BoxGeometry(p.w,.02,.02),strip,p.x,1.27+r*.55,-D/2+.04,false);for(let b=0;b<9;b++){const bh=.22+((b*7+r*3)%4)*.05;add(new T.CylinderGeometry(.035,.04,bh,12),pm(['#6A3B1C','#2F3B2A','#C27A3A','#8E3F35'][(b+r)%4],{r:.25}),p.x-p.w/2+.2+b*(p.w-.4)/8,1.27+r*.55+bh/2,-D/2+.15)}}add(new T.BoxGeometry(p.w+.4,1.05,.6),pm('#3A2A1F'),p.x,.525,-D/2+.9);add(new T.BoxGeometry(p.w+.5,.05,.66),pm('#B58D52',{m:.6,r:.35}),p.x,1.075,-D/2+.9)}
    });
    // rug
    const rugAnchor=cfg.items.find(i=>!i.hang&&['sofa','sectional'].includes(byId(i.id).type))||cfg.items[0];
    const rugW=Math.min(W-1,APPROX_CM[rugAnchor.id]/100+1.2),rugD=2.6;
    const rug=new T.Mesh(new T.PlaneGeometry(rugW,rugD),new T.MeshStandardMaterial({map:tex(texture('jute').url,[rugW*1.6,rugD*1.6]),roughness:1,transparent:true,opacity:0}));rug.rotation.x=-Math.PI/2;rug.position.set(rugAnchor.x,.006,rugAnchor.z+1.1);rug.receiveShadow=true;scene.add(rug);
    // ---------- pieces (billboards with real alpha shadows) ----------
    const blob=(()=>{const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');const gr=g.createRadialGradient(64,64,0,64,64,64);gr.addColorStop(0,'rgba(0,0,0,.55)');gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(0,0,128,128);return new T.CanvasTexture(c)})();
    const glowTex=(()=>{const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');const gr=g.createRadialGradient(64,64,0,64,64,64);gr.addColorStop(0,'rgba(255,214,150,1)');gr.addColorStop(.3,'rgba(255,170,80,.35)');gr.addColorStop(1,'rgba(255,150,60,0)');g.fillStyle=gr;g.fillRect(0,0,128,128);return new T.CanvasTexture(c)})();
    const pieces=[];const lamps=[];
    cfg.items.forEach((it,i)=>{const p=byId(it.id);const ar=CUT_AR[it.id];const w=APPROX_CM[it.id]/100,h=w*ar[1]/ar[0];const map=tex(cut(it.id));
      const mat=new T.MeshStandardMaterial({map,transparent:true,alphaTest:.45,side:T.DoubleSide,roughness:.85});
      const mesh=new T.Mesh(new T.PlaneGeometry(w,h),mat);mesh.castShadow=true;mesh.customDepthMaterial=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,map,alphaTest:.45});
      const restY=it.hang?H-h/2-.05:h/2;mesh.position.set(it.x,restY,it.z);mesh.userData={it,restY,i,w,h};scene.add(mesh);
      let shadow=null;if(!it.hang){shadow=new T.Mesh(new T.PlaneGeometry(w*1.05,Math.max(.5,FOOT_D[p.type]||w*.8)),new T.MeshBasicMaterial({map:blob,transparent:true,depthWrite:false,opacity:0}));shadow.rotation.x=-Math.PI/2;shadow.position.set(it.x,.008,it.z);scene.add(shadow)}
      else{const cord=new T.Mesh(new T.CylinderGeometry(.006,.006,.05,6),new T.MeshBasicMaterial({color:'#1E1B19'}));scene.add(cord);mesh.userData.cord=cord}
      if(GLOW_AT[it.id]){const g=GLOW_AT[it.id];const light=new T.PointLight('#FFB868',0,7,2);scene.add(light);const spr=new T.Sprite(new T.SpriteMaterial({map:glowTex,transparent:true,opacity:0,depthWrite:false,blending:T.AdditiveBlending}));spr.scale.set(w*1.4,w*1.4,1);scene.add(spr);lamps.push({light,spr,mesh,g})}
      pieces.push({mesh,shadow,p});
    });
    // ---------- plan lines ----------
    const ink=new T.LineBasicMaterial({color:'#2B211A',transparent:true,opacity:.85});
    const pts=[];const L=(a,b,c,d)=>{pts.push(new T.Vector3(a,.01,b),new T.Vector3(c,.01,d))};
    const bw=-D/2;let cx=-W/2;[...cfg.openings.filter(o=>o.y<1.2)].sort((a,b)=>a.x-b.x).forEach(o=>{L(cx,bw,o.x-o.w/2,bw);L(o.x-o.w/2,bw,o.x-o.w/2,bw-.22);L(o.x+o.w/2,bw,o.x+o.w/2,bw-.22);cx=o.x+o.w/2});L(cx,bw,W/2,bw);
    L(-W/2-.22,bw-.22,W/2+.22,bw-.22);L(-W/2,bw,-W/2,D/2);L(-W/2-.22,bw-.22,-W/2-.22,D/2);L(W/2,bw,W/2,D/2);L(W/2+.22,bw-.22,W/2+.22,D/2);
    const planLines=new T.LineSegments(new T.BufferGeometry().setFromPoints(pts),ink);scene.add(planLines);
    const fp=[];cfg.items.forEach(it=>{const p=byId(it.id);const w=APPROX_CM[it.id]/100;if(it.hang){const r=w/2;for(let k=0;k<24;k++){const a=k/24*Math.PI*2,b=(k+1)/24*Math.PI*2;fp.push(new T.Vector3(it.x+Math.cos(a)*r,.012,it.z+Math.sin(a)*r),new T.Vector3(it.x+Math.cos(b)*r,.012,it.z+Math.sin(b)*r))}return}const d=FOOT_D[p.type]||w;const x0=it.x-w/2,x1=it.x+w/2,z0=it.z-d/2,z1=it.z+d/2;[[x0,z0,x1,z0],[x1,z0,x1,z1],[x1,z1,x0,z1],[x0,z1,x0,z0]].forEach(([a,b,c,e])=>fp.push(new T.Vector3(a,.012,b),new T.Vector3(c,.012,e)))});
    const fpMat=new T.LineDashedMaterial({color:'#A65F2C',dashSize:.12,gapSize:.08,transparent:true,opacity:1});const footLines=new T.LineSegments(new T.BufferGeometry().setFromPoints(fp),fpMat);footLines.computeLineDistances();scene.add(footLines);
    // ---------- lights ----------
    const hemi=new T.HemisphereLight('#DDE7F0','#B8A58C',.55*LX);scene.add(hemi);
    const sun=new T.DirectionalLight('#FFF4E5',2.2*LX);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);const sc=sun.shadow.camera;sc.left=-9;sc.right=9;sc.top=9;sc.bottom=-9;sc.near=1;sc.far=40;sun.shadow.bias=-.0004;sun.shadow.normalBias=.02;scene.add(sun);scene.add(sun.target);
    const fill=new T.DirectionalLight('#FFF8EE',.35*LX);fill.position.set(2,4,8);scene.add(fill);
    // ---------- helpers ----------
    const C=(a,b,t)=>new T.Color(a).lerp(new T.Color(b),t);const V=(a,b,t)=>new T.Vector3().lerpVectors(a,b,t);
    const tri=(a,b,c,t)=>t<.5?C(a,b,t*2):C(b,c,(t-.5)*2);const triN=(a,b,c,t)=>t<.5?a+(b-a)*t*2:b+(c-b)*(t-.5)*2;
    const K=[{p:new T.Vector3(-W*.24,Math.max(W,D)*1.75,.01),l:new T.Vector3(-W*.24,0,0),u:new T.Vector3(0,0,-1)},{p:new T.Vector3(W*.8,W*.9,D*1.55),l:new T.Vector3(-W*.16,.4,-.4),u:new T.Vector3(0,1,0)},{p:new T.Vector3(0,1.5,D/2+3.4),l:new T.Vector3(0,1.15,-D/2),u:new T.Vector3(0,1,0)},{p:new T.Vector3(.9,1.42,D/2+1.6),l:new T.Vector3(-.25,1.1,-D/2),u:new T.Vector3(0,1,0)}];
    const mouse={x:0,y:0,nx:-9,ny:-9,in:false};const ray=new T.Raycaster();const ndc=new T.Vector2();const floorPlane=new T.Plane(new T.Vector3(0,1,0),0);
    let P=0,todT=0,hover=null,dirty=true,running=true,lastChap=-1,lastTod='',lastNight=null,overrideT=null;
    // labels (dimensions + footprints)
    const labels=[{v:new T.Vector3(0,.02,D/2+.45),t:`${W.toFixed(1)} m`},{v:new T.Vector3(W/2+.6,.02,0),t:`${D.toFixed(1)} m`},...cfg.items.map(it=>{const p=byId(it.id);return {v:new T.Vector3(it.x,.02,it.z),t:`${p.name} · ${APPROX_CM[it.id]} cm`,cog:1}})];
    const labEl=labRef.current;labEl.innerHTML=labels.map(l=>`<span class="rs-lab${l.cog?' cog':''}">${l.t}</span>`).join('');const labNodes=[...labEl.children];
    const resize=()=>{const r=stage.getBoundingClientRect();renderer.setSize(r.width,r.height,false);cam.aspect=r.width/r.height;cam.fov=r.width/r.height<.8?52:36;cam.updateProjectionMatrix();dirty=true};resize();
    const ro=new ResizeObserver(resize);ro.observe(stage);
    const onScroll=()=>{overrideT=null;const sec=secRef.current;if(!sec)return;const r=sec.getBoundingClientRect();const total=Math.max(1,sec.offsetHeight-stage.offsetHeight);P=clamp01(-r.top/total);dirty=true;setScrolled(P>.01)};
    onScroll();addEventListener('scroll',onScroll,{passive:true});
    const io=new IntersectionObserver(([e])=>{running=e.isIntersecting;if(running)loop()},{threshold:0});io.observe(stage);
    const onMove=e=>{const r=stage.getBoundingClientRect();mouse.x=(e.clientX-r.left)/r.width*2-1;mouse.y=-((e.clientY-r.top)/r.height*2-1);mouse.px=e.clientX-r.left;mouse.py=e.clientY-r.top;mouse.in=true;dirty=true};
    const onLeave=()=>{mouse.in=false;dirty=true};
    const onClick=e=>{if(hover){const r=stage.getBoundingClientRect();const v=hover.mesh.position.clone();v.y+=hover.mesh.userData.h/2;v.project(cam);setPick({id:hover.p.id,x:(v.x+1)/2*100,y:(1-v.y)/2*100,el:null})}else setPick(null)};
    stage.addEventListener('pointermove',onMove);stage.addEventListener('pointerleave',onLeave);stage.addEventListener('click',onClick);
    api.current={setT:t=>{overrideT=t;dirty=true},clearT:()=>{overrideT=null}};
    const tmp=new T.Vector3();
    function frame(){
      const s1=seg(P,0,.12),s2=seg(P,.12,.28),s3=seg(P,.28,.44),s4=clamp01((P-.36)/.16),s5=seg(P,.52,.66),s6=clamp01((P-.66)/.34);
      const t=overrideT!=null?overrideT:s6;todT=t;
      // camera path
      let a,b,k;if(P<.28){a=K[0];b=K[1];k=s2}else if(P<.44){a=K[1];b=K[2];k=s3}else{a=K[2];b=K[3];k=ease(clamp01((P-.44)/.56))}
      const pos=V(a.p,b.p,k),look=V(a.l,b.l,k);const up=V(a.u,b.u,P<.28?Math.min(1,k*1.6):1).normalize();
      const par=P>.4?1:0;pos.x+=mouse.in?mouse.x*.25*par:0;pos.y+=mouse.in?mouse.y*.12*par:0;
      cam.position.copy(pos);cam.up.copy(up);cam.lookAt(look);
      // plan
      planLines.geometry.setDrawRange(0,Math.floor(pts.length*Math.min(1,s1*1.25)));ink.opacity=.85*(1-s3);
      footLines.geometry.setDrawRange(0,Math.floor(fp.length*clamp01((s1-.35)/.65)));fpMat.opacity=1-clamp01((P-.4)/.08);
      grid.material.opacity=.08*(1-s3);
      walls.scale.y=Math.max(.002,s2);walls.visible=s2>.001;propsG.scale.y=Math.max(.002,clamp01((s2-.4)/.6));propsG.visible=s2>.4;
      ceil.material.opacity=clamp01((P-.42)/.06);ceil.visible=P>.42;
      // pieces drop in
      pieces.forEach(({mesh,shadow,p},i)=>{const u=mesh.userData;const st=clamp01((s4-i*.12)/.5);const e=1-Math.pow(1-st,3);
        const lift=(hover&&hover.mesh===mesh)?.06:0;mesh.position.y=u.restY+(1-e)*(u.it.hang?-1.2:2.4)+lift;mesh.visible=st>0;mesh.material.opacity=1;
        mesh.rotation.y=Math.atan2(cam.position.x-mesh.position.x,cam.position.z-mesh.position.z)*.85;
        mesh.material.emissive=mesh.material.emissive||new T.Color(0);mesh.material.emissive.setScalar(hover&&hover.mesh===mesh?.07:0);
        if(shadow)shadow.material.opacity=.7*e*(1-lift*6);
        if(u.cord){const top=H,bot=mesh.position.y+u.h/2;u.cord.visible=st>0&&P>.4;u.cord.scale.y=Math.max(.01,(top-bot)/.05);u.cord.position.set(mesh.position.x,(top+bot)/2,mesh.position.z)}});
      // finish
      floorFin.material.opacity=s5;wallFins.forEach((m,i)=>m.material.opacity=clamp01(s5*1.3-i*.15));rug.material.opacity=s5;
      lerpMats.forEach(([m,c,em])=>m.color.copy(CLAY).lerp(c,s5));
      // light / time of day
      const dayK=s5>0?t:0;
      sun.color.copy(tri('#FFF4E5','#FFB46B','#33406A',dayK));sun.intensity=LX*(triN(2.3,2.1,0,dayK));
      sun.position.copy(dayK<.5?V(new T.Vector3(6,7.5,-9),new T.Vector3(-7.5,2.4,-7),dayK*2):new T.Vector3(-7.5,2.4-dayK*2,-7));
      hemi.color.copy(tri('#DDE7F0','#F4CFA2','#1C2335',dayK));hemi.groundColor.copy(tri('#B8A58C','#A47E5A','#1A1410',dayK));hemi.intensity=LX*(triN(.6,.5,.07,dayK));fill.intensity=LX*(triN(.35,.3,0,dayK));
      sky.material.color.copy(tri('#CFE0EA','#F0A866','#070B16',dayK));
      const bg=tri('#F1ECE4','#EADCC6','#120E0B',dayK);renderer.setClearColor(bg);ground.material.color.copy(bg).lerp(new T.Color('#000'),.04);
      const lampK=clamp01((dayK-.55)/.3);lamps.forEach(l=>{const m=l.mesh,u=m.userData;const gx=m.position.x+(l.g[0]/100-.5)*u.w,gy=m.position.y+(.5-l.g[1]/100)*u.h;l.light.position.set(gx,gy-.05,m.position.z+.05);l.light.intensity=LX*(lampK*1.5*(m.visible?1:0));l.spr.position.set(gx,gy,m.position.z+.06);l.spr.material.opacity=lampK*.9*(m.visible?1:0)});
      glowMats.forEach(g=>g.emissiveIntensity=.3+lampK*2.4);
      renderer.toneMappingExposure=triN(1.05,1.08,.92,dayK);if(stage)stage.style.setProperty('--vig',(clamp01((dayK-.55)/.4)*.75).toFixed(2));
      // hover + crosshair coords
      hover=null;if(mouse.in){ndc.set(mouse.x,mouse.y);ray.setFromCamera(ndc,cam);const hits=ray.intersectObjects(pieces.map(p=>p.mesh).filter(m=>m.visible));if(hits.length&&P>.4){hover=pieces.find(p=>p.mesh===hits[0].object)}
        const hit=ray.ray.intersectPlane(floorPlane,tmp);if(coordRef.current)coordRef.current.textContent=hit&&Math.abs(tmp.x)<W/2+1&&Math.abs(tmp.z)<D/2+1?`X ${tmp.x>=0?'+':''}${tmp.x.toFixed(2)} m · Z ${tmp.z>=0?'+':''}${tmp.z.toFixed(2)} m`:`X —  · Z —`;
        if(xhRef.current){xhRef.current.style.transform=`translate(${mouse.px}px,${mouse.py}px)`;xhRef.current.style.opacity=P<.5?1:.35}}
      stage.style.cursor=hover?'pointer':'crosshair';
      if(tipRef.current){if(hover){tipRef.current.style.opacity=1;tipRef.current.style.transform=`translate(${mouse.px+16}px,${mouse.py+16}px)`;tipRef.current.textContent=hover.p.name+' · tap to view'}else tipRef.current.style.opacity=0}
      // labels
      const lo=clamp01(1-Math.abs(P-.14)/.14)*(P<.3?1:0);labels.forEach((l,i)=>{const n=labNodes[i];tmp.copy(l.v).project(cam);n.style.transform=`translate(-50%,-50%) translate(${(tmp.x+1)/2*stage.clientWidth}px,${(1-tmp.y)/2*stage.clientHeight}px)`;n.style.opacity=(l.cog?clamp01((s1-.5)/.5):s1)*lo});
      renderer.render(scene,cam);
      // react state (throttled)
      const ch=P<.12?0:P<.3?1:P<.5?2:P<.66?3:4;if(ch!==lastChap){lastChap=ch;setChap(ch)}
      const mins=Math.round((7.5*60+dayK*15.5*60)/10)*10;const label=s5>0||overrideT!=null?`${String(Math.floor(mins/60)%24).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`:'';if(label!==lastTod){lastTod=label;setTod(label)}
      const nn=dayK>.72||(cfg.dark&&P>.45);if(nn!==lastNight){lastNight=nn;setNight(nn);setHeroInk(nn?'#F4EADC':'#2B211A',nn?'#1C1510':'#FBF8F2')}
    }
    let raf=0;function loop(){cancelAnimationFrame(raf);const tick=()=>{if(!running)return;if(dirty||mouse.in||(P>.36&&P<.56)){frame();dirty=false}raf=requestAnimationFrame(tick)};tick()}
    loop();
    return()=>{running=false;cancelAnimationFrame(raf);removeEventListener('scroll',onScroll);ro.disconnect();io.disconnect();stage.removeEventListener('pointermove',onMove);stage.removeEventListener('pointerleave',onLeave);stage.removeEventListener('click',onClick);scene.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{if(m.map)m.map.dispose();m.dispose()})}});renderer.dispose()};
  },[ctx.space,three,threeFailed]);
  useEffect(()=>setPick(null),[ctx.space]);
  const goChap=i=>{const sec=secRef.current,st=stageRef.current;const top=sec.getBoundingClientRect().top+scrollY;const total=sec.offsetHeight-st.offsetHeight;scrollTo({top:top+total*[.06,.25,.47,.62,.8][i],behavior:'smooth'})};
  const pickSpace=k=>{ctx.setSpace(k);const sec=secRef.current;if(sec&&sec.getBoundingClientRect().top<0)scrollTo({top:sec.getBoundingClientRect().top+scrollY,behavior:'smooth'})};
  const C3=CHAPTERS[chap];const P0=pick&&byId(pick.id);const ids=[...new Set(cfg.items.map(i=>i.id))];
  return html`<section className="rh rs" ref=${secRef} style=${{height:'calc(6 * var(--app-h, 100svh))'}}>
    <div className=${'rs-stage'+(night?' night':'')} ref=${stageRef}>
      <canvas ref=${cvRef} className="rs-cv" aria-label=${'3D study of a '+sp.label.toLowerCase()+' furnished with Louie Mae pieces'}></canvas>
      ${!ok&&html`<div className="rs-fallback">3D needs WebGL, which isn't available in this browser.</div>`}
      <div className="rs-scrim" aria-hidden="true"></div><div className="rs-vig" aria-hidden="true"></div><div className="rs-labels" ref=${labRef} aria-hidden="true"></div>
      <div className="rs-frame" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div className="rs-xh" ref=${xhRef} aria-hidden="true"><span></span><span></span></div>
      <div className="rs-tip" ref=${tipRef} aria-hidden="true"></div>
      <div className="rs-copy" onClick=${e=>e.stopPropagation()}>
        <span className="rs-eye">Space study · ${sp.label} · ${String(chap+1).padStart(2,'0')} ${C3[0]}</span>
        <h1 key=${chap+ctx.space}>${C3[1]}</h1>
        <p key=${'p'+chap+ctx.space}>${C3[2]}</p>
        ${chap>=2&&html`<div className="rh-cta" style=${{marginTop:18}}><button className="rh-pill solid" onClick=${()=>ctx.toStudio(ids,sp.label+' study')}>Build this room ${I('arrow',{width:14})}</button><button className="rh-pill" onClick=${()=>{ids.forEach(id=>ctx.addToTray(id,1,null,true));ctx.toast(ids.length+' pieces added to '+ctx.activeProject.name,{label:'Open tray',fn:()=>ctx.setTray(true)})}}>Add all ${ids.length} pieces</button></div>`}
      </div>
      <ol className="rs-rail" onClick=${e=>e.stopPropagation()}>${CHAPTERS.map((c,i)=>html`<li key=${i}><button className=${i===chap?'on':i<chap?'done':''} onClick=${()=>goChap(i)}><span>${String(i+1).padStart(2,'0')}</span><b>${c[0]}</b></button></li>`)}</ol>
      <nav className=${'rh-index rs-index'+(chap>=2?' compact':'')} aria-label="Choose your space" onClick=${e=>e.stopPropagation()}>${SPACE_KEYS.map(k=>html`<button key=${k} className=${k===ctx.space?'on':''} aria-pressed=${k===ctx.space} onClick=${()=>pickSpace(k)}>${SPACES[k].label}<sup>${STUDY[k].W}×${STUDY[k].D} m</sup></button>`)}</nav>
      <div className="rs-meta" onClick=${e=>e.stopPropagation()}>
        <span className="rs-coord" ref=${coordRef}>X — · Z —</span>
        <span>${cfg.W.toFixed(1)} × ${cfg.D.toFixed(1)} × ${cfg.H.toFixed(1)} m · ${cfg.items.reduce((s,i)=>s+byId(i.id).seats,0)} seats</span>
        ${tod&&html`<span className="rs-tod">${tod}<input type="range" min="0" max="1" step=".01" aria-label="Time of day" onInput=${e=>api.current.setT&&api.current.setT(+e.target.value)} onPointerUp=${()=>{}} /></span>`}
      </div>
      <div className=${'rh-hint'+(scrolled?' gone':'')}><span>Scroll to build the room</span><i></i></div>
      ${P0&&html`<div className="rh-card" style=${{left:`clamp(160px, ${pick.x}%, calc(100% - 160px))`,top:`max(250px, ${pick.y}%)`}} onClick=${e=>e.stopPropagation()} role="dialog" aria-label=${P0.name}>
        <button className="rh-x" aria-label="Close" onClick=${()=>setPick(null)}>${I('x',{width:14})}</button>
        <span className="mono">${P0.sku} · ${MAT[P0.mat]} · ≈ ${APPROX_CM[P0.id]} cm</span><h3>${P0.name}</h3><p>${P0.line}</p>
        <div className="rh-price"><b>${ctx.mode==='trade'?fmt(tp(P0),true):fmt(P0.price,true)}</b>${ctx.mode==='trade'&&html`<s>${fmt(P0.price,true)}</s>`}</div>
        <div className="rh-card-act"><button className="rh-btn solid sm" onClick=${()=>ctx.addToTray(P0.id,1,null)}>${I('plus',{width:15})} Add to tray</button><button className="rh-btn sm" onClick=${()=>ctx.openPin(P0.id)}>Details</button></div>
      </div>`}
    </div>
  </section>`;
}

/* ================= HERO FILM: one continuous film per room, scrubbed by scroll ================= */
// Each film is a single video: plan → clay model → empty room → furnished → night.
// Timelines (seconds) come from the build step; hotspots only show while the frame is fully still.
const FILMS={
  bar:{space:'bar',name:'Navy & Brass',sub:'Cocktail bar',darkRoom:true,TL:{"total":30.93,"ch":[0,2.4,9.44,12.73,26.15],"hot":[[24.05,25.95],[29.43,30.93]],"dark":27.35,"reg":{"s":1,"ox":0,"oy":0,"gain":0}},
    hot:[{id:14,x:.727,y:.742},{id:14,x:.162,y:.566},{id:5,x:.765,y:.47},{id:16,x:.088,y:.625}],
    ch:[['Every room starts as a line.','The floor at true scale, with every Louie piece drawn in.'],['Then the walls go up.','A clay study model, low sun through the windows.'],['Navy, marble, brass.','Lacquer, stone and a faceted brass ceiling.'],['Cognac against navy.','The Rory, the Osborne and the Marlowick. Tap any piece.'],['Then the lamps take over.','The room people stay in after dark.']]},
  'cafe-paris':{space:'cafe',name:'Maison Rose',sub:'Patisserie salon',TL:{"total":29.2,"ch":[0,2.4,9.44,12.73,24.41],"hot":[[22.31,24.21],[27.7,29.2]],"dark":25.61,"reg":{"s":1,"ox":0,"oy":0,"gain":0}},
    hot:[{id:4,x:.52,y:.46},{id:14,x:.485,y:.555},{id:11,x:.615,y:.27}],
    ch:[['A salon, drawn to scale.','Twelve by eight metres of Paris.'],['Boiserie in clay.','Panelled walls and tall French windows.'],['Blush, terrazzo, walnut.','Plaster, rosso-bordered terrazzo and a fluted vitrine.'],['Olive velvet, tan leather.','The Bellamere, the Rory and the Aurelia. Tap any piece.'],['Globes on, street lamps out.','The salon carries on into the evening.']]},
  'cafe-provence':{space:'cafe',name:'Le Mas',sub:'Courtyard café',phoneClayAt:6.5,TL:{"total":30.12,"ch":[0,2.4,9.44,12.73,25.33],"hot":[[23.23,25.13],[28.62,30.12]],"dark":26.53,"reg":{"s":1,"ox":0,"oy":0,"gain":0}},
    hot:[{id:21,x:.9,y:.53},{id:14,x:.79,y:.6},{id:13,x:.05,y:.58},{id:12,x:.27,y:.17}],
    ch:[['Stone walls, open doors.','A courtyard café at true scale.'],['Arches in clay.','The doors and ceramic niche, in Provençal sun.'],['Limestone and terracotta.','Limewash, honed floors and dark oak beams.'],['Woven leather, rattan light.','The Cressida, the Rory, the Montrose and the Elara. Tap any piece.'],['Lanterns in the olive tree.','The courtyard lights come up.']]},
  'coffee-riviera':{space:'coffee',name:'Riviera',sub:'Seafront coffee lounge',TL:{"total":27.91,"ch":[0,2.3,8.65,11.55,23.13],"hot":[[21.03,22.93],[26.41,27.91]],"dark":24.33,"reg":{"s":1,"ox":0,"oy":0,"gain":0}},
    hot:[{id:4,x:.5,y:.61},{id:10,x:.26,y:.8},{id:10,x:.74,y:.8},{id:19,x:.88,y:.62}],
    ch:[['A lounge above the bay.','Sixteen by ten metres, drawn to scale.'],['A curve of glass in clay.','The sculpted ceiling and the long glass wall.'],['Terrazzo, cobalt, the sea.','A fluted tile bar and the bay through the glass.'],['Olive velvet, ivory bouclé.','The Bellamere, two Kensleys and the Ronan. Tap any piece.'],['Blue hour on the water.','The headland lights up and the glass wave glows.']]},
  'resto-orangerie':{space:'restaurant',name:'The Orangerie',sub:'Glasshouse dining',TL:{"total":29.2,"ch":[0,2.4,9.44,12.73,24.41],"hot":[[22.31,24.21],[27.7,29.2]],"dark":25.61,"reg":{"s":1,"ox":0,"oy":0,"gain":0}},
    hot:[{id:4,x:.25,y:.58},{id:10,x:.33,y:.75},{id:19,x:.76,y:.69}],
    ch:[['A dining room made of glass.','Eighteen by ten metres under a glazed roof.'],['Steel and glass in clay.','The conservatory frame in hard garden light.'],['Sage steel, checkerboard marble.','Lemon trees and green-and-cream stone.'],['Olive velvet, ivory bouclé.','The Bellamere, the Kensley and the Ronan. Tap any piece.'],['Then the lanterns glow.','The garden darkens for dinner.']]},
  'work-library':{space:'work',name:'The Material Library',sub:'Design studio',TL:{"total":30.83,"ch":[0,2.4,9.44,12.73,26.04],"hot":[[23.94,25.84],[29.33,30.83]],"dark":27.24,"reg":{"s":1,"ox":0,"oy":0,"gain":0}},
    hot:[{id:3,x:.2,y:.7},{id:3,x:.79,y:.7},{id:4,x:.31,y:.45},{id:10,x:.57,y:.85}],
    ch:[['A studio built around samples.','Twenty-two by fourteen metres, with a mezzanine library.'],['The double height rises.','Skylights, steel windows and a spiral stair.'],['Oak, plaster, terracotta.','White oak, warm plaster and a terracotta stair.'],['Tan leather, olive velvet.','Two Westcotts, the Bellamere and the Kensley. Tap any piece.'],['Lanterns over the worktables.','The studio after hours.']]},
  'work-loft':{space:'work',name:'Brick Loft',sub:'Warehouse studio',phoneClayAt:6.5,TL:{"total":29.7,"ch":[0,2.4,9.44,12.73,24.91],"hot":[[22.81,24.71],[28.2,29.7]],"dark":26.11,"reg":{"s":1,"ox":0,"oy":0,"gain":0}},
    hot:[{id:2,x:.27,y:.6},{id:16,x:.45,y:.73},{id:13,x:.82,y:.7}],
    ch:[['A warehouse, re-drawn.','Twenty by twelve metres of studio.'],['Trusses and factory glass.','The shell, as a clay study model.'],['Brick, steel, concrete.','Red brick, black steel and polished concrete.'],['Cognac against brick.','The Roscoe, the Marlowick and the Montrose. Tap any piece.'],['The cobalt pendant comes on.','City lights fill the windows.']]},
  'home-estate':{space:'staging',name:'Mediterranean Estate',sub:'Great room',TL:{"total":29.7,"ch":[0,2.4,9.44,12.73,24.91],"hot":[[22.81,24.71],[28.2,29.7]],"dark":26.11,"reg":{"s":1,"ox":0,"oy":0,"gain":0}},
    hot:[{id:6,x:.58,y:.62},{id:10,x:.8,y:.83},{id:13,x:.3,y:.47}],
    ch:[['A great room, to scale.','Sixteen by eleven metres around a limestone hearth.'],['Double height in clay.','Steel windows, an arched niche, the range hood.'],['Limestone and bronze.','Honed stone, warm plaster, walnut and aged bronze.'],['Cognac velvet on jute.','The Osborne, the Kensley and the Montrose. Tap any piece.'],['Firelight and the niche glow.','The house after dark.']]},
};
const filmsFor=space=>Object.keys(FILMS).filter(k=>FILMS[k].space===space);
const FILM_AR=16/9;
// Phones (any screen narrower than 3:4) get the film playing straight through (PhoneFilm)
// instead of scrubbed by scroll: one screen, no scroll-jacking, nothing to keep in step
// with the finger. Desktop and tablets keep FilmStudy.
const PHONE_FRAMES='(max-aspect-ratio: 3/4)';
function useMedia(q){const [m,setM]=useState(()=>matchMedia(q).matches);useEffect(()=>{const mq=matchMedia(q);const f=()=>setM(mq.matches);mq.addEventListener('change',f);return()=>mq.removeEventListener('change',f)},[q]);return m}

function FilmStudy({ctx,fk,setFk}){
  const F=FILMS[fk],TL=F.TL;const siblings=filmsFor(ctx.space);
  const secRef=useRef(),stageRef=useRef(),vidRef=useRef(),cur=useRef(0),last=useRef({ch:-1,hot:-1,dark:null});
  const [chi,setChi]=useState(0);const [hot,setHot]=useState(-1);const [dark,setDark]=useState(!!F.darkRoom&&false);
  const [box,setBox]=useState({w:1,h:1});const [pick,setPick]=useState(null);const [started,setStarted]=useState(false);const [ready,setReady]=useState(false);
  // index.html already showed chapter one; don't replay its entrance when the app takes over.
  const [fromShell]=useState(()=>document.documentElement.dataset.shell==='trade');useEffect(()=>{delete document.documentElement.dataset.shell},[]);
  // The film waits for the page to finish loading so it never competes with first paint.
  useEffect(()=>{const v=vidRef.current;if(!v)return;let idle=0;
    // iOS only buffers (and paints seeks) once a video has played, so tap play/pause.
    const go=()=>{v.preload='auto';v.load();const p=v.play();if(p)p.then(()=>v.pause(),()=>{})};
    const later=()=>{idle=(window.requestIdleCallback||setTimeout)(go,{timeout:1500})};
    if(document.readyState==='complete')later();else addEventListener('load',later,{once:true});
    return()=>{removeEventListener('load',later);(window.cancelIdleCallback||clearTimeout)(idle)}},[fk]);
  useEffect(()=>{const ro=new ResizeObserver(([e])=>setBox({w:e.contentRect.width,h:e.contentRect.height}));ro.observe(stageRef.current);return()=>ro.disconnect()},[]);
  useEffect(()=>{let raf=0,run=true;
    const tick=()=>{if(!run)return;const sec=secRef.current,st=stageRef.current,v=vidRef.current;
      if(sec&&st){const r=sec.getBoundingClientRect();const total=Math.max(1,sec.offsetHeight-st.offsetHeight);const P=Math.min(1,Math.max(0,-r.top/total));
        const target=P*(TL.total-0.05);
        // critically damped follow: smooth on wheels and trackpads, no overshoot
        cur.current+=(target-cur.current)*0.16;if(Math.abs(target-cur.current)<0.004)cur.current=target;
        if(v&&!v.seeking&&v.readyState>=1&&Math.abs(v.currentTime-cur.current)>1/48){try{v.currentTime=cur.current}catch(e){}}
        const t=cur.current;let c=0;for(let i=0;i<TL.ch.length;i++)if(t>=TL.ch[i])c=i;
        const h=TL.hot.findIndex(([a,b])=>t>=a-0.02&&t<=b+0.05);
        const dk=F.darkRoom?t>=TL.ch[2]:t>=TL.dark;
        const L=last.current;
        if(c!==L.ch){L.ch=c;setChi(c)}
        if(h!==L.hot){L.hot=h;setHot(h);if(h<0)setPick(null)}
        if(dk!==L.dark){L.dark=dk;setDark(dk);setHeroInk(dk?'#F4EADC':'#211912',dk?'#1A130E':'#FBF8F2')}
        if(P>0.004&&!started)setStarted(true)}
      raf=requestAnimationFrame(tick)};
    tick();return()=>{run=false;cancelAnimationFrame(raf)}},[fk]);
  const ch=F.ch[chi];
  const mw=Math.max(box.w,box.h*FILM_AR),mh=mw/FILM_AR;const ox=(box.w-mw)/2,oy=(box.h-mh)/2;
  const goChap=i=>{const sec=secRef.current,st=stageRef.current;const top=sec.getBoundingClientRect().top+scrollY;const total=sec.offsetHeight-st.offsetHeight;const t=i===3?TL.hot[0][0]+0.3:i===4?TL.hot[1][0]+0.3:TL.ch[i]+0.4;scrollTo({top:top+total*(t/TL.total),behavior:'smooth'})};
  const toTop=()=>{const sec=secRef.current;if(sec&&sec.getBoundingClientRect().top<0)scrollTo({top:sec.getBoundingClientRect().top+scrollY,behavior:'smooth'})};
  const P0=pick&&byId(pick.id);const ids=[...new Set(F.hot.map(h=>h.id))];
  return html`<section className="rh hf" ref=${secRef} style=${{height:'calc(7.5 * var(--app-h, 100svh))'}} aria-label=${F.name+' film'}>
    <div className=${'hf-stage'+(dark?' night':'')} ref=${stageRef} onClick=${()=>setPick(null)}>
      <img className="hf-video" src=${`f/${fk}/poster.jpg`} alt="" fetchpriority="high" aria-hidden="true"/>
      <video ref=${vidRef} className=${'hf-video hf-fade'+(ready?' on':'')} src=${`f/${fk}/film.mp4`} muted playsInline preload="none" aria-hidden="true" onLoadedData=${()=>setReady(true)}></video>
      <div className="hf-scrim" aria-hidden="true"></div>
      ${hot>=0&&F.hot.map((h,i)=>{const x=ox+h.x*mw,y=oy+h.y*mh;if(x<12||x>box.w-12||y<90||y>box.h-12)return null;const p=byId(h.id);return html`<button key=${hot+'-'+i} className="fs-hot" style=${{left:x+'px',top:y+'px',animationDelay:i*90+'ms'}} aria-label=${'View '+p.name} onClick=${e=>{e.stopPropagation();setPick({id:h.id,x:x/box.w*100,y:y/box.h*100})}}><i></i><span>${p.name}</span></button>`})}
      <div className=${'hf-copy'+(fromShell&&chi===0?' still':'')} onClick=${e=>e.stopPropagation()}>
        <h1 key=${'h'+fk+chi}>${ch[0]}</h1>
        <p key=${'p'+fk+chi}>${ch[1]}</p>
        ${chi>=3&&html`<div className="hf-cta"><button className="hf-btn solid" onClick=${()=>{ids.forEach(id=>ctx.addToTray(id,1,null,true));ctx.toast(ids.length+' pieces added to '+ctx.activeProject.name,{label:'Open tray',fn:()=>ctx.setTray(true)})}}>Shop the room</button><button className="hf-btn" onClick=${()=>ctx.toStudio(ids,F.name)}>Open in Studio</button></div>`}
      </div>
      <div className="hf-prog" role="group" aria-label="Chapters" onClick=${e=>e.stopPropagation()}>${F.ch.map((c,i)=>html`<button key=${i} className=${i===chi?'on':i<chi?'done':''} aria-label=${'Go to: '+c[0]} onClick=${()=>goChap(i)}><i></i></button>`)}</div>
      <nav className="hf-nav" aria-label="Choose a space" onClick=${e=>e.stopPropagation()}>
        ${siblings.length>1&&html`<div className="hf-films">${siblings.map(k=>html`<button key=${k} className=${k===fk?'on':''} aria-pressed=${k===fk} onClick=${()=>{setFk(k);toTop()}}>${FILMS[k].name}</button>`)}</div>`}
        <div className="hf-spaces">${SPACE_KEYS.map(k=>html`<button key=${k} className=${k===ctx.space?'on':''} aria-pressed=${k===ctx.space} onClick=${()=>{ctx.setSpace(k);toTop()}}>${SPACES[k].label}</button>`)}</div>
      </nav>
      <div className=${'hf-cue'+(started?' gone':'')} aria-hidden="true"><i></i></div>
      ${P0&&html`<div className="rh-card" style=${{left:`clamp(160px, ${pick.x}%, calc(100% - 160px))`,top:`max(260px, ${pick.y}%)`}} onClick=${e=>e.stopPropagation()} role="dialog" aria-label=${P0.name}>
        <button className="rh-x" aria-label="Close" onClick=${()=>setPick(null)}>${I('x',{width:14})}</button>
        <h3>${P0.name}</h3><p>${P0.line}</p>
        <div className="rh-price"><b>${ctx.mode==='trade'?fmt(tp(P0),true):fmt(P0.price,true)}</b>${ctx.mode==='trade'&&html`<s>${fmt(P0.price,true)}</s>`}</div>
        <div className="rh-card-act"><button className="rh-btn solid sm" onClick=${()=>ctx.addToTray(P0.id,1,null)}>${I('plus',{width:15})} Add to tray</button><button className="rh-btn sm" onClick=${()=>ctx.openPin(P0.id)}>Details</button></div>
      </div>`}
    </div>
  </section>`;
}
/* ================= PHONE FILM: the room film playing straight through ================= */
// Phones get the same one-screen hero as desktop, but the film plays on its own as one
// continuous video instead of following the scroll: f/<film>/phone.mp4, a shorter 3:4 cut
// (trade/phoneCut.mjs): blueprint, clay, one shot into the room as its furniture takes
// on colour, then night. The headline follows the film's chapters; at the end
// the film fades to its first frame and plays again. Where it can't autoplay (Low Power
// Mode), the opening frame stays with a play button; reduced motion starts paused.
function PhoneFilm({ctx,fk,setFk}){
  const F=FILMS[fk],P=phoneCut(F.TL,{clayAt:F.phoneClayAt,darkRoom:F.darkRoom});const siblings=filmsFor(ctx.space);
  const secRef=useRef(),vidRef=useRef(),last=useRef({ch:-1,dark:null});
  const [chi,setChi]=useState(0);const [dark,setDark]=useState(false);const [shown,setShown]=useState(false);
  const [loaded,setLoaded]=useState(()=>document.readyState==='complete');const [onScreen,setOnScreen]=useState(true);
  const [paused,setPaused]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);const [fading,setFading]=useState(false);
  // index.html already showed chapter one; don't replay its entrance when the app takes over.
  const [fromShell]=useState(()=>document.documentElement.dataset.shell==='trade');useEffect(()=>{delete document.documentElement.dataset.shell},[]);
  // the film waits for the page to finish loading so it never competes with first paint
  useEffect(()=>{if(loaded)return;const f=()=>setLoaded(true);addEventListener('load',f,{once:true});return()=>removeEventListener('load',f)},[]);
  useEffect(()=>{const io=new IntersectionObserver(([e])=>setOnScreen(e.isIntersecting),{threshold:0});io.observe(secRef.current);return()=>io.disconnect()},[]);
  useEffect(()=>{const v=vidRef.current;if(!v)return;v.muted=true;
    if(onScreen&&!paused){const p=v.play();if(p)p.catch(e=>{if(e&&e.name==='NotAllowedError')setPaused(true)})}else v.pause()},[loaded,onScreen,paused]);
  useEffect(()=>{setHeroInk('#211912','#FBF8F2');return()=>setHeroInk('#211912','#FBF8F2')},[fk]);
  // the headline and ink follow the film as it plays
  const tick=()=>{const v=vidRef.current;if(!v)return;const t=v.currentTime;let c=0;for(let i=0;i<P.ch.length;i++)if(t>=P.ch[i])c=i;
    const dk=t>=P.dark;const L=last.current;
    if(c!==L.ch){L.ch=c;setChi(c)}
    if(dk!==L.dark){L.dark=dk;setDark(dk);setHeroInk(dk?'#F4EADC':'#211912',dk?'#1A130E':'#FBF8F2')}};
  useEffect(()=>{if(!shown||paused||!onScreen)return;let raf=0;const loop=()=>{tick();raf=requestAnimationFrame(loop)};loop();return()=>cancelAnimationFrame(raf)},[shown,paused,onScreen]);
  // one continuous loop: fade to the opening frame, then start again
  const ended=()=>{setFading(true);setTimeout(()=>{const v=vidRef.current;if(!v)return;v.currentTime=0;tick();setFading(false);if(!paused&&onScreen)v.play().catch(()=>{})},700)};
  const toChap=i=>{const v=vidRef.current;if(!v)return;v.currentTime=P.ch[i]+0.05;tick();if(paused)setPaused(false)};
  const toTop=()=>{const sec=secRef.current;if(sec&&sec.getBoundingClientRect().top<0)scrollTo({top:sec.getBoundingClientRect().top+scrollY,behavior:'smooth'})};
  const ch=F.ch[chi];const ids=[...new Set(F.hot.map(h=>h.id))];
  return html`<section className="rh hf pf" ref=${secRef} aria-label=${F.name+' film'}>
    <div className=${'hf-stage'+(dark?' night':'')}>
      <img className="hf-video" src=${`f/${fk}/phone.webp`} alt="" fetchpriority="high" aria-hidden="true"/>
      ${loaded&&html`<video ref=${vidRef} key=${fk} className=${'hf-video hf-fade'+(shown&&!fading?' on':'')} src=${`f/${fk}/phone.mp4`} muted playsInline preload="auto" aria-hidden="true" onPlaying=${()=>setShown(true)} onEnded=${ended} onError=${()=>setPaused(true)}></video>`}
      <div className="hf-scrim" aria-hidden="true"></div>
      <div className=${'hf-copy'+(fromShell&&chi===0?' still':'')}>
        <h1 key=${'h'+fk+chi}>${ch[0]}</h1>
        <p key=${'p'+fk+chi}>${ch[1].replace(/\s*Tap any piece\.$/,'')}</p>
        ${chi>=3&&html`<div className="hf-cta"><button className="hf-btn solid" onClick=${()=>{ids.forEach(id=>ctx.addToTray(id,1,null,true));ctx.toast(ids.length+' pieces added to '+ctx.activeProject.name,{label:'Open tray',fn:()=>ctx.setTray(true)})}}>Shop the room</button><button className="hf-btn" onClick=${()=>ctx.toStudio(ids,F.name)}>Open in Studio</button></div>`}
      </div>
      <div className="hf-prog" role="group" aria-label="Chapters">${F.ch.map((c,i)=>html`<button key=${i} className=${i===chi?'on':i<chi?'done':''} aria-label=${'Go to: '+c[0]} onClick=${()=>toChap(i)}><i></i></button>`)}</div>
      ${loaded&&paused&&html`<button className="pf-play" aria-label="Play the film" onClick=${()=>setPaused(false)}>${I('play',{width:18})}</button>`}
      <nav className="hf-nav" aria-label="Choose a space">
        ${siblings.length>1&&html`<div className="hf-films">${siblings.map(k=>html`<button key=${k} className=${k===fk?'on':''} aria-pressed=${k===fk} onClick=${()=>{setFk(k);toTop()}}>${FILMS[k].name}</button>`)}</div>`}
        <div className="hf-spaces">${SPACE_KEYS.map(k=>html`<button key=${k} className=${k===ctx.space?'on':''} aria-pressed=${k===ctx.space} onClick=${()=>{ctx.setSpace(k);toTop()}}>${SPACES[k].label}</button>`)}</div>
      </nav>
    </div>
  </section>`;
}
function HeroSwitch({ctx}){
  const list=filmsFor(ctx.space);
  const [picks,setPicks]=useState(()=>load('film',{}));
  const fk=list.includes(picks[ctx.space])?picks[ctx.space]:list[0];
  const setFk=k=>{const n={...picks,[ctx.space]:k};setPicks(n);store('film',n)};
  const phone=useMedia(PHONE_FRAMES);
  return !fk?html`<${RoomStudy} ctx=${ctx}/>`:phone?html`<${PhoneFilm} key=${fk} fk=${fk} setFk=${setFk} ctx=${ctx}/>`:html`<${FilmStudy} key=${fk} fk=${fk} setFk=${setFk} ctx=${ctx}/>`;
}

/* ================= ROOMS WE LOVE: full-screen rooms that stack as you scroll ================= */
const SCENES=[
  {key:'brasserie',name:'Rive Gauche',sub:'Rain on the boulevard, cognac leather inside.',img:'f/scenes/brasserie.webp',ar:2688/1520,
    hot:[{id:23,x:.15,y:.75},{id:9,x:.87,y:.82},{id:11,x:.18,y:.28}]},
  {key:'lodge',name:'Alpine Lodge',sub:'Split stone, cedar and a fire worth gathering around.',img:'f/scenes/lodge.webp',ar:2688/1520,
    hot:[{id:5,x:.35,y:.57},{id:11,x:.18,y:.3},{id:14,x:.63,y:.8}]},
];
function RoomPanel({s,ctx,setRef,i}){
  const stageRef=useRef();const [box,setBox]=useState({w:1,h:1});const [act,setAct]=useState(null);
  useEffect(()=>{const ro=new ResizeObserver(([e])=>setBox({w:e.contentRect.width,h:e.contentRect.height}));ro.observe(stageRef.current);return()=>ro.disconnect()},[]);
  // object-fit: cover mapping so the dots stay on the furniture at any screen shape
  const mw=Math.max(box.w,box.h*s.ar),mh=mw/s.ar,ox=(box.w-mw)/2,oy=(box.h-mh)/2;
  const ids=[...new Set(s.hot.map(h=>h.id))];
  const total=ids.reduce((t,id)=>t+pr(byId(id),ctx.mode),0);
  return html`<article className="rp" ref=${setRef} style=${{zIndex:i+1}} aria-label=${s.name}>
    <div className="rp-stage" ref=${stageRef}>
      <img className="rp-img" src=${s.img} srcSet=${`${s.img.replace('.webp','-1200.webp')} 1200w, ${s.img} 2400w`} sizes="100vw" alt=${s.name+', furnished with Louie Mae pieces'} loading="lazy"/>
      <div className="rp-shade" aria-hidden="true"></div>
      ${s.hot.map((h,k)=>{const x=ox+h.x*mw,y=oy+h.y*mh;if(x<16||x>box.w-16||y<80||y>box.h-16)return null;const p=byId(h.id);return html`<button key=${k} className=${'fs-hot rp-dot'+(act===h.id?' on':'')} style=${{left:x+'px',top:y+'px'}} aria-label=${p.name} onMouseEnter=${()=>setAct(h.id)} onMouseLeave=${()=>setAct(null)} onFocus=${()=>setAct(h.id)} onBlur=${()=>setAct(null)} onClick=${()=>setAct(act===h.id?null:h.id)}><i></i><span>${p.name}</span></button>`})}
      <div className="rp-copy">
        <h2>${s.name}</h2>
        <p>${s.sub}</p>
      </div>
      <aside className="rp-shop" aria-label=${'Pieces in '+s.name}>
        ${ids.map(id=>{const p=byId(id);return html`<div key=${id} className=${'rp-item'+(act===id?' on':'')} onMouseEnter=${()=>setAct(id)} onMouseLeave=${()=>setAct(null)}>
          <button className="rp-thumb" onClick=${()=>ctx.openPin(id)} aria-label=${'View '+p.name}><img src=${cut(id)} alt="" loading="lazy"/></button>
          <button className="rp-name" onClick=${()=>ctx.openPin(id)}><b>${p.name}</b><span>${p.line}</span></button>
          <span className="rp-price num">${ctx.mode==='trade'?fmt(tp(p)):fmt(p.price)}</span>
          <button className="rp-add" aria-label=${'Add '+p.name+' to tray'} onClick=${e=>ctx.addToTray(id,1,e.currentTarget.closest('.rp-item').querySelector('img'))}>${I('plus',{width:16})}</button>
        </div>`})}
        <div className="rp-foot">
          <span><small>${ids.length} pieces</small><b className="num">${fmt(total)}</b></span>
          <button className="rp-all" onClick=${()=>{ids.forEach(id=>ctx.addToTray(id,1,null,true));ctx.toast(ids.length+' pieces added to '+ctx.activeProject.name,{label:'Open tray',fn:()=>ctx.setTray(true)})}}>Shop the room</button>
        </div>
      </aside>
    </div>
  </article>`;
}
function RoomsWeLove({ctx}){
  const refs=useRef([]);
  // each room settles from a slight zoom to rest as it slides into place. Only rooms on screen
  // are measured (the observer says which), so the page never lays out rooms nobody can see.
  // A room that just left is measured once more so it settles at its end state.
  useEffect(()=>{let raf=0;const seen=new Set(),left=new Set();
    const set=el=>el.style.setProperty('--p',Math.min(1,Math.max(0,1-el.getBoundingClientRect().top/appH())).toFixed(3));
    const f=()=>{raf=0;left.forEach(set);left.clear();seen.forEach(set)};
    const on=()=>{if(!raf&&(seen.size||left.size))raf=requestAnimationFrame(f)};
    const io=new IntersectionObserver(es=>{es.forEach(e=>{if(e.isIntersecting)seen.add(e.target);else if(seen.delete(e.target))left.add(e.target)});on()});
    refs.current.forEach(el=>el&&io.observe(el));
    addEventListener('scroll',on,{passive:true});addEventListener('resize',on);return()=>{io.disconnect();removeEventListener('scroll',on);removeEventListener('resize',on);cancelAnimationFrame(raf)}},[]);
  return html`<section className="rooms" aria-label="Rooms we love">
    <header className="rooms-h"><h2>Rooms we love</h2><p>Step inside. Every piece is ready to order.</p></header>
    ${SCENES.map((s,i)=>html`<${RoomPanel} key=${s.key} s=${s} i=${i} ctx=${ctx} setRef=${el=>refs.current[i]=el}/>`)}
  </section>`;
}

/* ================= HOME ================= */
const TILE_POS=[{l:'2%',t:'4%',w:'50%',r:-3,s:'arch',ar:'4/5'},{l:'56%',t:'0%',w:'42%',r:2.5,s:'rect',ar:'4/3'},{l:'50%',t:'46%',w:'34%',r:-2,s:'circle',ar:'1/1'},{l:'14%',t:'64%',w:'34%',r:3,s:'pill',ar:'3/2'}];
/* ================= HOME: immersive glass sections ================= */
// Section reveal on scroll + cursor parallax for floating pieces.
function useLux(){
  const ref=useRef();
  useEffect(()=>{const el=ref.current;if(!el)return;
    const io=new IntersectionObserver(([e])=>{if(e.isIntersecting){el.classList.add('in');io.disconnect()}},{threshold:.18});io.observe(el);
    let raf=0;const move=e=>{if(raf)return;raf=requestAnimationFrame(()=>{raf=0;const r=el.getBoundingClientRect();el.style.setProperty('--mx',((e.clientX-r.left)/r.width*2-1).toFixed(3));el.style.setProperty('--my',((e.clientY-r.top)/r.height*2-1).toFixed(3))})};
    el.addEventListener('pointermove',move);return()=>{io.disconnect();el.removeEventListener('pointermove',move);cancelAnimationFrame(raf)}},[]);
  return ref;
}
// A product cutout hovering in space, with a contact shadow that breathes with it.
function FloatPiece({id,w=150,depth=14,delay=0,className='',style}){
  const ar=CUT_AR[id]||[1,1];
  return html`<span className=${'fp '+className} style=${{'--d':depth+'px','--fd':delay+'s',width:w+'px',...style}} aria-hidden="true">
    <img src=${cut(id)} alt="" loading="lazy" style=${{aspectRatio:ar[0]+'/'+ar[1]}}/><i></i>
  </span>`;
}
const stillFor=space=>{const k=filmsFor(space)[0];return k?`f/${k}/still.jpg`:'f/cafe-paris/still.jpg'};

// Start: a gallery of three arched doors. The open door widens, its room comes alive and a piece steps out.
function StartRoom({ctx}){
  const ref=useLux();const sp=SPACES[ctx.space];const upRef=useRef();
  const [open,setOpen]=useState(1);const [mood,setMood]=useState('');const [drag,setDrag]=useState(false);
  const toStudioWith=f=>{if(!f||!f.type.startsWith('image/'))return;const r=new FileReader();r.onload=()=>{ctx.setStudioSeed({bg:r.result,mode:'room',ids:sp.picks.slice(0,3),title:'My space'});ctx.go('studio')};r.readAsDataURL(f)};
  const live=useMemo(()=>{const q=mood.trim();if(q.length<3)return [];return matchPrompt(q).slice(0,3)},[mood]);
  const moodPieces=live.map(p=>p.id);
  const compose=()=>{ctx.setStudioSeed({prompt:mood||'cognac leather and rattan for a café'});ctx.go('studio')};
  const door=(i,props)=>({className:'door'+(open===i?' open':''),onMouseEnter:()=>setOpen(i),onFocusCapture:()=>setOpen(i),onClick:()=>setOpen(i),...props});
  return html`<section className="lx gallery" ref=${ref} aria-label="Start with your room">
    <div className="gal-glow" aria-hidden="true"></div>
    <div className="lx-in">
      <header className="gal-h" data-r style=${{'--i':0}}><h2>Begin your room.</h2><p>Three doors. Step through the one that fits how you work.</p></header>
      <div className="doors" data-r style=${{'--i':1}}>

        <div ...${door(0,{onDragOver:e=>{e.preventDefault();setDrag(true);setOpen(0)},onDragLeave:()=>setDrag(false),onDrop:e=>{e.preventDefault();setDrag(false);toStudioWith(e.dataTransfer.files[0])}})}>
          <div className=${'arch'+(drag?' drop':'')}>
            <img className="arch-img base" src="f/home-estate/empty.jpg" alt="" loading="lazy"/>
            <img className="arch-img reveal" src="f/home-estate/still.jpg" alt="" loading="lazy"/>
            <div className="arch-shade"></div>
            <div className="arch-panel">
              <h3>Bring your room</h3>
              <div className="arch-more"><p>Drop a photo of your space onto this door. Pieces land in it, true to scale.</p>
                <button className="door-btn" onClick=${e=>{e.stopPropagation();upRef.current.click()}}>${I('upload',{width:16})} Upload a photo</button></div>
            </div>
            <input ref=${upRef} type="file" accept="image/*" hidden onChange=${e=>toStudioWith(e.target.files[0])}/>
          </div>
        </div>

        <div ...${door(1)}>
          <div className=${"arch"+(live.length?" focus":"")}>
            <img className="arch-img base" src=${stillFor(ctx.space)} alt="" loading="lazy"/>
            <div className="arch-shade"></div>
            <div className="mood-float" aria-hidden="true">${moodPieces.map((id,k)=>html`<${FloatPiece} key=${id+'-'+k} id=${id} w=${[200,150,170][k]} depth=${10+k*6} delay=${-k*2.1} className=${'mf mf'+k}/>`)}</div>
            <div className="arch-panel">
              <h3>Describe a feeling</h3>
              <div className="arch-more"><p>${live.length?'Pieces that match, floating in now.':'Type a mood. Matching pieces drift in as you write.'}</p>
                <form className="door-mood" onSubmit=${e=>{e.preventDefault();compose()}} onClick=${e=>e.stopPropagation()}><input aria-label="Describe a feeling" value=${mood} onInput=${e=>setMood(e.target.value)} placeholder="Cognac leather, low light, brass"/><button aria-label="Compose in Studio">${I('arrow',{width:16})}</button></form></div>
            </div>
          </div>
        </div>

        <div ...${door(2)}>
          <div className="arch">
            <img className="arch-img base" src="f/work-loft/still.jpg" alt="" loading="lazy"/>
            <img className="arch-img morph" src="f/resto-orangerie/still.jpg" alt="" loading="lazy"/>
            <div className="arch-shade"></div>
            <div className="arch-panel">
              <h3>Discover your style</h3>
              <div className="arch-more"><p>Five questions, then a blend of the two styles you lean toward.</p>
                <button className="door-btn" onClick=${e=>{e.stopPropagation();ctx.go('quiz')}}>Begin the quiz ${I('arrow',{width:15})}</button></div>
            </div>
          </div>
        </div>

      </div>
    </div>
  </section>`;
}

function Collection({ctx}){
  const ref=useLux();const sp=SPACES[ctx.space];const [cat,setCat]=useState('all');
  const list=useMemo(()=>{let l=[...PRODUCTS];l.sort((a,b)=>(sp.picks.includes(b.id)?2:sp.mats.includes(b.mat)?1:0)-(sp.picks.includes(a.id)?2:sp.mats.includes(a.mat)?1:0));if(cat!=='all')l=l.filter(p=>p.type===cat);return l.slice(0,8)},[ctx.space,cat]);
  const saved=id=>ctx.boards.some(b=>b.pins.some(x=>x.pid===id));
  return html`<section className="lx lx-coll" ref=${ref}>
    <div className="lx-in">
      <header className="lx-h row" data-r style=${{'--i':0}}><div><h2>The collection</h2><p>Commercial-grade pieces, chosen for ${sp.label.toLowerCase()}s.</p></div>
        <div className="lx-tabs glass light" role="tablist">${[['all','All'],...Object.entries(TYPE)].map(([k,l])=>html`<button key=${k} role="tab" aria-selected=${cat===k} className=${cat===k?'on':''} onClick=${()=>setCat(k)}>${l}</button>`)}</div>
      </header>
      <div className="lx-grid" key=${cat}>
        ${list.map((p,i)=>html`<article key=${p.id} className="lx-piece" data-r style=${{'--i':i%4+1}}>
          <button className=${"lx-stage"+([8,12].includes(p.id)?" hang":"")} onClick=${()=>ctx.openPin(p.id)} aria-label=${'View '+p.name+' '+p.line}>
            <span className="lx-cut"><img src=${cut(p.id)} alt="" loading="lazy" style=${{aspectRatio:(CUT_AR[p.id]||[1,1]).join('/')}}/></span><i className="lx-floor"></i>
            ${p.oos&&html`<span className="lx-tag">Restock on request</span>`}
          </button>
          <div className="lx-chip glass light">
            <div className="lx-chip-t"><b>${p.name}</b><span>${p.line}</span></div>
            <span className="lx-chip-p num">${ctx.mode==='trade'?fmt(tp(p)):fmt(p.price)}</span>
            <button className=${'lx-ic'+(saved(p.id)?' on':'')} aria-label=${saved(p.id)?'Saved':'Save to board'} onClick=${()=>ctx.boards[0]&&ctx.saveTo(p.id,ctx.boards[0].id)}>${I('heart',{width:15})}</button>
            <button className="lx-ic solid" aria-label=${'Add '+p.name+' to tray'} onClick=${e=>ctx.addToTray(p.id,1,e.currentTarget.closest('.lx-piece').querySelector('img'))}>${I('plus',{width:16})}</button>
          </div>
        </article>`)}
      </div>
      <div className="lx-more" data-r style=${{'--i':5}}><button className="btn btn-line" onClick=${()=>{ctx.setQuery(cat==='all'?'':cat);ctx.setImgQ(null);ctx.go('discover')}}>See all ${cat==='all'?PRODUCTS.length+' pieces':TYPE[cat].toLowerCase()} ${I('arrow',{width:15})}</button></div>
    </div>
  </section>`;
}

// Trade: the client quote, shown as the thing a designer actually sends. The controls drive a live demo.
function QuoteShow({ctx}){
  const ref=useLux();
  const [show,setShow]=useState('markup');const [mk,setMk]=useState(40);
  const pick=(n,i)=>PRODUCTS.find(p=>p.name===n)||PRODUCTS[i];
  const lines=useMemo(()=>[[pick('Roscoe',0),2],[pick('Ansel',1),4],[pick('Elara',2),3]],[]);
  const set={show,markup:mk};const cost=lines.reduce((s,[p,q])=>s+(p.trade??p.price*TRADE)*q,0);
  const sell=lines.reduce((s,[p,q])=>s+qSellOf(p,set)*q,0);const profit=useTween(sell-cost,500);const total=useTween(sell+2400,500);
  const sample=()=>{location.hash='q/sample'};
  return html`<section className="lx qs" ref=${ref} aria-label="Client quotes">
    <div className="qs-light" aria-hidden="true"></div>
    <div className="lx-in qs-grid">
      <div className="qs-copy" data-r style=${{'--i':0}}>
        <h2>Send a quote your client will want to frame.</h2>
        <p>Price the project, set your markup, and share one link. Your client sees your studio, their room and every piece, then approves from their phone.</p>
        <div className="qs-ctl">
          <div className="qc-seg" role="radiogroup" aria-label="What your client sees">${[['cost','Your cost'],['markup','Marked up'],['retail','Retail']].map(([k,t])=>html`<button key=${k} role="radio" aria-checked=${show===k} className=${show===k?'on':''} onClick=${()=>setShow(k)}>${t}</button>`)}</div>
          ${show==='markup'&&html`<div className="qc-mk"><input className="lux-range qc-range" type="range" min="0" max="80" step="5" value=${mk} style=${{'--p':mk/80*100+'%'}} onInput=${e=>setMk(+e.target.value)} aria-label="Your markup"/><b className="num">${mk}%</b></div>`}
        </div>
        <div className="qs-cta"><button className="btn btn-ink btn-lg" onClick=${()=>ctx.go('trade')}>Open a trade account</button><button className="lnk" onClick=${sample}>View a sample quote ${I('arrow',{width:15})}</button></div>
      </div>
      <div className="qs-stage" data-r style=${{'--i':1}} aria-hidden="true">
        <div className="qs-doc">
          <div className="qs-hero" style=${{backgroundImage:`url(${stillFor(ctx.space)})`}}><i>Studio Ama</i><span>Prepared for Ama Owusu</span><b>Fernwood Café</b></div>
          <div className="qs-lines">${lines.map(([p,q])=>html`<div key=${p.id} className="qs-line"><span className="qs-th"><img src=${cut(p.id)} alt=""/></span><span className="qs-what"><b>${p.name}</b><small>${p.line}</small></span><span className="qs-q">${q} ×</span><span className="qs-p num">${fmt(qSellOf(p,set)*q)}</span></div>`)}</div>
          <div className="qs-tot"><span>Total</span><b className="num">${fmt(Math.round(total))}</b></div>
          <div className="qs-btn">Approve quote</div>
        </div>
        <div className="qs-chip qs-private"><span>${I('lock',{width:13})} Only you see this</span><b className="num">${fmt(Math.round(profit))}</b><small>your profit</small></div>
        <div className="qs-chip qs-ok"><span className="qs-seal">${I('check',{width:14})}</span><span><b>Approved</b><small>by Ama Owusu</small></span></div>
      </div>
    </div>
  </section>`;
}

// Trade: a digital trade pass, generated on screen from the business name. Nothing is printed or issued.
function useTween(value,ms=700){
  const [v,setV]=useState(value);const from=useRef(value);
  useEffect(()=>{const a=from.current,b=value,t0=performance.now();let raf;
    const step=t=>{const k=Math.min(1,(t-t0)/ms),e=1-Math.pow(1-k,3);const x=a+(b-a)*e;setV(x);from.current=x;if(k<1)raf=requestAnimationFrame(step)};
    raf=requestAnimationFrame(step);return()=>cancelAnimationFrame(raf)},[value]);
  return v;
}
function TradeBand({ctx}){
  const ref=useLux();const cardRef=useRef();
  const [name,setName]=useState('');const [flip,setFlip]=useState(false);const [amt,setAmt]=useState(25000);
  // card-local tilt so the light follows the cursor across the metal
  const tilt=e=>{const el=cardRef.current;if(!el)return;const r=el.getBoundingClientRect();el.style.setProperty('--tx',((e.clientX-r.left)/r.width*2-1).toFixed(3));el.style.setProperty('--ty',((e.clientY-r.top)/r.height*2-1).toFixed(3))};
  const rest=()=>{const el=cardRef.current;if(el){el.style.setProperty('--tx',0);el.style.setProperty('--ty',0)}};
  const trade=amt*TRADE,save=amt-trade,proj=Math.round(trade*tierOf(trade).rate),earn=Math.round(amt*COMMISSION);
  const tSave=useTween(save+proj),tEarn=useTween(earn),tProj=useTween(proj);
  const shown=(name.trim()||'Your studio').slice(0,26);
  const money=v=>'$'+Math.round(v).toLocaleString('en-US');
  return html`<section className="lx tc" ref=${ref} aria-label="Built for the trade">
    <div className="tc-spot" aria-hidden="true"></div>
    <div className="lx-in tc-grid">
      <div className="tc-copy">
        <header data-r style=${{'--i':0}}><h2>Built for the trade.</h2><p>One verified account opens trade pricing on every piece, project pricing on big orders, sourcing on request and commission on what your clients buy.</p></header>
        <label className="tc-engrave" data-r style=${{'--i':1}}><span>Preview your trade pass</span><input value=${name} maxLength="26" onInput=${e=>setName(e.target.value)} placeholder="Your studio name"/></label>
        <div className="tc-lens" data-r style=${{'--i':2}}>
          <div className="tc-lens-h"><span>Project size</span><b className="num">${money(amt)}</b></div>
          <input type="range" min="5000" max="250000" step="1000" value=${amt} onInput=${e=>setAmt(+e.target.value)} aria-label="Project size in dollars"/>
          <div className="tc-figs">
            <div><b className="num">${money(tSave)}</b><span>you save at trade${proj?html`, including <em className="num">${money(tProj)}</em> project pricing`:''}</span></div>
            <div><b className="num">${money(tEarn)}</b><span>you earn if clients buy it from your boards</span></div>
          </div>
        </div>
        <div className="tc-actions" data-r style=${{'--i':3}}><button className="btn btn-lg lx-cream" onClick=${()=>ctx.go('trade')}>Apply for trade</button><button className="btn btn-lg lx-ghost" onClick=${()=>ctx.go('hub')}>Your quotes</button></div>
      </div>

      <div className="tc-stage" data-r style=${{'--i':1}} onPointerMove=${tilt} onPointerLeave=${rest}>
        <button ref=${cardRef} className=${'tc-card'+(flip?' flip':'')} onClick=${()=>setFlip(!flip)} aria-label=${flip?'Show the front of the trade pass':'Turn the trade pass over to see the benefits'} aria-pressed=${flip}>
          <span className="tc-face tc-front">
            <span className="tc-sheen" aria-hidden="true"></span>
            <span className="tc-mark foil">HL</span>
            <span className="tc-brand foil">House of Louie Mae</span>
            <span className="tc-tier">Trade</span>
            <span className="tc-name foil" key=${shown}>${shown}</span>
            <span className="tc-meta"><span>Verified trade</span><span className="num">25% · Trade</span></span>
          </span>
          <span className="tc-face tc-back">
            <span className="tc-sheen" aria-hidden="true"></span>
            <span className="tc-strip" aria-hidden="true"></span>
            <span className="tc-benefits">
              <span><b className="foil">25%</b>off retail on every piece</span>
              <span><b className="foil">+3–5%</b>project pricing over $10,000 and $25,000</span>
              <span><b className="foil">12%</b>commission on client orders</span>
              <span><b className="foil">$100</b>credit for every referral</span>
            </span>
            <span className="tc-meta"><span>Sourcing on request</span><span>Tax-exempt with a resale certificate</span></span>
          </span>
        </button>
        <i className="tc-floor" aria-hidden="true"></i>
        <span className="tc-hint">${flip?'Tap to turn back':'Your digital trade pass. It appears in your account the moment you are approved. Nothing to print or mail.'}</span>
      </div>
    </div>
  </section>`;
}

function Home({ctx}){
  // The opening film renders first; the sections below it follow as a background render once
  // the browser is idle, in short slices, so taking over from the HTML hero stays light.
  const [below,setBelow]=useState(false);
  useEffect(()=>{const ric=window.requestIdleCallback||(f=>setTimeout(f,200));const id=ric(()=>startTransition(()=>setBelow(true)),{timeout:1500});return()=>(window.cancelIdleCallback||clearTimeout)(id)},[]);
  return html`<main className="home">
    <${HeroSwitch} ctx=${ctx}/>
    ${below&&html`<${BelowFilm} ctx=${ctx}/>`}
  </main>`;
}

function BelowFilm({ctx}){
  return html`<${React.Fragment}>
    <${StartRoom} ctx=${ctx}/>
    <${RoomsWeLove} ctx=${ctx}/>
    <${Collection} ctx=${ctx}/>
    <${QuoteShow} ctx=${ctx}/>
    <${TradeBand} ctx=${ctx}/>
    <${Footer} ctx=${ctx}/>
  </${React.Fragment}>`;
}

function Footer({ctx}){
  const [e,setE]=useState('');const [ok,setOk]=useState(false);
  return html`<footer className="wrap">
    <div><span className="logo"><b>House of Louie Mae</b></span><p className="mute" style=${{marginTop:10,maxWidth:'36ch',fontSize:14}}>The trade and partner floor of Louie Mae. Furniture for cafés, restaurants, bars, workspaces and model homes.</p>
      <form onSubmit=${ev=>{ev.preventDefault();if(e.includes('@'))setOk(true)}} className="row" style=${{marginTop:16,maxWidth:360}}>${ok?html`<span style=${{fontSize:14}}>${I('check',{width:16})} You're on the list for new arrivals.</span>`:html`<input className="field" style=${{height:40}} type="email" placeholder="Work email" aria-label="Work email" value=${e} onInput=${x=>setE(x.target.value)}/><button className="btn btn-ink btn-sm">Join</button>`}</form></div>
    <div><h2>Shop</h2>${['discover','studio','room','quiz'].map(r=>html`<button key=${r} onClick=${()=>ctx.go(r)}>${MENU.find(m=>m[0]===r)[1]}</button>`)}</div>
    <div><h2>Trade</h2><button onClick=${()=>ctx.go('trade')}>Apply</button><button onClick=${()=>ctx.go('hub')}>Your quotes</button><button onClick=${()=>ctx.setTray(true)}>Project tray</button></div>
    <div><h2>You</h2><button onClick=${()=>ctx.go('profile')}>Profile</button><button onClick=${()=>ctx.go('account')}>Account</button></div>
  </footer>`;
}

/* ================= DISCOVER / SEARCH ================= */
function Discover({ctx}){
  const [q,setQ]=useState(ctx.query);const [type,setType]=useState('all');const [mats,setMats]=useState([]);const [tones,setTones]=useState([]);const [max,setMax]=useState(3300);const [stock,setStock]=useState(false);const [dens,setDens]=useState('normal');const [more,setMore]=useState(false);const [sort,setSort]=useState('rel');
  useEffect(()=>setQ(ctx.query),[ctx.query]);
  const TONES=[['Cognac','#A0612F'],['Tan','#B07A4A'],['Espresso','#6B4A33'],['Olive','#5E6338'],['Ivory','#E7DFD0'],['Stone','#CFCBC4'],['Black','#2A2522'],['Brass','#B58D52']];
  const fileRef=useRef();
  let list=q.trim()?matchPrompt(q):[...PRODUCTS];
  if(q.trim()&&!list.length)list=PRODUCTS.filter(p=>(p.name+' '+p.line).toLowerCase().includes(q.toLowerCase()));
  if(ctx.imgQ)list=[...PRODUCTS].sort((a,b)=>Math.min(...ctx.imgQ.pal.map(c=>cdist(c,a.tone)))-Math.min(...ctx.imgQ.pal.map(c=>cdist(c,b.tone))));
  if(type!=='all')list=list.filter(p=>p.type===type);
  if(mats.length)list=list.filter(p=>mats.includes(p.mat));
  if(tones.length)list=list.filter(p=>tones.some(t=>cdist(t,p.tone)<48));
  list=list.filter(p=>p.price<=max);
  if(stock)list=list.filter(p=>!p.oos);
  if(sort==='lo')list=[...list].sort((a,b)=>a.price-b.price);
  if(sort==='hi')list=[...list].sort((a,b)=>b.price-a.price);
  const tog=(arr,set,v)=>set(arr.includes(v)?arr.filter(x=>x!==v):[...arr,v]);
  const searching=q.trim()||ctx.imgQ;
  return html`<main className="wrap">
    <div className="ph-head"><div><span className="eyebrow">Discover</span><h1>${searching?html`Results${q.trim()?html` for <em>${q}</em>`:''}`:html`Find the piece, <em>then the room.</em>`}</h1></div>
      <form className="search" style=${{maxWidth:520,margin:0,flex:'1 1 320px',display:'flex'}} onSubmit=${e=>{e.preventDefault();ctx.setQuery(q);ctx.setImgQ(null)}}>${I('search')}<input aria-label="Search" value=${q} onInput=${e=>setQ(e.target.value)} placeholder="Search by piece, material, color or space"/>
        <button type="button" className="ib" aria-label="Search with a photo" onClick=${()=>fileRef.current.click()}>${I('cam')}</button>
        <input ref=${fileRef} type="file" accept="image/*" hidden onChange=${e=>{const f=e.target.files[0];if(f)ctx.imageSearch(f);e.target.value=''}}/></form>
    </div>
    ${ctx.imgQ&&html`<div className="img-q"><img src=${ctx.imgQ.src} alt="Your photo"/><div style=${{flex:1,minWidth:200}}><b style=${{fontWeight:500}}>Matched to the tones in your photo</b><div className="row" style=${{marginTop:6,gap:6}}>${ctx.imgQ.pal.map(c=>html`<button key=${c} className="dot" style=${{width:26,height:26,background:c}} title=${'Filter by '+c} onClick=${()=>tog(tones,setTones,c)}></button>`)}<span className="mono mute" style=${{marginLeft:6}}>Tap a tone to narrow</span></div></div><button className="btn btn-line btn-sm" onClick=${()=>ctx.setImgQ(null)}>Clear photo</button></div>`}
    ${!searching&&html`<div className="trend-row">${TRENDS.map(t=>html`<button key=${t.id} className="trend" onClick=${()=>{ctx.setTrend(t.id);ctx.go('trend')}}><img src=${byId(t.img).img} alt="" loading="lazy"/><div><span className="up">Trending · ${t.up}</span><h2>${t.name}</h2></div></button>`)}</div>`}
    <div className="filters">
      <div className="scroll-x">${[['all','Everything'],...Object.entries(TYPE)].map(([k,l])=>html`<button key=${k} className=${'chip'+(type===k?' on':'')} onClick=${()=>setType(k)}>${l}</button>`)}</div>
      <span style=${{flex:1}}></span>
      <button className=${"chip"+(more?" on":"")} onClick=${()=>setMore(!more)} aria-expanded=${more}>Filters${(mats.length+tones.length+(stock?1:0)+(max<3300?1:0))?" · "+(mats.length+tones.length+(stock?1:0)+(max<3300?1:0)):""}</button>
      <select className="field" style=${{height:34,width:'auto',borderRadius:999,fontSize:13}} value=${sort} onChange=${e=>setSort(e.target.value)} aria-label="Sort"><option value="rel">Most relevant</option><option value="lo">Price, low to high</option><option value="hi">Price, high to low</option></select>
    </div>
    ${more&&html`<div className="filters filters-more">            ${Object.entries(MAT).map(([k,l])=>html`<button key=${k} className=${'chip'+(mats.includes(k)?' on':'')} onClick=${()=>tog(mats,setMats,k)}>${l}</button>`)}
            <div className="swatches" role="group" aria-label="Color palette">${TONES.map(([n,c])=>html`<button key=${c} className=${tones.includes(c)?'on':''} style=${{background:c,width:26,height:26}} title=${n} aria-label=${n} aria-pressed=${tones.includes(c)} onClick=${()=>tog(tones,setTones,c)}></button>`)}</div>
            <label className="row" style=${{fontSize:13,gap:8}}>Up to <b className="num" style=${{fontWeight:500,minWidth:56}}>${fmt(max)}</b><input type="range" min="300" max="3300" step="50" value=${max} onInput=${e=>setMax(+e.target.value)} style=${{width:120}} aria-label="Maximum price"/></label>
      <button className="toggle" style=${{fontSize:13}} onClick=${()=>setStock(!stock)} aria-pressed=${stock}><span className=${'sw'+(stock?' on':'')}></span> In stock</button>
</div>`}
    <p className="mono mute" style=${{marginBottom:14}}>${list.length} piece${list.length===1?'':'s'}</p>
    ${list.length<6&&html`<div className="sr-cta"><span><b>Not seeing the right piece?</b><br/><span className="mute" style=${{fontSize:14}}>Trade and partner accounts can ask us to source it, and earn commission when it sells.</span></span><button className="btn btn-ink btn-sm" onClick=${()=>ctx.go('sourcing')}>Request sourcing</button></div>`}
    ${list.length?html`<${Wall} items=${list} ctx=${ctx} density=${dens} mixBoards=${searching?null:COMMUNITY}/>`:html`<div className="empty"><h3>Nothing matches all of that</h3><p>Try removing a material or raising the price limit.</p><button className="btn btn-line" onClick=${()=>{setMats([]);setTones([]);setType('all');setMax(3300);setStock(false)}}>Clear filters</button></div>`}
  </main>`;
}
function Trend({ctx}){
  const t=TRENDS.find(x=>x.id===ctx.trend)||TRENDS[0];
  return html`<main className="wrap">
    <div className="ph-head"><div><button className="btn btn-line btn-sm" onClick=${()=>ctx.go('discover')}>${I('back',{width:15})} Discover</button><span className="eyebrow" style=${{marginTop:20}}>Trend · ${t.up} this month (sample)</span><h1><em>${t.name}</em></h1><p className="mute" style=${{maxWidth:'60ch',marginTop:14,fontSize:16}}>${t.copy}</p></div>
      <div className="row"><button className="btn btn-ink" onClick=${()=>ctx.toStudio(t.ids.slice(0,5),t.name)}>${I('brush',{width:16})} Build with this trend</button></div></div>
    <div className="filters"><span className="mono mute">Related searches</span>${TRENDS.filter(x=>x!==t).map(x=>html`<button key=${x.id} className="chip" onClick=${()=>ctx.setTrend(x.id)}>${x.name}</button>`)}</div>
    <${Wall} items=${t.ids.map(byId)} ctx=${ctx}/>
  </main>`;
}

/* ================= PIN DETAIL ================= */
/* ================= TRAY (cart) ================= */
/* ================= shared v3 helpers ================= */
const APPROX_CM={1:245,2:235,3:250,4:240,5:300,6:300,7:290,8:46,9:80,10:88,11:64,12:100,13:150,14:85,15:70,16:80,17:270,18:135,19:130,20:150,21:150,22:122,23:110,24:125};
const approxH=id=>{const a=CUT_AR[id];return Math.round(APPROX_CM[id]*a[1]/a[0])};
const inch=cm=>Math.round(cm/2.54);
const CARE={
  leather:['Dust weekly with a dry, soft cloth.','Blot spills straight away; never rub.','Condition every 6 to 12 months.','Keep out of direct sun to slow fading.'],
  velvet:['Vacuum with a soft brush attachment.','Brush the pile in one direction to refresh it.','Blot spills, then let air dry.','Rotate cushions for even wear.'],
  boucle:['Vacuum gently with a brush attachment.','Snip loose loops; never pull them.','Spot clean with a mild solution, testing first.','Rotate cushions for even wear.'],
  rattan:['Dust with a soft brush.','Wipe with a damp cloth and let it dry fully.','Keep away from heaters and high humidity.'],
  brass:['Wipe with a soft dry cloth.','Avoid abrasive cleaners.','Buff fingerprints with microfiber.'],
};
const CAT_OF={sofa:'Seating',sectional:'Seating',bench:'Seating',ottoman:'Seating',lighting:'Lighting'};
// Project pricing on a project's trade subtotal: extra 3% over $10,000, extra 5% over $25,000. The server also holds every piece above its margin floor.
const PROJECT_TIERS=[[10000,.03],[25000,.05]];
const tierOf=t=>{let rate=0;for(const [m,b] of PROJECT_TIERS)if(t>=m)rate=b;const next=PROJECT_TIERS.find(([m])=>t<m)||null;return {rate,next}};
const pct=r=>Math.round(r*100)+'%';
// One flat delivery fee per order, tiered by subtotal (dollars in, dollars out).
const deliveryOf=sub=>deliveryCents(Math.round(sub*100))/100;
const deliveryText=()=>DELIVERY_TIERS.map((t,i)=>(t.underCents===Infinity?fmt(DELIVERY_TIERS[i-1].underCents/100)+'+':'under '+fmt(t.underCents/100))+' '+fmt(t.feeCents/100,t.feeCents%100>0)).join(' · ');
const tierLine=(t,name)=>{const {rate,next}=tierOf(t);return next?(rate?`Extra ${pct(rate)} unlocked. ${fmt(next[0]-t)} more reaches ${pct(next[1])}.`:`${fmt(next[0]-t)} more in trade${name?' in '+name:''} unlocks an extra ${pct(next[1])}.`):`Top project pricing unlocked: an extra ${pct(rate)}.`};
function pairsFor(p,n=3){
  const want=p.type==='lighting'?['sofa','sectional','bench','ottoman']:p.type==='ottoman'?['sofa','sectional','bench','lighting']:['ottoman','lighting','bench'];
  const picked=[];want.forEach(t=>{const c=PRODUCTS.filter(x=>x.type===t&&x.id!==p.id&&!picked.includes(x)).sort((a,b)=>(a.mat===p.mat?-40:0)+cdist(a.tone,p.tone)-((b.mat===p.mat?-40:0)+cdist(b.tone,p.tone)))[0];if(c&&picked.length<n)picked.push(c)});
  return picked;
}
function useClock(){const [t,setT]=useState(()=>new Date());useEffect(()=>{const i=setInterval(()=>setT(new Date()),15000);return()=>clearInterval(i)},[]);return t}

/* ================= MENU v3: The Index ================= */
function IndexMenu({ctx}){
  const now=useClock();
  const counts=Object.fromEntries(Object.keys(TYPE).map(k=>[k,PRODUCTS.filter(p=>p.type===k).length]));
  const NAV=[
    {r:'home',l:'The Floor',d:'Rooms by business',img:2,cut:2,sub:SPACE_KEYS.map(k=>({l:SPACES[k].label,n:ROOMS[k].scenes.length+' rooms',go:()=>{ctx.setSpace(k);ctx.go('home')}}))},
    {r:'discover',l:'Discover',d:PRODUCTS.length+' pieces',img:7,cut:7,sub:Object.entries(TYPE).map(([k,v])=>({l:v,n:counts[k],cut:PRODUCTS.find(p=>p.type===k).id,go:()=>{ctx.setQuery(k);ctx.setImgQ(null);ctx.go('discover')}}))},
    {r:'studio',l:'Studio',d:'Collage & room',img:13,cut:13,sub:[{l:'New collage',go:()=>ctx.toStudio([2,12,9],'New collage')},{l:'Compose from a mood',go:()=>{ctx.setStudioSeed({prompt:'cognac leather and rattan for a café'});ctx.go('studio')}},{l:'Use a photo of my space',go:()=>ctx.go('studio')}]},
    {r:'room',l:'Space Planner',d:'Plan · model · render',img:5,cut:5},
    {r:'boards',l:'Boards',d:ctx.boards.length+' boards',img:12,cut:12,sub:ctx.boards.slice(0,4).map(b=>({l:b.title,n:b.pins.length,go:()=>{ctx.setBoard(b.id);ctx.go('board')}}))},
    {r:'inspo',l:'My Inspo',d:ctx.inspo.length+' images',img:4,cut:4},
    {r:'hub',l:'Your quotes',d:'Quotes, client links, trade pass',img:17,cut:17},
    {r:'trade',l:'Trade Account',d:'Verified',img:3,cut:3},
    {r:'sourcing',l:'Sourcing',d:'We find it for you',img:9,cut:9},
    {r:'quiz',l:'Style Quiz',d:'Find your blend',img:21,cut:21},
  ];
  const [hi,setHi]=useState(0);const [sub,setSub]=useState(null);const [q,setQ]=useState('');const refs=useRef([]);
  const H=NAV[hi];const cutId=sub!=null&&H.sub&&H.sub[sub]&&H.sub[sub].cut?H.sub[sub].cut:H.cut;
  const close=()=>ctx.setMenu(false);const run=fn=>{close();fn()};
  useEffect(()=>{refs.current[0]?.focus();const k=e=>{if(e.key==='Escape')close();if(document.activeElement?.tagName==='INPUT')return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setHi(h=>{const n=(h+(e.key==='ArrowDown'?1:-1)+NAV.length)%NAV.length;refs.current[n]?.focus();return n});setSub(null)}};addEventListener('keydown',k);return()=>removeEventListener('keydown',k)},[]);
  const P=ctx.activeProject;const items=P.items.map(i=>({...i,p:byId(i.pid)}));const seats=items.reduce((s,i)=>s+i.p.seats*i.qty,0);const tot=items.reduce((s,i)=>s+pr(i.p,ctx.mode)*i.qty,0);
  return html`<div className="ix" role="dialog" aria-modal="true" aria-label="Site index">
    <div className="ix-top"><span className="logo"><b>House of Louie Mae</b></span><span className="mono ix-dim">Index</span><button className="ix-close" onClick=${close} aria-label="Close menu">Close ${I('x',{width:16})}</button></div>
    <div className="ix-grid">
      <nav className="ix-nav" aria-label="Sections">
        ${NAV.map((n,i)=>html`<div key=${n.r} className=${'ix-item'+(i===hi?' on':'')} onMouseEnter=${()=>{setHi(i);setSub(null)}}>
          <button ref=${el=>refs.current[i]=el} className="ix-link" onFocus=${()=>{setHi(i);setSub(null)}} onClick=${()=>run(()=>ctx.go(n.r))}><b>${n.l}</b><span>${n.d}</span></button>
          ${n.sub&&i===hi&&html`<div className="ix-sub">${n.sub.map((s,j)=>html`<button key=${j} onMouseEnter=${()=>setSub(j)} onFocus=${()=>setSub(j)} onClick=${()=>run(s.go)}>${s.l}${s.n!=null&&html`<sup>${s.n}</sup>`}</button>`)}</div>`}
        </div>`)}
      </nav>
      <div className="ix-preview" aria-hidden="true">
        <img key=${'bg'+H.img} className="ix-bgimg" src=${byId(H.img).img} alt=""/>
        <div className="ix-veil"></div>
        <img key=${'c'+cutId} className="ix-cut" src=${cut(cutId)} alt=""/>
        <div className="ix-shadow"></div>
        <div className="ix-cap"><span className="mono">${String(hi+1).padStart(2,'0')} / ${String(NAV.length).padStart(2,'0')}</span><b>${sub!=null&&H.sub?H.sub[sub].l:H.l}</b><span>${byId(cutId).name} · ${byId(cutId).line}</span></div>
      </div>
      <aside className="ix-side">
        <form className="ix-search" onSubmit=${e=>{e.preventDefault();run(()=>{ctx.setQuery(q);ctx.setImgQ(null);ctx.go('discover')})}}>${I('search',{width:17})}<input aria-label="Search the House" placeholder="Search pieces, materials, rooms" value=${q} onInput=${e=>setQ(e.target.value)}/></form>
        <button className="ix-card" onClick=${()=>run(()=>ctx.setTray(true))}>
          <span className="mono ix-dim">Active project</span><b>${P.name}</b>
          <div className="ix-thumbs">${items.slice(0,5).map(i=>html`<span key=${i.pid} style=${{backgroundImage:`url(${cut(i.pid)})`}}></span>`)}</div>
          <div className="ix-meter"><i style=${{width:Math.min(100,seats/P.target*100)+'%'}}></i></div>
          <span className="ix-row"><span>${seats} of ${P.target} seats</span><span className="mono">${fmt(tot)}</span></span>
        </button>
        ${ctx.recent.length>0&&html`<div><span className="mono ix-dim">Recently viewed</span><div className="ix-recent">${ctx.recent.slice(0,6).map(id=>html`<button key=${id} onClick=${()=>{close();ctx.openPin(id)}} title=${byId(id).name}><img src=${cut(id)} alt=${byId(id).name}/></button>`)}</div></div>`}
        <div><span className="mono ix-dim">Furnishing</span><div className="ix-chips">${SPACE_KEYS.map(k=>html`<button key=${k} className=${k===ctx.space?'on':''} onClick=${()=>ctx.setSpace(k)}>${SPACES[k].label}</button>`)}</div></div>
        ${ctx.me.verified?html`<div className="ix-trade"><span><b>${ctx.me.businessName||ctx.me.displayName}</b><small>Trade verified · show prices as</small></span><div className="ix-seg" role="group" aria-label="Show prices as"><button className=${ctx.mode==='trade'?'on':''} onClick=${()=>ctx.setMode('trade')}>Trade</button><button className=${ctx.mode==='retail'?'on':''} onClick=${()=>ctx.setMode('retail')}>Retail</button></div></div>`:html`<button className="ix-card" onClick=${()=>run(()=>ctx.go('trade'))}><span className="mono ix-dim">Trade pricing</span><b>${ctx.me.tradeStatus==='pending'?'Your application is in review':'Apply for trade pricing'}</b><span className="ix-row"><span>25% off retail for verified businesses</span></span></button>`}
        <a className="ix-retail" href="https://www.louiemae.com">Shopping for your home? Louie Mae retail ${I('arrow',{width:14})}</a>
        
      </aside>
    </div>
    <div className="ix-foot"><span className="mono">House of Louie Mae · ${now.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</span><span className="mono ix-dim hide-sm">↑ ↓ to move · Enter to open · Esc to close</span><span className="row"><button onClick=${()=>run(()=>ctx.go('account'))}>Account</button><button onClick=${()=>run(()=>ctx.go('profile'))}>Profile</button>${ctx.me.signedIn?html`<button onClick=${()=>run(ctx.signOut)}>Log out</button>`:html`<button onClick=${()=>run(()=>ctx.go('welcome'))}>Sign in</button>`}</span></div>
  </div>`;
}

/* ================= PRODUCT PAGE v3 ================= */
function PinDetail({ctx}){
  const p=byId(ctx.pin);const idx=PRODUCTS.findIndex(x=>x.id===p.id);
  const [view,setView]=useState('studio');const [bd,setBd]=useState('#ECE3D5');const [scale,setScale]=useState(false);
  const [qty,setQty]=useState(1);const [proj,setProj]=useState(ctx.tray.active);const [zone,setZone]=useState('');
  const [save,setSave]=useState(false);const [open,setOpen]=useState('details');const [zip,setZip]=useState('');const [zipMsg,setZipMsg]=useState('');
  const [simF,setSimF]=useState('tone');const [bundle,setBundle]=useState([]);const [mini,setMini]=useState(false);const [loupe,setLoupe]=useState(null);const [tilt,setTilt]=useState([0,0]);
  
  const scRef=useRef(),addRef=useRef(),stageRef=useRef();
  const P=ctx.tray.projects.find(x=>x.id===proj)||ctx.tray.projects[0];const Z=zone||P.zones[0];
  const pairs=useMemo(()=>pairsFor(p,3),[p.id]);
  useEffect(()=>{setQty(1);setBundle(pairs.map(x=>x.id));setView('studio');setScale(false);scRef.current&&scRef.current.scrollTo(0,0)},[p.id]);
  useEffect(()=>{const k=e=>{if(document.activeElement&&['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;if(e.key==='Escape')ctx.openPin(null);if(e.key==='ArrowRight')ctx.openPin(PRODUCTS[(idx+1)%PRODUCTS.length].id);if(e.key==='ArrowLeft')ctx.openPin(PRODUCTS[(idx-1+PRODUCTS.length)%PRODUCTS.length].id)};addEventListener('keydown',k);return()=>removeEventListener('keydown',k)},[idx]);
  useEffect(()=>{const el=addRef.current,root=scRef.current;if(!el||!root)return;const io=new IntersectionObserver(([e])=>setMini(!e.isIntersecting&&e.boundingClientRect.top<0),{root});io.observe(el);return()=>io.disconnect()},[p.id]);
  const liked=ctx.likes.includes(p.id);const unit=pr(p,ctx.mode);
  const sim=PRODUCTS.filter(x=>x.id!==p.id).filter(x=>simF==='mat'?x.mat===p.mat:simF==='type'?x.type===p.type:true).sort((a,b)=>simF==='tone'?cdist(a.tone,p.tone)-cdist(b.tone,p.tone):0).slice(0,8);
  const onBoards=[...ctx.boards.filter(b=>b.pins.some(x=>x.pid===p.id)).map(b=>({t:b.title,by:'You'})),...COMMUNITY.filter(b=>b.items.includes(p.id)).map(b=>({t:b.title,by:b.by}))];
  const room=ROOMS[ctx.space];const F=texture(room.floor);const L=texture('lime');
  const cm=APPROX_CM[p.id],hcm=approxH(p.id);
  const projTrade=P.items.reduce((s,i)=>s+tp(byId(i.pid))*i.qty,0);const after=projTrade+tp(p)*qty;
  const add=(el)=>{ctx.addToProject(p.id,qty,P.id,Z,el||stageRef.current?.querySelector('.pp-cut'))};
  const bundleItems=bundle.map(byId);const bundleTot=bundleItems.reduce((s,x)=>s+pr(x,ctx.mode),0);
  const onTilt=e=>{const r=e.currentTarget.getBoundingClientRect();setTilt([((e.clientX-r.left)/r.width-.5)*10,((e.clientY-r.top)/r.height-.5)*-6])};
  const onLoupe=e=>{const r=e.currentTarget.getBoundingClientRect();setLoupe({x:e.clientX-r.left,y:e.clientY-r.top,w:r.width,h:r.height})};
  const ACC=[
    ['details','Details & materials',html`<p>${p.note}</p><dl className="specs" style=${{marginTop:12}}><div><dt>Material</dt><dd>${MAT[p.mat]}</dd></div><div><dt>Seats</dt><dd>${p.seats||'n/a'}</dd></div><div><dt>Approx. width</dt><dd>${cm} cm · ${inch(cm)} in</dd></div><div><dt>SKU</dt><dd className="mono" style=${{textTransform:'none'}}>${p.sku}</dd></div></dl><p className="help">Dimensions are visual estimates for planning. The spec sheet sent with your quote has exact measurements.</p>`],
    ['care','Care & durability',html`<ul className="pp-list">${(CARE[p.mat]||[]).map(t=>html`<li key=${t}>${t}</li>`)}</ul>`],
    ['contract','Commercial use',html`<p>Planning heavy daily use in a café, restaurant or lobby? Ask about contract-grade upholstery, flame-code compliance for your city, and replacement cushion cores. We confirm what's available for this piece with your quote.</p>`],
    ['delivery','Delivery & receiving',html`<ul className="pp-list"><li><b>White glove:</b> placed in the room, packaging removed.</li><li><b>Threshold:</b> delivered inside the first door.</li><li><b>Commercial dock:</b> scheduled with your receiving hours.</li></ul><p className="help">Lead time and delivery cost are confirmed with your quote before payment.</p>`],
    ['terms','Trade terms',html`<p>Trade pricing applies to verified businesses. Sales tax is charged unless a valid resale or exemption certificate is on file. Payment is due once you approve the final quote.</p>`],
  ];
  return html`<div className="pp" ref=${scRef} role="dialog" aria-modal="true" aria-label=${p.name+' '+p.line}>
    <header className="pp-bar">
      <button className="pp-back" onClick=${()=>ctx.openPin(null)}>${I('back',{width:16})} <span className="hide-sm">Back to the floor</span></button>
      <span className="pp-crumb mono hide-sm">${CAT_OF[p.type]} / ${TYPE[p.type]} / ${p.name}</span>
      <span className="row" style=${{gap:4}}>
        <button className="ib" aria-label="Previous piece" title="Previous (←)" onClick=${()=>ctx.openPin(PRODUCTS[(idx-1+PRODUCTS.length)%PRODUCTS.length].id)}>${I('back')}</button>
        <span className="mono ix-dim num">${String(idx+1).padStart(2,'0')} / ${PRODUCTS.length}</span>
        <button className="ib" aria-label="Next piece" title="Next (→)" onClick=${()=>ctx.openPin(PRODUCTS[(idx+1)%PRODUCTS.length].id)}>${I('arrow')}</button>
        <button className="ib" aria-label="Close" onClick=${()=>ctx.openPin(null)}>${I('x')}</button>
      </span>
    </header>
    <div className="pp-grid">
      <section className="pp-stage" ref=${stageRef}>
        <div className="pp-views" role="tablist">${[['studio','Studio'],['room','In a '+SPACES[ctx.space].label.toLowerCase()],['photo','Photo & detail']].map(([k,l])=>html`<button key=${k} role="tab" aria-selected=${view===k} className=${view===k?'on':''} onClick=${()=>setView(k)}>${l}</button>`)}</div>
        ${view==='studio'&&html`<div className="pp-set" style=${{background:`radial-gradient(ellipse 80% 70% at 50% 42%, color-mix(in srgb, ${bd} 70%, #fff), ${bd})`}} onPointerMove=${onTilt} onPointerLeave=${()=>setTilt([0,0])}>
          <div className="pp-floorline" style=${{background:`linear-gradient(180deg, transparent, color-mix(in srgb, ${bd} 80%, #000) )`}}></div>
          <div className="pp-obj" style=${{width:p.type==='lighting'?'34%':['sofa','sectional'].includes(p.type)?'78%':'56%',transform:`perspective(1200px) translateX(${scale&&cm>=120?-10:0}%) rotateY(${tilt[0]}deg) rotateX(${tilt[1]}deg)`}}>
            <img className="pp-cut" src=${cut(p.id)} alt=${p.name+' '+p.line}/>
            <span className="pp-contact"></span>
            ${scale&&html`<div className="pp-dim"><i></i><span>≈ ${cm} cm · ${inch(cm)} in</span><i></i></div>`}${scale&&cm>=120&&html`<div className="pp-human" style=${{width:(40/cm*100)+'%'}} title="1.75 m person for scale"><svg viewBox="0 0 40 175"><circle cx="20" cy="12" r="10"/><path d="M8 30h24l4 60h-8l-2 85h-8l-2-60-2 60h-8l-2-85H4z"/></svg><span>1.75 m</span></div>`}
          </div>
          
          <div className="pp-setbar">
            <div className="swatches" role="group" aria-label="Backdrop">${[['Plaster','#ECE3D5'],['Limewash','#F4EFE6'],['Olive','#6C6948'],['Cognac','#9A5A2E'],['Espresso','#2B211A']].map(([n,col])=>html`<button key=${col} title=${n} aria-label=${n+' backdrop'} className=${bd===col?'on':''} style=${{background:col,width:24,height:24}} onClick=${()=>setBd(col)}></button>`)}</div>
            <button className=${'chip'+(scale?' on':'')} onClick=${()=>setScale(!scale)}>${I('frame',{width:14})} Scale</button>
          </div>
        </div>`}
        ${view==='room'&&html`<div className="pp-set roomset">
          <div className="pp-rwall" style=${{backgroundColor:room.wall,backgroundImage:room.arch==='bar'?'none':`url(${L.url})`,backgroundBlendMode:'multiply'}}></div>
          <div className="rh-floor" style=${{top:'62%'}}><div className="rh-plane" style=${{backgroundImage:`url(${F.url})`,backgroundSize:F.size}}></div><span className="rh-floorshade"></span></div>
          <div className="pp-obj inroom" style=${{width:p.type==='lighting'?'26%':['sofa','sectional'].includes(p.type)?'64%':'40%',top:p.type==='lighting'?'0':'auto'}}><img className="pp-cut" src=${cut(p.id)} alt=${p.name}/>${p.type!=='lighting'&&html`<span className="pp-contact"></span>`}</div>
          <span className="pp-roomcap mono">${SPACES[ctx.space].label} set · change the space from the header</span>
        </div>`}
        ${view==='photo'&&html`<div className="pp-set photo" onPointerMove=${onLoupe} onPointerLeave=${()=>setLoupe(null)}>
          <img src=${p.img} alt=${p.name+' in a room'}/>
          ${loupe&&html`<span className="pp-loupe" style=${{left:loupe.x,top:loupe.y,backgroundImage:`url(${p.img})`,backgroundSize:`${loupe.w*2.6}px ${loupe.h*2.6}px`,backgroundPosition:`${-loupe.x*2.6+90}px ${-loupe.y*2.6+90}px`}}></span>`}
          <span className="pp-roomcap mono">Move over the photo to see the ${MAT[p.mat].toLowerCase()} up close</span>
        </div>`}
      </section>

      <aside className="pp-panel">
        <span className="mono ix-dim">${p.sku} · ${TYPE[p.type].replace(/s$/,'')} · ${MAT[p.mat]}</span>
        <h1>${p.name}</h1><p className="pp-line">${p.line}</p>
        <div className="pp-price">
          <b className="num">${fmt(unit,true)}</b>
          ${ctx.mode==='trade'?html`<span className="mono">MSRP ${fmt(p.price,true)}</span><span className="save-pill">Trade · save ${fmt(p.price-unit)}</span>`:html`<button className="lnk" onClick=${()=>ctx.go('trade')}>${ctx.me.tradeStatus==='pending'?'Trade pricing unlocks after approval':'Trade price after verification'}</button>`}
        </div>
        ${p.oos&&html`<div className="note">${I('pin',{width:18})}<span>Out of stock at the supplier. Add it to a project and we'll confirm restock timing with your quote.</span></div>`}

        <div className="pp-block">
          <span className="pp-lbl">Finish</span>
          <div className="row" style=${{flexWrap:'wrap',gap:8}}>
            <span className="pp-swatch on"><i style=${{background:p.tone}}></i>${MAT[p.mat]} · as shown</span>
            <button className="pp-swatch" onClick=${()=>ctx.toast('COM request noted. We confirm feasibility and yardage with your quote.')}><i style=${{background:'repeating-linear-gradient(45deg,#ccc 0 3px,#eee 3px 6px)'}}></i>Customer's own material</button>
          </div>
          <button className="lnk" onClick=${()=>ctx.go('sourcing')}>Need a different size, finish or piece? Request sourcing</button>
        </div>

        <div className="pp-block">
          <span className="pp-lbl">Quantity</span>
          <div className="row" style=${{flexWrap:'wrap',gap:8}}>
            <div className="qty"><button onClick=${()=>setQty(Math.max(1,qty-1))} aria-label="Fewer">−</button><span>${qty}</span><button onClick=${()=>setQty(qty+1)} aria-label="More">+</button></div>
            ${[2,4,8,12].map(n=>html`<button key=${n} className=${'chip'+(qty===n?' on':'')} onClick=${()=>setQty(n)}>×${n}</button>`)}
          </div>
          <div className="pp-math"><span>${p.seats?`${p.seats*qty} seats`:'Lighting'}</span><span>·</span><span className="num">${fmt(unit*qty)} ${ctx.mode}</span></div>
        </div>

        <div className="pp-block">
          <span className="pp-lbl">Add to</span>
          <div className="g2f" style=${{gap:8}}>
            <select className="field" aria-label="Project" value=${P.id} onChange=${e=>{if(e.target.value==='__new'){const n=prompt('Name the new project');if(n&&n.trim()){const id=ctx.createProject(n.trim());setProj(id);setZone('')}return}setProj(e.target.value);setZone('')}}>${ctx.tray.projects.map(x=>html`<option key=${x.id} value=${x.id}>${x.name}</option>`)}<option value="__new">+ New project…</option></select>
            <select className="field" aria-label="Area" value=${Z} onChange=${e=>{if(e.target.value==='__new'){const n=prompt('Name the new area, e.g. Patio or Bar');if(n&&n.trim()){ctx.addZone(P.id,n.trim());setZone(n.trim())}return}setZone(e.target.value)}}>${P.zones.map(z=>html`<option key=${z}>${z}</option>`)}<option value="__new">+ New area…</option></select>
          </div>
          <button ref=${addRef} className="btn btn-ink btn-lg pp-add" onClick=${e=>add()}>${I('tray',{width:18})} Add ${qty>1?qty+' ':''}to ${P.name}</button>
          <div className="pp-tier"><div className="ix-meter"><i style=${{width:Math.min(100,after/(tierOf(after).next||PROJECT_TIERS[PROJECT_TIERS.length-1])[0]*100)+'%'}}></i></div><span>${tierLine(after,P.name)}</span></div>
          <div className="row pp-acts">
            <span style=${{position:'relative'}}><button className="btn btn-line btn-sm" onClick=${()=>setSave(!save)}>${I('pin',{width:15})} Save</button>${save&&html`<${SaveMenu} ctx=${ctx} pid=${p.id} align="left" onDone=${()=>setSave(false)}/>`}</span>
            <button className="btn btn-line btn-sm" onClick=${()=>ctx.toStudio([p.id])}>${I('brush',{width:15})} Studio</button>
            <button className="btn btn-line btn-sm" onClick=${()=>{ctx.setRoomSeed([p.id]);ctx.openPin(null);ctx.go('room')}}>${I('cube',{width:15})} 3D</button>
            <button className="ib" aria-pressed=${liked} aria-label="Like" onClick=${()=>ctx.toggleLike(p.id)} style=${{color:liked?'var(--cognac)':''}}>${I('heart',liked?{fill:'currentColor'}:{})}</button>
            <button className="ib" aria-label="Copy link" onClick=${()=>copyText(location.origin+'/trade#p/'+p.id,ctx.toast)}>${I('share')}</button>
            <a className="ib" aria-label="Save to Pinterest" href=${pinItUrl(p.img,p.name+' '+p.line+' · Louie Mae')} target="_blank" rel="noopener">${I('pint')}</a>
          </div>
        </div>

        <form className="pp-block pp-zip" onSubmit=${e=>{e.preventDefault();setZipMsg(/^\d{5}$/.test(zip)?`We deliver to ${zip}. One flat fee per order: ${deliveryText()}.`:'Enter a 5-digit ZIP code.')}}>
          <span className="pp-lbl">Delivering to</span>
          <div className="row" style=${{gap:6}}><input className="field" style=${{height:40}} inputMode="numeric" maxLength="5" placeholder="ZIP code" aria-label="Delivery ZIP code" value=${zip} onInput=${e=>setZip(e.target.value.replace(/\D/g,''))}/><button className="btn btn-line btn-sm">Check</button></div>
          ${zipMsg&&html`<p className="help">${zipMsg}</p>`}
        </form>

        ${onBoards.length>0&&html`<div className="pp-block"><span className="pp-lbl">Saved on ${onBoards.length} board${onBoards.length>1?'s':''}</span>${onBoards.slice(0,3).map(b=>html`<div key=${b.t} className="pp-board"><span>${b.t}</span><small>${b.by}</small></div>`)}</div>`}

        <div className="pp-acc">${ACC.map(([k,t,body])=>html`<div key=${k} className=${'pp-acc-i'+(open===k?' on':'')}><button onClick=${()=>setOpen(open===k?'':k)} aria-expanded=${open===k}>${t}<span>${open===k?'−':'+'}</span></button>${open===k&&html`<div className="pp-acc-b">${body}</div>`}</div>`)}</div>
      </aside>
    </div>

    <section className="pp-sec">
      <div className="sec-h"><div><span className="eyebrow">Complete the look</span><h2>Shop the <em>room</em></h2></div></div>
      <div className="pp-bundle">
        <div className="pp-bundle-set">
          <div className="pp-bitem main"><img src=${cut(p.id)} alt=${p.name}/><span>${p.name}</span></div>
          ${pairs.map(x=>html`<button key=${x.id} className=${'pp-bitem'+(bundle.includes(x.id)?' on':'')} onClick=${()=>setBundle(bundle.includes(x.id)?bundle.filter(y=>y!==x.id):[...bundle,x.id])} aria-pressed=${bundle.includes(x.id)}><img src=${cut(x.id)} alt=${x.name}/><span>${bundle.includes(x.id)?'✓ ':''}${x.name}</span><small className="mono">${ctx.mode==='trade'?fmt(tp(x)):fmt(x.price)}</small></button>`)}
        </div>
        <div className="pp-bundle-sum"><span className="mono ix-dim">${bundle.length} pairing${bundle.length===1?'':'s'} selected</span><b className="num">${fmt(bundleTot)}</b><button className="btn btn-ink" disabled=${!bundle.length} onClick=${()=>{bundle.forEach(id=>ctx.addToProject(id,1,P.id,Z,null,true));ctx.toast(`${bundle.length} pairings added to ${P.name}`,{label:'Open tray',fn:()=>{ctx.openPin(null);ctx.setTray(true)}})}}>Add pairings to ${P.name}</button><button className="lnk" onClick=${()=>ctx.toStudio([p.id,...bundle],p.name+' look')}>Arrange them in Studio</button></div>
      </div>
    </section>

    <section className="pp-sec">
      <div className="sec-h"><h2>More like <em>this</em></h2><div className="row">${[['tone','Similar tone'],['mat','Same material'],['type','Same type']].map(([k,l])=>html`<button key=${k} className=${'chip'+(simF===k?' on':'')} onClick=${()=>setSimF(k)}>${l}</button>`)}</div></div>
      <${Wall} items=${sim} ctx=${ctx}/>
    </section>

    <div className=${'pp-mini'+(mini?' show':'')}>
      <img src=${cut(p.id)} alt=""/><span><b>${p.name}</b><small className="mono">${fmt(unit*qty)} · ${qty} × ${ctx.mode}</small></span>
      <button className="btn btn-cog" onClick=${()=>add()}>${I('tray',{width:16})} Add to ${P.name}</button>
    </div>
  </div>`;
}

/* ================= TRAY v3 ================= */
// Client quotes: the designer prices a project privately and shares one link. The server
// stores the quote and the link carries only a random code; the client sees sell prices only.
const qDate=d=>new Date(d).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
const qSellOf=(p,set)=>set.show==='cost'?tp(p):set.show==='retail'?p.price:Math.round(tp(p)*(1+set.markup/100)*100)/100;
// The home page sample, built locally from real pieces.
function sampleQuote(space){
  const pick=(n,i)=>PRODUCTS.find(p=>p.name===n)||PRODUCTS[i];
  const lines=[[pick('Roscoe',0),2],[pick('Ansel',1),4],[pick('Elara',2),3]].filter(([p])=>p).map(([p,q],i)=>({key:'s'+i,name:p.name,line:p.line,img:cut(p.id),tone:p.tone,mat:p.mat,z:'Main dining',q,u:Math.round((p.trade??p.price*TRADE)*1.4)}));
  const d=Date.now();
  return {x:true,ref:'Q-1042',by:'Studio Ama',studio:true,c:'Ama Owusu',t:'Fernwood Café',n:'Warm cognac leather and rattan light, chosen to wear in beautifully with daily service.',sp:space,d,until:d+30*864e5,dl:2400,dep:50,lt:'8 to 10 weeks',lines,approved:null,changed:false};
}
function fromServer(q){
  const lines=q.lines.map((l,i)=>{const p=PRODUCTS.find(x=>x.full===l.name);return {key:'l'+i,name:p?p.name:l.name.split(' ')[0],line:p?p.line:l.name.split(' ').slice(1).join(' '),img:p?cut(p.id):l.image,tone:p?p.tone:'#B07A4A',mat:p?p.mat:null,z:l.zone,q:l.quantity,u:l.unitSellCents/100}});
  return {x:false,ref:q.number,by:q.studioName||'House of Louie Mae',studio:!!q.studioName,c:q.clientName,t:q.title,n:q.note,sp:q.space,d:q.createdAt,until:q.validUntil,dl:q.deliveryCents==null?-1:q.deliveryCents/100,dep:q.depositBps/100,lt:q.leadTime,lines,approved:q.approval,changed:!!q.changeRequest};
}

function QuoteComposer({ctx,onClose}){
  const proj=ctx.activeProject;const me=ctx.me;
  const create=useMutation(api.holm.createClientQuote);
  const [set,setSet]=useState(()=>({show:'markup',markup:40,brand:'studio',studio:me.businessName||'',email:me.email||'',client:'',note:'',valid:30,delivery:'',lead:'8 to 10 weeks',...load('qset',{}),title:proj.name}));
  const [busy,setBusy]=useState(false);const [link,setLink]=useState('');const [serverErr,setServerErr]=useState('');
  const up=o=>{setSet(s=>({...s,...o}));setLink('')};
  useEffect(()=>{const {show,markup,brand,studio,email,valid,lead}=set;store('qset',{show,markup,brand,studio,email,valid,lead})},[set]);
  useEffect(()=>{const k=e=>e.key==='Escape'&&onClose();addEventListener('keydown',k);return()=>removeEventListener('keydown',k)},[]);
  const items=proj.items.map(i=>({...i,p:byId(i.pid)}));
  const cost=items.reduce((s,i)=>s+tp(i.p)*i.qty,0);const sell=items.reduce((s,i)=>s+qSellOf(i.p,set)*i.qty,0);const profit=sell-cost;
  const errs={client:!set.client.trim()&&'Add who this is for',email:!set.email.trim()?'Add the email where approvals should go':!/^\S+@\S+\.\S+$/.test(set.email)&&'Check this email address',studio:set.brand==='studio'&&!set.studio.trim()&&'Add your studio name'};
  const [tried,setTried]=useState(false);const ok=!errs.client&&!errs.email&&!errs.studio&&items.length>0;
  const make=async()=>{setTried(true);setServerErr('');if(!ok)return null;if(link)return link;setBusy(true);
    try{const merged=[];items.forEach(i=>{const ex=merged.find(m=>m.productId===i.p.lid&&m.variantId===i.p.vid);if(ex)ex.quantity+=i.qty;else merged.push({productId:i.p.lid,variantId:i.p.vid,quantity:i.qty,zone:i.zone})});
      const slug=await create({show:set.show,markupBps:Math.round(set.markup*100),studioName:set.brand==='studio'?set.studio:undefined,replyEmail:set.email,clientName:set.client,title:set.title||proj.name,note:set.note,space:ctx.space,deliveryCents:set.delivery?Math.round(+set.delivery*100):undefined,leadTime:set.lead,validDays:set.valid,items:merged});
      const url=location.origin+'/trade#q/'+slug;setLink(url);return url}
    catch(e){setServerErr(e?.data||e?.message?.replace(/^.*Uncaught Error: /,'').split('\n')[0]||'Something went wrong. Try again.');return null}finally{setBusy(false)}};
  const share=async()=>{const url=await make();if(url)copyText(url,ctx.toast)};
  const preview=async()=>{const url=await make();if(url){onClose();ctx.setTray(false);location.hash=url.split('#')[1]}};
  const F=(k,label,ph,type='text')=>html`<label className="qc-f"><span>${label}</span><input type=${type} value=${set[k]} placeholder=${ph} onInput=${e=>up({[k]:e.target.value})} aria-invalid=${!!(tried&&errs[k])}/>${tried&&errs[k]&&html`<em>${errs[k]}</em>`}</label>`;
  if(!me.verified)return html`<div className="qc-scrim" onClick=${e=>e.target===e.currentTarget&&onClose()} role="dialog" aria-modal="true" aria-label="Client quotes"><div className="qc" style=${{gridTemplateColumns:'1fr',maxWidth:560}}><button className="qc-x" aria-label="Close" onClick=${onClose}>${I('x')}</button><div className="qc-set"><h2>Client quotes</h2><p className="qc-sub">Client quotes are part of a verified trade account. Price a project at trade, add your markup, and send your client one link.</p><button className="btn btn-ink btn-lg" style=${{justifySelf:'start'}} onClick=${()=>{onClose();ctx.setTray(false);ctx.go('trade')}}>${me.signedIn&&me.tradeStatus==='pending'?'View your application':'Apply for trade'}</button></div></div></div>`;
  return html`<div className="qc-scrim" onClick=${e=>e.target===e.currentTarget&&onClose()} role="dialog" aria-modal="true" aria-label="Create a client quote">
    <div className="qc">
      <button className="qc-x" aria-label="Close" onClick=${onClose}>${I('x')}</button>
      <div className="qc-set">
        <h2>Client quote</h2>
        <p className="qc-sub">${proj.name} · ${items.reduce((s,i)=>s+i.qty,0)} pieces</p>
        <div className="qc-g">${F('client','Prepared for','Client name or business')}${F('title','Project title',proj.name)}</div>
        <div className="qc-block">
          <span className="qc-l">What your client sees</span>
          <div className="qc-seg">${[['cost','Your cost'],['markup','Marked up'],['retail','Retail']].map(([k,t])=>html`<button key=${k} className=${set.show===k?'on':''} onClick=${()=>up({show:k})}>${t}</button>`)}</div>
          ${set.show==='markup'&&html`<div className="qc-mk"><input className="lux-range qc-range" type="range" min="0" max="80" step="5" value=${set.markup} style=${{'--p':set.markup/80*100+'%'}} onInput=${e=>up({markup:+e.target.value})} aria-label="Markup on your trade cost"/><b className="num">${set.markup}%</b></div>`}
          <p className="qc-hint">${{cost:'Your trade price, passed through. Best when you bill a separate design fee.',markup:'Your margin is added to every piece. Your client only sees the final price.',retail:'Standard retail prices. You keep the full trade discount.'}[set.show]}</p>
        </div>
        <div className="qc-block">
          <span className="qc-l">Presented by</span>
          <div className="qc-seg">${[['studio','Your studio'],['hol','House of Louie Mae']].map(([k,t])=>html`<button key=${k} className=${set.brand===k?'on':''} onClick=${()=>up({brand:k})}>${t}</button>`)}</div>
          <div className="qc-g">${set.brand==='studio'&&F('studio','Studio name','Your studio')}${F('email','Send approvals to','you@studio.com','email')}</div>
        </div>
        <div className="qc-g3">
          <label className="qc-f"><span>Delivery and install</span><input inputMode="numeric" value=${set.delivery} placeholder="Quoted later" onInput=${e=>up({delivery:e.target.value.replace(/[^\d]/g,'')})}/></label>
          <div className="qc-f"><span>Payment</span><b style=${{fontWeight:500}}>In full before delivery</b></div>
          <label className="qc-f"><span>Valid for</span><select value=${set.valid} onChange=${e=>up({valid:+e.target.value})}>${[14,30,60].map(v=>html`<option key=${v} value=${v}>${v} days</option>`)}</select></label>
        </div>
        <label className="qc-f"><span>A note to your client</span><textarea rows="3" value=${set.note} placeholder="A few words on the direction, finishes, or next steps" onInput=${e=>up({note:e.target.value})}></textarea></label>
      </div>
      <div className="qc-side">
        <div className="qc-private">
          <span className="qc-l">${I('lock',{width:14})} Only you see this</span>
          <div className="qc-row"><span>Your trade cost</span><b className="num">${fmt(cost)}</b></div>
          <div className="qc-row"><span>Client pays for furniture</span><b className="num">${fmt(sell)}</b></div>
          <div className="qc-row qc-profit"><span>Your profit</span><b className="num">${fmt(profit)}${sell>0&&html`<small>${Math.round(profit/sell*100)}% margin</small>`}</b></div>
        </div>
        <div className="qc-mini" aria-hidden="true">
          <div className="qc-mini-hero" style=${{backgroundImage:`url(${stillFor(ctx.space)})`}}><i>${set.brand==='studio'?(set.studio||'Your studio'):'House of Louie Mae'}</i><b>${set.title||proj.name}</b></div>
          ${items.slice(0,4).map(i=>html`<div key=${i.pid+i.zone} className="qc-mini-line"><img src=${cut(i.pid)} alt=""/><span>${i.p.name}</span><b className="num">${fmt(qSellOf(i.p,set)*i.qty)}</b></div>`)}
          ${items.length>4&&html`<div className="qc-mini-more">and ${items.length-4} more</div>`}
          <div className="qc-mini-tot"><span>Total</span><b className="num">${fmt(sell+(+set.delivery||0))}</b></div>
        </div>
        <button className="btn btn-ink btn-lg qc-cta" disabled=${busy} onClick=${share}>${I('link',{width:16})} ${busy?'Creating link…':link?'Copy client link again':'Copy client link'}</button>
        <button className="btn btn-line" disabled=${busy} onClick=${preview}>Preview as your client</button>
        ${link&&html`<div className="linkbox"><code>${link}</code></div>`}
        ${serverErr&&html`<p className="help" style=${{color:'var(--bad)',textAlign:'center'}}>${serverErr}</p>`}
        <p className="qc-fine">Prices are confirmed on our server. Your trade cost never appears on the client's page.</p>
      </div>
    </div>
  </div>`;
}
function ClientQuote({ctx,code}){
  const sample=code==='sample';
  const data=useQuery(api.holm.clientQuote,sample?'skip':{slug:code});
  const markViewed=useMutation(api.holm.markViewed);const approveM=useMutation(api.holm.approveClientQuote);const changeM=useMutation(api.holm.requestClientChanges);
  const [mode,setMode]=useState(null);const [name,setName]=useState('');const [agree,setAgree]=useState(false);const [msg,setMsg]=useState('');const [err,setErr]=useState('');const [busy,setBusy]=useState(false);const [local,setLocal]=useState(null);
  useEffect(()=>{if(!sample&&data)markViewed({slug:code}).catch(()=>{})},[sample,code,!!data]);
  const q=useMemo(()=>sample?sampleQuote(ctx.space):data?fromServer(data):null,[data,sample,ctx.space]);
  useEffect(()=>{document.title=q?(q.t+' · Quote'):'Quote';return()=>{document.title='House of Louie Mae'}},[q]);
  if(!sample&&data===undefined)return html`<main className="cq-missing"><p className="mute">Opening your quote…</p></main>`;
  if(!q)return html`<main className="cq-missing"><h1>This quote link isn't complete</h1><p>Ask your designer to send the link again.</p></main>`;
  const lines=q.lines;const zones=[...new Set(lines.map(l=>l.z))];
  const sub=lines.reduce((s,l)=>s+l.u*l.q,0);const total=sub+Math.max(0,q.dl);const dep=Math.round(total*q.dep/100);
  const by=q.by;const expired=Date.now()>q.until;
  const done=local||(q.approved?{kind:'approved',name:q.approved.name}:q.changed?{kind:'changes'}:null);
  const palette=[];lines.forEach(l=>{const w=l.u*l.q;const f=palette.find(x=>cdist(x.c,l.tone)<20);f?f.w+=w:palette.push({c:l.tone,w})});
  const fail=e=>setErr(e?.data||String(e?.message||'').replace(/^.*Uncaught Error: /,'').split('\n')[0]||'Something went wrong. Try again.');
  const approve=async()=>{if(!name.trim())return setErr('Type your full name to approve');if(!agree)return setErr('Confirm the pieces, finishes and quantities');
    if(sample){setLocal({kind:'approved',name:name.trim()});setMode(null);return}
    setBusy(true);try{await approveM({slug:code,name:name.trim()});setLocal({kind:'approved',name:name.trim()});setMode(null)}catch(e){fail(e)}finally{setBusy(false)}};
  const change=async()=>{if(!msg.trim())return setErr('Tell your designer what to change');
    if(sample){setLocal({kind:'changes'});setMode(null);return}
    setBusy(true);try{await changeM({slug:code,message:msg.trim()});setLocal({kind:'changes'});setMode(null)}catch(e){fail(e)}finally{setBusy(false)}};
  return html`<main className="cq">
    <section className="cq-hero" style=${{backgroundImage:`url(${stillFor(q.sp)})`}}>
      <div className="cq-hero-in">
        <div className="cq-top"><span className="cq-by">${by}</span>${q.x&&html`<button className="cq-back" onClick=${()=>{location.hash=""}}>${I("arrow",{width:14,style:{transform:"scaleX(-1)"}})} Back to House of Louie Mae</button>`}</div>
        <div className="cq-title">
          ${q.c&&html`<span className="cq-for">Prepared for ${q.c}</span>`}
          <h1>${q.t}</h1>
          <span className="cq-meta">Quote ${q.ref} · ${qDate(q.d)}${q.x?' · Sample':''}</span>
        </div>
      </div>
    </section>
    <div className="cq-body">
      <div className="cq-main">
        ${q.n&&html`<blockquote className="cq-note"><p>${q.n}</p><cite>${by}</cite></blockquote>`}
        ${palette.length>1&&html`<div className="cq-palette" aria-label="Material palette">${palette.map(x=>html`<i key=${x.c} style=${{background:x.c,flex:x.w}}></i>`)}</div>`}
        ${zones.map(z=>html`<section key=${z} className="cq-zone">
          ${zones.length>1&&html`<h2>${z}</h2>`}
          ${lines.filter(l=>l.z===z).map(l=>html`<article key=${l.key} className="cq-line">
            <div className="cq-th">${l.img&&html`<img src=${l.img} alt=${l.name} loading="lazy"/>`}</div>
            <div className="cq-what"><h3>${l.name}</h3><p>${l.line}</p>${l.mat&&MAT[l.mat]&&html`<span><i style=${{background:l.tone}}></i>${MAT[l.mat]}</span>`}</div>
            <div className="cq-qty"><b className="num">${l.q}</b><span>× ${fmt(l.u)}</span></div>
            <div className="cq-sum num">${fmt(l.u*l.q)}</div>
          </article>`)}
        </section>`)}
      </div>
      <aside className="cq-side">
        <div className="cq-card">
          <div className="cq-row"><span>Furniture</span><b className="num">${fmt(sub)}</b></div>
          <div className="cq-row"><span>Delivery and installation</span><b className="num">${q.dl<0?'Quoted separately':q.dl?fmt(q.dl):'Included'}</b></div>
          <div className="cq-row"><span>Sales tax</span><b>Added at invoice</b></div>
          <div className="cq-total"><span>Total</span><b className="num">${fmt(total)}</b></div>
          ${q.dep>0&&q.dep<100?html`<div className="cq-row"><span>Deposit to begin · ${q.dep}%</span><b className="num">${fmt(dep)}</b></div><div className="cq-row"><span>Balance</span><b>Due before delivery</b></div>`:html`<div className="cq-row"><span>Payment</span><b>In full before delivery</b></div>`}
          <div className="cq-facts"><span>${I('clock',{width:15})} Arrives in ${q.lt}</span><span>${I('calendar',{width:15})} ${expired?'Expired':'Valid until'} ${qDate(q.until)}</span></div>
          ${done?html`<div className="cq-done">
              <span className="cq-seal">${I('check',{width:18})}</span>
              <b>${done.kind==='approved'?`Approved by ${done.name}`:'Changes requested'}</b>
              <p>${done.kind==='approved'?`${by} has been notified and will confirm availability and send your invoice. ${q.dep>0&&q.dep<100?'The balance is due before delivery.':'Payment in full is due before delivery.'}`:`${by} has your note and will send an updated quote.`}</p>
            </div>`
          :mode==='approve'?html`<div className="cq-form">
              <label className="qc-f"><span>Your full name</span><input value=${name} autoFocus onInput=${e=>{setName(e.target.value);setErr('')}} aria-invalid=${!!(err&&!name.trim())}/></label>
              <label className="cq-check"><input type="checkbox" checked=${agree} onChange=${e=>{setAgree(e.target.checked);setErr('')}}/><span>I approve these pieces, finishes and quantities.</span></label>
              ${err&&html`<em className="cq-err">${err}</em>`}
              <button className="btn btn-ink btn-lg" disabled=${busy} onClick=${approve}>${busy?'Approving…':'Approve quote'}</button>
              <button className="lnk" onClick=${()=>{setMode(null);setErr('')}}>Back</button>
            </div>`
          :mode==='change'?html`<div className="cq-form">
              <label className="qc-f"><span>What should change?</span><textarea rows="4" autoFocus value=${msg} placeholder="Swap the chair finish to bronze, two fewer tables" onInput=${e=>{setMsg(e.target.value);setErr('')}}></textarea></label>
              ${err&&html`<em className="cq-err">${err}</em>`}
              <button className="btn btn-ink btn-lg" disabled=${busy} onClick=${change}>${busy?'Sending…':'Send request'}</button>
              <button className="lnk" onClick=${()=>{setMode(null);setErr('')}}>Back</button>
            </div>`
          :html`<div className="cq-actions">
              <button className="btn btn-ink btn-lg" disabled=${expired} onClick=${()=>setMode('approve')}>Approve quote</button>
              <button className="btn btn-line" disabled=${expired} onClick=${()=>setMode('change')}>Request changes</button>
              <button className="lnk" onClick=${()=>print()}>${I('download',{width:15})} Save as PDF</button>
            </div>`}
        </div>
        ${q.studio&&html`<p className="cq-made">Furniture by House of Louie Mae</p>`}
      </aside>
      <div className="cq-bar"><span>Total<b className="num">${fmt(total)}</b></span><button className="btn btn-ink" onClick=${()=>document.querySelector(".cq-card").scrollIntoView({behavior:"smooth",block:"center"})}>${done?"View status":"Review and approve"}</button></div>
    </div>
  </main>`;
}
function Tray({ctx}){
  const {tray,setTrayState}=ctx;const proj=tray.projects.find(p=>p.id===tray.active);
  const [step,setStep]=useState(0);const [view,setView]=useState('staged');const [tab,setTab]=useState('tray');
  const [newP,setNewP]=useState(false);const [pn,setPn]=useState('');const [drag,setDrag]=useState(null);const [over,setOver]=useState(null);
  const [qc,setQc]=useState(false);
  const [del,setDel]=useState(()=>{const d=load('del',{});return {when:'asap',date:'',recv:d.recv||'white',notes:'',teamNote:'',name:d.name||'',email:ctx.me.email||d.email||'',phone:d.phone||'',business:ctx.me.businessName||d.business||'',line1:d.line1||'',city:d.city||'',state:d.state||'',postal:d.postal||''}});
  const [ref,setRef]=useState('');const [busy,setBusy]=useState(false);const [err,setErr]=useState('');const tokRef=useRef(null);const requestQuote=useMutation(api.holm.requestQuote);
  useEffect(()=>{const {name,email,phone,business,line1,city,state,postal,recv}=del;store('del',{name,email,phone,business,line1,city,state,postal,recv})},[del]);
  useEffect(()=>{const k=e=>e.key==='Escape'&&ctx.setTray(false);addEventListener('keydown',k);return()=>removeEventListener('keydown',k)},[]);
  useEffect(()=>{setStep(0)},[tray.active]);
  const upd=fn=>setTrayState(t=>({...t,projects:t.projects.map(p=>p.id===t.active?fn(p):p)}));
  const items=proj.items.map(it=>({...it,p:byId(it.pid)}));const later=(tray.later||[]).map(x=>({...x,p:byId(x.pid)}));
  const retail=items.reduce((s,i)=>s+i.p.price*i.qty,0);const trade=items.reduce((s,i)=>s+tp(i.p)*i.qty,0);const tier=tierOf(trade);const tierOn=ctx.mode==='trade'&&tier.rate>0;const tierSave=tierOn?trade*tier.rate:0;
  const sub=(ctx.mode==='trade'?trade:retail)-tierSave;const seats=items.reduce((s,i)=>s+i.p.seats*i.qty,0);
  const palette=[];items.forEach(i=>{const w=i.p.price*i.qty;const f=palette.find(x=>cdist(x.c,i.p.tone)<20);f?f.w+=w:palette.push({c:i.p.tone,w})});
  const line=(i,fn)=>upd(p=>({...p,items:p.items.map(x=>x.pid===i.pid&&x.zone===i.zone?fn(x):x).filter(Boolean)}));
  const remove=i=>{line(i,()=>null);ctx.toast(`${i.p.name} removed`,{label:'Undo',fn:()=>upd(p=>({...p,items:[...p.items,{pid:i.pid,qty:i.qty,zone:i.zone}]}))})};
  const saveLater=i=>{line(i,()=>null);setTrayState(t=>({...t,later:[{pid:i.pid,qty:i.qty},...(t.later||[]).filter(x=>x.pid!==i.pid)]}));ctx.toast(`${i.p.name} saved for later`)};
  const restore=x=>{setTrayState(t=>({...t,later:(t.later||[]).filter(y=>y.pid!==x.pid)}));ctx.addToProject(x.pid,x.qty,proj.id,proj.zones[0],null,true)};
  const moveTo=(i,z)=>{if(i.zone===z)return;upd(p=>{const rest=p.items.filter(x=>!(x.pid===i.pid&&x.zone===i.zone));const ex=rest.find(x=>x.pid===i.pid&&x.zone===z);return {...p,items:ex?rest.map(x=>x===ex?{...x,qty:x.qty+i.qty}:x):[...rest,{pid:i.pid,qty:i.qty,zone:z}]}})};
  const suggest=z=>{const zi=items.filter(i=>i.zone===z);if(!zi.length)return null;const have=new Set(items.map(i=>i.pid));const anchor=zi[0].p;return pairsFor(anchor,4).find(x=>!have.has(x.id))};
  const csv=()=>['Zone,Item,SKU,Material,Approx width (cm),Qty,Unit trade,Line trade,Status',...items.map(i=>[i.zone,`${i.p.name} ${i.p.line}`,i.p.sku,MAT[i.p.mat],APPROX_CM[i.p.id],i.qty,tp(i.p).toFixed(2),(tp(i.p)*i.qty).toFixed(2),i.p.oos?'Restock check':'Ready to quote'].map(v=>`"${v}"`).join(','))].join('\n');
  const STEPS=['Tray','Delivery','Review','Requested'];
  const contactErr=()=>!del.name.trim()?'Add a contact name for delivery.':!/^\S+@\S+\.\S+$/.test(del.email)?'Add an email for the quote.':!del.line1.trim()||!del.city.trim()||!del.postal.trim()?'Add the delivery address.':'';
  const submit=async()=>{const m=contactErr();if(m){setStep(1);setErr(m);return}setBusy(true);setErr('');
    try{tokRef.current=tokRef.current||Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>'abcdefghijklmnopqrstuvwxyz0123456789'[b%36]).join('');
      const merged=[];items.forEach(i=>{const ex=merged.find(x=>x.productId===i.p.lid&&x.variantId===i.p.vid);if(ex)ex.quantity+=i.qty;else merged.push({productId:i.p.lid,variantId:i.p.vid,quantity:i.qty,zone:i.zone})});
      const r=await requestQuote({token:tokRef.current,projectName:proj.name,name:del.name.trim(),email:del.email.trim(),phone:del.phone.trim(),business:del.business.trim(),address:{line1:del.line1.trim(),city:del.city.trim(),state:del.state.trim(),postalCode:del.postal.trim(),country:'US'},timing:del.when,date:del.date,receiving:del.recv,notes:(del.teamNote+(del.notes?'\nAccess: '+del.notes:'')).trim(),website:'',items:merged,refCode:activeRef()?.code,visitorId:visitorId()});
      tokRef.current=null;setRef(r.reference);setStep(3)}
    catch(e){setErr(e?.data||String(e?.message||'').replace(/^.*Uncaught Error: /,'').split('\n')[0]||'Something went wrong. Try again.')}finally{setBusy(false)}};
  const fld=(k,label,ph,type='text',auto)=>html`<div><label className="lbl" htmlFor=${'tv-'+k}>${label}</label><input id=${'tv-'+k} className="field" type=${type} autoComplete=${auto} value=${del[k]} placeholder=${ph} onInput=${e=>{setDel({...del,[k]:e.target.value});setErr('')}}/></div>`;
  const strip=items.flatMap(i=>Array.from({length:Math.min(i.qty,3)},(_,k)=>({...i,k})));const stripCm=strip.reduce((s,i)=>s+APPROX_CM[i.pid]+30,0);
  return html`<div className="tray-scrim" onClick=${()=>ctx.setTray(false)}></div>
  ${qc&&html`<${QuoteComposer} ctx=${ctx} onClose=${()=>setQc(false)}/>`}
  <section className="tv" role="dialog" aria-modal="true" aria-label="Project tray">
    <header className="tv-head">
      <div className="row" style=${{justifyContent:'space-between'}}>
        <h2>Project tray</h2>
        <button className="ib" aria-label="Close tray" onClick=${()=>ctx.setTray(false)}>${I('x')}</button>
      </div>
      <div className="ptabs" role="tablist">${tray.projects.map(p=>html`<button key=${p.id} role="tab" aria-selected=${p.id===tray.active} className=${p.id===tray.active?'on':''} onClick=${()=>setTrayState(t=>({...t,active:p.id}))}>${p.name} <span className="mono ix-dim">${p.items.reduce((s,i)=>s+i.qty,0)}</span></button>`)}
        ${newP?html`<form className="row" onSubmit=${e=>{e.preventDefault();if(!pn.trim())return;const id=uid();setTrayState(t=>({...t,active:id,projects:[...t.projects,{id,name:pn.trim(),target:20,zones:['Main room'],items:[]}]}));setPn('');setNewP(false)}}><input className="field" style=${{height:36,width:170}} autoFocus placeholder="Project name" aria-label="New project name" value=${pn} onInput=${e=>setPn(e.target.value)}/><button className="btn btn-ink btn-sm">Add</button></form>`:html`<button onClick=${()=>setNewP(true)}>+ New project</button>`}</div>
      <ol className="tv-steps">${STEPS.map((s,i)=>html`<li key=${s} className=${i===step?'on':i<step?'done':''}><button disabled=${i>step||step===3} onClick=${()=>setStep(i)}><i>${i<step?I('check',{width:12}):i+1}</i>${s}</button></li>`)}</ol>
    </header>

    <div className="tv-body">
      <div className="tv-main">
      ${step===0&&html`
        <div className="tv-tools">
          <div className="seg"><button className=${tab==='tray'?'on':''} onClick=${()=>setTab('tray')}>In tray · ${items.reduce((s,i)=>s+i.qty,0)}</button><button className=${tab==='later'?'on':''} onClick=${()=>setTab('later')}>Saved for later · ${later.length}</button></div>
          ${tab==='tray'&&html`<div className="seg"><button className=${view==='staged'?'on':''} onClick=${()=>setView('staged')}>Staged</button><button className=${view==='schedule'?'on':''} onClick=${()=>setView('schedule')}>Schedule</button></div>`}
        </div>
        ${tab==='later'&&(later.length?later.map(x=>html`<div key=${x.pid} className="tv-line"><span className="tv-th" style=${{backgroundImage:`url(${cut(x.pid)})`}}></span><div><b>${x.p.name}</b> <span className="mute">${x.p.line}</span><div className="meta">${x.qty} × · ${fmt(pr(x.p,ctx.mode))} each</div></div><button className="btn btn-line btn-sm" onClick=${()=>restore(x)}>Move to ${proj.name}</button></div>`):html`<div className="empty"><h3>Nothing saved for later</h3><p>Use "Save for later" on any line to park it here without losing it.</p></div>`)}
        ${tab==='tray'&&!items.length&&html`<div className="empty"><h3>This project is empty</h3><p>Add pieces from the floor, a product page, or a whole Studio collage at once.</p><button className="btn btn-ink" onClick=${()=>{ctx.setTray(false);ctx.go('discover')}}>Browse pieces</button></div>`}
        ${tab==='tray'&&items.length>0&&view==='staged'&&html`
          <div className="tv-stage" aria-label="Your tray, staged">
            <div className="tv-stage-in" style=${{width:`max(100%, ${stripCm*1.15}px)`}}>
              ${strip.map((i,n)=>html`<button key=${i.pid+i.zone+i.k} className="tv-piece" style=${{width:APPROX_CM[i.pid]*1.15+'px',alignSelf:i.p.type==='lighting'?'flex-start':'flex-end'}} title=${i.p.name+' · '+i.zone} onClick=${()=>document.getElementById('ln-'+i.pid+i.zone.replace(/\W/g,''))?.scrollIntoView({behavior:'smooth',block:'center'})}><img src=${cut(i.pid)} alt=${i.p.name}/>${i.p.type!=='lighting'&&html`<span></span>`}</button>`)}
            </div>
            <span className="tv-stage-cap mono">Your tray, staged · ${items.reduce((s,i)=>s+i.qty,0)} pieces · scroll sideways</span>
          </div>
          ${proj.zones.map(z=>{const zi=items.filter(i=>i.zone===z);const sg=suggest(z);return html`<div key=${z} className=${'tv-zone'+(over===z?' over':'')} onDragOver=${e=>{e.preventDefault();setOver(z)}} onDragLeave=${()=>setOver(null)} onDrop=${()=>{if(drag)moveTo(drag,z);setDrag(null);setOver(null)}}>
            <div className="zone-h"><h3>${z}</h3><span className="mono mute">${zi.length} pieces · ${zi.reduce((s,i)=>s+i.p.seats*i.qty,0)} seats${zi.length?'':' · drop pieces here'}</span></div>
            ${zi.map(i=>html`<div key=${i.pid+z} id=${'ln-'+i.pid+z.replace(/\W/g,'')} className="tv-line" draggable="true" onDragStart=${()=>setDrag(i)} onDragEnd=${()=>setDrag(null)}>
              <button className="tv-th" style=${{backgroundImage:`url(${cut(i.pid)})`}} aria-label=${'Open '+i.p.name} onClick=${()=>ctx.openPin(i.pid)}></button>
              <div style=${{minWidth:0}}><b>${i.p.name}</b> <span className="mute">${i.p.line}</span>
                <div className="meta"><span className="row" style=${{gap:5}}><span className="dot" style=${{background:i.p.tone}}></span>${MAT[i.p.mat]}</span><span className="mono">${i.p.sku}</span>${i.p.oos?html`<span className="tv-status warn">Restock check</span>`:html`<span className="tv-status">Ready to quote</span>`}</div>
                <div className="meta"><button className="lnk" onClick=${()=>saveLater(i)}>Save for later</button><button className="lnk" onClick=${()=>remove(i)}>Remove</button><span className="mute hide-sm">Drag to another area</span></div></div>
              <div className="qty sm"><button aria-label="Fewer" onClick=${()=>line(i,x=>({...x,qty:Math.max(1,x.qty-1)}))}>−</button><span>${i.qty}</span><button aria-label="More" onClick=${()=>line(i,x=>({...x,qty:x.qty+1}))}>+</button></div>
              <div className="tot">${ctx.mode==='trade'?html`${fmt(tp(i.p)*i.qty)}<s>${fmt(i.p.price*i.qty)}</s>`:fmt(i.p.price*i.qty)}</div>
            </div>`)}
            ${sg&&html`<button className="tv-suggest" onClick=${()=>ctx.addToProject(sg.id,1,proj.id,z,null,true)}><img src=${cut(sg.id)} alt=""/><span><b>Complete the ${z.toLowerCase()}</b><small>Add ${sg.name} ${sg.line.toLowerCase()} · ${fmt(pr(sg,ctx.mode))}</small></span>${I('plus',{width:18})}</button>`}
          </div>`})}
          <button className="btn btn-line btn-sm" style=${{marginTop:16}} onClick=${()=>{const n='Area '+(proj.zones.length+1);upd(p=>({...p,zones:[...p.zones,n]}));ctx.toast(n+' added. Drag pieces into it.')}}>${I('plus',{width:15})} Add an area</button>`}
        ${tab==='tray'&&items.length>0&&view==='schedule'&&html`<div className="tv-sched"><table className="t"><thead><tr><th>Item</th><th>Area</th><th>Material</th><th className="r">≈ W</th><th className="r">Qty</th><th className="r">Unit</th><th className="r">Line</th><th>Status</th></tr></thead><tbody>
            ${items.map(i=>html`<tr key=${i.pid+i.zone}><td><span className="row" style=${{gap:10}}><span className="tv-th sm" style=${{backgroundImage:`url(${cut(i.pid)})`}}></span><span><b style=${{fontWeight:500}}>${i.p.name}</b><br/><span className="mono mute">${i.p.sku}</span></span></span></td><td>${i.zone}</td><td><span className="row" style=${{gap:6}}><span className="dot" style=${{background:i.p.tone}}></span>${MAT[i.p.mat]}</span></td><td className="r num">${APPROX_CM[i.pid]} cm</td><td className="r num">${i.qty}</td><td className="r num">${fmt(pr(i.p,ctx.mode))}</td><td className="r num">${fmt(pr(i.p,ctx.mode)*i.qty)}</td><td><span className=${'tv-status'+(i.p.oos?' warn':'')}>${i.p.oos?'Restock check':'Ready to quote'}</span></td></tr>`)}
          </tbody></table><div className="row" style=${{marginTop:12,flexWrap:'wrap'}}><button className="btn btn-line btn-sm" onClick=${()=>copyText(csv(),ctx.toast)}>${I('copy',{width:15})} Copy schedule as CSV</button><span className="help" style=${{margin:0}}>Paste into a spreadsheet or your procurement tool. Widths are planning estimates.</span></div></div>`}
      `}
      ${step===1&&html`<div className="tv-form">
        <h3 className="tv-h">Where it's going</h3>
        <div className="tv-card" style=${{display:'grid',gap:12}}><div className="g2f">${fld('name','Site contact','Full name','text','name')}${fld('phone','Phone','For delivery scheduling','tel','tel')}</div><div className="g2f">${fld('email','Email for the quote','you@business.com','email','email')}${fld('business','Business','Business name','text','organization')}</div>${fld('line1','Delivery address','Street address','text','street-address')}<div className="g3f" style=${{display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:10}}>${fld('city','City','','text','address-level2')}${fld('state','State','','text','address-level1')}${fld('postal','ZIP','','text','postal-code')}</div></div>
        <h3 className="tv-h">When</h3>
        <div className="tv-opts">${[['asap','As soon as ready','Ships when every piece is confirmed'],['date','Schedule a date','Hold delivery until opening week'],['split','Ship as available','Pieces arrive as each is ready']].map(([k,t,d])=>html`<button key=${k} className=${'modecard'+(del.when===k?' on':'')} onClick=${()=>setDel({...del,when:k})}><b>${t}</b><p>${d}</p></button>`)}</div>
        ${del.when==='date'&&html`<div style=${{maxWidth:260}}><label className="lbl" htmlFor="tv-date">Target delivery date</label><input id="tv-date" type="date" className="field" value=${del.date} onInput=${e=>setDel({...del,date:e.target.value})}/></div>`}
        <h3 className="tv-h">How it's received</h3>
        <div className="tv-opts">${[['white','White glove','Placed in the room, packaging removed'],['threshold','Threshold','Delivered inside the first door'],['dock','Commercial dock','Booked to your receiving hours']].map(([k,t,d])=>html`<button key=${k} className=${'modecard'+(del.recv===k?' on':'')} onClick=${()=>setDel({...del,recv:k})}><b>${t}</b><p>${d}</p></button>`)}</div>
        <div><label className="lbl" htmlFor="tv-notes">Access notes</label><textarea id="tv-notes" className="field" rows="3" placeholder="Stairs, elevator size, loading hours, parking" value=${del.notes} onInput=${e=>setDel({...del,notes:e.target.value})}></textarea></div>
        <div className="note">${I('pin',{width:18})}<span>Sales tax is added to the final quote. Tax exemption applies once your resale certificate is approved on your trade account.</span></div>
      </div>`}
      ${step===2&&html`<div className="tv-form">
        <h3 className="tv-h">Review your quote request</h3>
        ${proj.zones.map(z=>{const zi=items.filter(i=>i.zone===z);if(!zi.length)return null;return html`<div key=${z} className="tv-review"><b>${z}</b><span>${zi.map(i=>`${i.qty} × ${i.p.name}`).join(' · ')}</span></div>`})}
        <div className="tv-review"><b>Delivery</b><span>${{asap:'As soon as ready',date:'Scheduled'+(del.date?' for '+del.date:''),split:'Ship as available'}[del.when]} · ${{white:'White glove',threshold:'Threshold',dock:'Commercial dock'}[del.recv]}</span></div>
        <div className="tv-review"><b>Ship to</b><span>${[del.business,del.line1,[del.city,del.state,del.postal].filter(Boolean).join(' ')].filter(Boolean).join(', ')} · ${del.name}${del.phone?' · '+del.phone:''}</span></div><div className="tv-review"><b>Pricing</b><span>${ctx.me.verified?'Trade, confirmed on our server':'Retail. Verified trade accounts get trade pricing.'}</span></div>
        <div className="tv-review"><b>Tax</b><span>${tray.taxExempt?'Exempt, certificate on file':'Sales tax calculated on the final quote'}</span></div>
        
        <div><label className="lbl" htmlFor="tv-team">Note to the House team</label><textarea id="tv-team" className="field" rows="3" placeholder="Opening date, finish questions, anything we should know" value=${del.teamNote} onInput=${e=>setDel({...del,teamNote:e.target.value})}></textarea></div>
      </div>`}
      ${step===3&&html`<div className="tv-done">
        <span className="pulse" style=${{background:'var(--ok)'}}>${I('check')}</span>
        <h3>Quote request received</h3><p className="mono">${ref} · ${proj.name}</p>
        <ol className="tv-time">${[['Received','Just now'],['Availability check','Supplier stock and lead times'],['Final quote','Within one business day'],['Approve & pay','Only after you approve'],['Delivery booked','On your chosen date']].map(([t,d],i)=>html`<li key=${t} className=${i===0?'on':''}><i></i><b>${t}</b><span>${d}</span></li>`)}</ol>
        <div className="row" style=${{flexWrap:'wrap',justifyContent:'center'}}><button className="btn btn-ink" onClick=${()=>setQc(true)}>${I('link',{width:15})} Create client quote</button><button className="btn btn-line" onClick=${()=>{ctx.setTray(false);ctx.go('home')}}>Back to the floor</button></div>
      </div>`}
      </div>

      <aside className="tv-sum">
        <div><div className="row" style=${{justifyContent:'space-between'}}><span className="st-h">Seats covered</span><span className="mono num">${seats} / <input className="num" aria-label="Seat target" value=${proj.target} onInput=${e=>upd(p=>({...p,target:Math.max(1,+e.target.value||1)}))} style=${{width:42,border:0,borderBottom:'1px solid var(--line2)',background:'none',textAlign:'center'}}/></span></div>
          <div className="meter" style=${{marginTop:8}}><i style=${{width:Math.min(100,seats/proj.target*100)+'%'}}></i></div>
          <p className="help">${seats>=proj.target?'Every planned seat has a piece.':`${proj.target-seats} seats to go.`}</p></div>
        ${palette.length>0&&html`<div><span className="st-h">Material palette</span><div className="palette" style=${{marginTop:8}}>${palette.map(x=>html`<i key=${x.c} style=${{background:x.c,flex:x.w}}></i>`)}</div></div>`}
        ${ctx.mode==='trade'&&html`<div className="tv-tier ${tierOn?'on':''}"><span className="st-h">Project pricing</span><div className="ix-meter"><i style=${{width:Math.min(100,trade/(tier.next||PROJECT_TIERS[PROJECT_TIERS.length-1])[0]*100)+'%'}}></i></div><p>${tierLine(trade)}</p></div>`}
        <div>
          <div className="sumrow"><span>Retail subtotal</span><span>${fmt(retail,true)}</span></div>
          ${ctx.mode==='trade'&&html`<div className="sumrow" style=${{color:'var(--ok)'}}><span>Trade savings</span><span>−${fmt(retail-trade,true)}</span></div>`}
          ${tierOn&&html`<div className="sumrow" style=${{color:'var(--ok)'}}><span>Project pricing · ${pct(tier.rate)}</span><span>−${fmt(tierSave,true)}</span></div>`}
          <div className="sumrow"><span>Delivery · flat rate</span><span>${fmt(deliveryOf(sub),true)}</span></div>
          <div className="sumrow"><span>Sales tax</span><span>${tray.taxExempt?'Exempt':'On final quote'}</span></div>
          <div className="sumrow total"><span>Estimated total</span><span>${fmt(sub+deliveryOf(sub),true)}</span></div>
          <p className="help" style=${{marginTop:8}}>One delivery fee per order: ${deliveryText()}.</p>
        </div>
        ${step<2&&html`<button className="btn btn-ink btn-lg" disabled=${!items.length} onClick=${()=>{if(step===1){const m=contactErr();if(m){setErr(m);return}}setErr('');setStep(step+1)}}>${step===0?'Continue to delivery':'Review request'} ${I('arrow',{width:17})}</button>`}
        ${step===2&&html`<button className="btn btn-cog btn-lg" disabled=${busy} onClick=${submit}>${busy?'Sending…':'Request final quote'} ${I('arrow',{width:17})}</button>`}
        ${err&&html`<p className="help" style=${{color:'var(--bad)'}}>${err}</p>`}
        ${step>0&&step<3&&html`<button className="lnk" onClick=${()=>setStep(step-1)}>Back</button>`}
        ${items.length>0&&html`<button className="tv-quote" onClick=${()=>setQc(true)}>${I('link',{width:17})}<span><b>Create a client quote</b><small>One link, your branding, your pricing</small></span>${I('arrow',{width:16})}</button>`}
        <div className="note">${I('pin',{width:18})}<span>We confirm availability, lead time and your final price before any payment.</span></div>
      </aside>
    </div>
  </section>`;
}

/* ================= STUDIO ================= */
const BGS=[['Plaster','#EFE6D8'],['Sand','#E1D2BB'],['Limewash','#F4EFE6'],['Olive','#6C6948'],['Cognac','#9A5A2E'],['Espresso','#2B211A']];
const SHAPES=[['rect','Square'],['arch','Arch'],['circle','Circle'],['pill','Pill']];
const SLOTS=[[6,8,52,-3,'arch'],[52,4,42,2,'rect'],[44,40,34,-1.5,'circle'],[6,54,40,2.5,'rect'],[60,66,30,-2,'pill'],[30,74,24,3,'rect']];
function mkImg(pid,i=0,mode='collage'){const s=SLOTS[i%SLOTS.length];return {id:uid(),kind:'img',pid,x:s[0],y:s[1],w:s[2],rot:mode==='room'?0:s[3],shape:mode==='room'?'rect':s[4],border:mode!=='room',motion:false,tone:'none',locked:false,hidden:false,room:mode==='room'}}
function mkInspo(x){return {id:uid(),kind:'inspo',src:x.src,ar:x.ar||1,title:x.title,x:6,y:6,w:48,rot:-2,shape:'rect',border:true,motion:false,tone:'none',locked:false,hidden:false}}
function mkText(t,x=8,y=84,size=7.5){return {id:uid(),kind:'text',text:t,x,y,w:70,rot:0,size,font:'display',color:'#2B211A',locked:false,hidden:false}}
function compose(prompt,mode){
  const ps=matchPrompt(prompt).slice(0,5);const use=ps.length?ps:SPACES.cafe.picks.map(byId);
  const els=use.map((p,i)=>mkImg(p.id,i,mode));
  const tones=[...new Set(use.map(p=>p.tone))].slice(0,4);
  tones.forEach((c,i)=>els.push({id:uid(),kind:'swatch',color:c,x:70+i*6.5,y:90,w:5.5,rot:0,locked:false,hidden:false}));
  els.push(mkText(prompt.charAt(0).toUpperCase()+prompt.slice(1),6,88,5.2));
  return els;
}
function Studio({ctx}){
  const seed=ctx.studioSeed;
  const [title,setTitle]=useState(seed?.title||'New collage');
  const [mode,setMode]=useState(seed?.mode||'collage');
  const [bg,setBg]=useState(seed?.bg?{img:seed.bg}:{color:'#EFE6D8',grid:true});
  const [els,setEls]=useState(()=>{if(seed?.prompt)return compose(seed.prompt,seed?.mode);if(seed?.inspo)return [mkInspo(seed.inspo),...(seed.ids||[]).map((id,i)=>mkImg(id,i+1))];if(seed?.ids)return seed.ids.map((id,i)=>mkImg(id,i,seed.mode));return [mkImg(2,0),mkImg(12,1),mkImg(9,2),mkImg(13,3),mkText('A corner for slow mornings',6,86,4.6)]});
  const [sel,setSel]=useState(null);const [tab,setTab]=useState('products');const [pq,setPq]=useState('');const [pm,setPm]=useState('all');const [prompt,setPrompt]=useState(seed?.prompt||'');const [share,setShare]=useState(false);const [dragL,setDragL]=useState(null);const [overL,setOverL]=useState(null);
  const hist=useRef({past:[],future:[]});const canvasRef=useRef();const drag=useRef(null);const bgRef=useRef();
  useEffect(()=>{if(seed)ctx.setStudioSeed(null)},[]);
  const commit=next=>{hist.current.past.push(els);hist.current.future=[];setEls(next)};
  const undo=()=>{const h=hist.current;if(!h.past.length)return;h.future.push(els);setEls(h.past.pop())};
  const redo=()=>{const h=hist.current;if(!h.future.length)return;h.past.push(els);setEls(h.future.pop())};
  const S=els.find(e=>e.id===sel);
  const patch=(id,o)=>commit(els.map(e=>e.id===id?{...e,...o}:e));
  useEffect(()=>{const k=e=>{if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;if((e.metaKey||e.ctrlKey)&&e.key==='z'){e.preventDefault();e.shiftKey?redo():undo()}else if((e.key==='Delete'||e.key==='Backspace')&&sel){commit(els.filter(x=>x.id!==sel));setSel(null)}};addEventListener('keydown',k);return()=>removeEventListener('keydown',k)});
  const onDown=(e,el,kind='move')=>{e.stopPropagation();setSel(el.id);if(el.locked)return;const r=canvasRef.current.getBoundingClientRect();const node=e.currentTarget.closest('.el').getBoundingClientRect();
    const d={kind,id:el.id,sx:e.clientX,sy:e.clientY,o:{...el},r,cx:node.left+node.width/2,cy:node.top+node.height/2,snap:els,moved:false};
    d.move=ev=>{const dx=(ev.clientX-d.sx)/d.r.width*100,dy=(ev.clientY-d.sy)/d.r.height*100;d.moved=true;
      setEls(cur=>cur.map(x=>{if(x.id!==d.id)return x;if(d.kind==='move')return {...x,x:d.o.x+dx,y:d.o.y+dy};if(d.kind==='rs'){if(x.kind==='text')return {...x,size:Math.max(2,d.o.size*(1+dx/40))};return {...x,w:Math.max(5,d.o.w+dx)}}if(d.kind==='rot'){const a=Math.atan2(ev.clientY-d.cy,ev.clientX-d.cx)*180/Math.PI+90;return {...x,rot:Math.round(a/3)*3}}return x}))};
    d.up=()=>{removeEventListener('pointermove',d.move);if(d.moved){hist.current.past.push(d.snap);hist.current.future=[]}drag.current=null};
    drag.current=d;addEventListener('pointermove',d.move);addEventListener('pointerup',d.up,{once:true})};
  const addProduct=pid=>{const n=mkImg(pid,els.filter(e=>e.kind==='img').length,mode);n.x=20+Math.random()*30;n.y=18+Math.random()*30;commit([...els,n]);setSel(n.id)};
  const prods=PRODUCTS.filter(p=>(pm==='all'||p.mat===pm)&&(p.name+' '+p.line+' '+p.mat).toLowerCase().includes(pq.toLowerCase()));
  const pieces=els.filter(e=>e.kind==='img'&&!e.hidden).map(e=>byId(e.pid));
  const retail=pieces.reduce((s,p)=>s+p.price,0);const seats=pieces.reduce((s,p)=>s+p.seats,0);
  const layers=[...els].map((e,i)=>({e,i})).reverse();
  const moveLayer=(id,dir)=>{const i=els.findIndex(e=>e.id===id);const j=i+dir;if(j<0||j>=els.length)return;const a=[...els];[a[i],a[j]]=[a[j],a[i]];commit(a)};
  const dropLayer=(fromId,toId)=>{if(fromId===toId)return;const a=[...els];const f=a.findIndex(e=>e.id===fromId);const [m]=a.splice(f,1);const t=a.findIndex(e=>e.id===toId);a.splice(t+1,0,m);commit(a)};
  const dup=()=>{if(!S)return;const n={...S,id:uid(),x:S.x+4,y:S.y+4};commit([...els,n]);setSel(n.id)};
  const canvasStyle=bg.img?{backgroundImage:`url(${bg.img})`}:{backgroundColor:bg.color};
  const toneF={none:'none',warm:'sepia(.25) saturate(1.1)',mono:'grayscale(1) contrast(1.05)',dusk:'brightness(.85) sepia(.3) hue-rotate(-8deg)'};
  const nameOf=e=>e.kind==='img'?byId(e.pid).name:e.kind==='inspo'?'Inspo · '+e.title:e.kind==='text'?e.text:'Swatch';
  return html`<main className="studio">
    <aside className="st-panel" aria-label="Layers and editing">
      <div><div className="st-h"><span>Layers</span><span>${els.length}</span></div>
        <div style=${{display:'grid',gap:2,marginTop:8}}>${layers.map(({e})=>html`<div key=${e.id} className=${'layer'+(sel===e.id?' on':'')+(overL===e.id?' drop':'')} draggable="true" onDragStart=${()=>setDragL(e.id)} onDragOver=${ev=>{ev.preventDefault();setOverL(e.id)}} onDragLeave=${()=>setOverL(null)} onDrop=${()=>{dropLayer(dragL,e.id);setOverL(null)}} onClick=${()=>setSel(e.id)}>
          <span className="th" style=${e.kind==='img'?{backgroundImage:`url(${byId(e.pid).img})`}:e.kind==='inspo'?{backgroundImage:`url(${e.src})`}:e.kind==='swatch'?{background:e.color}:{}}>${e.kind==='text'?'T':''}</span>
          <span style=${{opacity:e.hidden?.4:1}}>${nameOf(e)}</span>
          <button className="ib" aria-label=${e.hidden?'Show layer':'Hide layer'} onClick=${ev=>{ev.stopPropagation();patch(e.id,{hidden:!e.hidden})}}>${I(e.hidden?'eyeoff':'eye')}</button>
          <button className="ib" aria-label=${e.locked?'Unlock layer':'Lock layer'} onClick=${ev=>{ev.stopPropagation();patch(e.id,{locked:!e.locked})}}>${I(e.locked?'lock':'unlock')}</button>
        </div>`)}</div>
        <p className="help">Drag rows to reorder. Top of the list sits in front.</p></div>
      ${S?html`<div style=${{display:'grid',gap:14}}>
        <div className="st-h"><span>Edit ${S.kind==='img'?'piece':S.kind==='inspo'?'inspo image':S.kind==='text'?'text':'swatch'}</span><button className="lnk" onClick=${()=>setSel(null)}>Done</button></div>
        ${(S.kind==='img'||S.kind==='inspo')&&html`
          <div><span className="lbl">Cutout shape</span><div className="seg" style=${{flexWrap:'wrap'}}>${SHAPES.map(([k,l])=>html`<button key=${k} className=${S.shape===k?'on':''} onClick=${()=>patch(S.id,{shape:k})}>${l}</button>`)}</div></div>
          <div><span className="lbl">Tone</span><div className="seg">${['none','warm','mono','dusk'].map(t=>html`<button key=${t} className=${S.tone===t?'on':''} onClick=${()=>patch(S.id,{tone:t})}>${t==='none'?'Original':t[0].toUpperCase()+t.slice(1)}</button>`)}</div></div>
          <button className="toggle" onClick=${()=>patch(S.id,{border:!S.border})}><span>White border</span><span className=${'sw'+(S.border?' on':'')}></span></button>
          <button className="toggle" onClick=${()=>patch(S.id,{motion:!S.motion})}><span>Gentle motion</span><span className=${'sw'+(S.motion?' on':'')}></span></button>
          ${S.kind==='img'&&html`<button className="btn btn-line btn-sm" onClick=${()=>ctx.openPin(S.pid)}>View ${byId(S.pid).name} details</button>`}`}
        ${S.kind==='text'&&html`
          <div><label className="lbl" htmlFor="txt-in">Text</label><textarea id="txt-in" className="field" rows="2" value=${S.text} onInput=${e=>setEls(els.map(x=>x.id===S.id?{...x,text:e.target.value}:x))}></textarea></div>
          <div><span className="lbl">Typeface</span><div className="seg">${[['display','Serif'],['sans','Sans'],['mono','Mono']].map(([k,l])=>html`<button key=${k} className=${S.font===k?'on':''} onClick=${()=>patch(S.id,{font:k})}>${l}</button>`)}</div></div>
          <div><label className="lbl" htmlFor="txt-sz">Size</label><input id="txt-sz" type="range" min="2" max="16" step=".2" value=${S.size} onInput=${e=>setEls(els.map(x=>x.id===S.id?{...x,size:+e.target.value}:x))}/></div>`}
        ${(S.kind==='text'||S.kind==='swatch')&&html`<div><span className="lbl">Color</span><div className="swatches">${['#2B211A','#FBF8F2','#A65F2C','#6C6948','#AE884C','#B07A4A','#E7DFD0'].map(c=>html`<button key=${c} style=${{background:c}} className=${(S.color===c)?'on':''} aria-label=${'Color '+c} onClick=${()=>patch(S.id,{color:c})}></button>`)}</div></div>`}
        <div className="row" style=${{flexWrap:'wrap',gap:6}}>
          <button className="btn btn-line btn-sm" onClick=${dup}>${I('copy',{width:14})} Duplicate</button>
          <button className="btn btn-line btn-sm" onClick=${()=>moveLayer(S.id,1)}>${I('up',{width:14})} Forward</button>
          <button className="btn btn-line btn-sm" onClick=${()=>moveLayer(S.id,-1)}>${I('down',{width:14})} Back</button>
          <button className="btn btn-line btn-sm" style=${{color:'var(--bad)'}} onClick=${()=>{commit(els.filter(x=>x.id!==S.id));setSel(null)}}>${I('trash',{width:14})} Delete</button>
        </div>
      </div>`:html`<div style=${{display:'grid',gap:12}}>
        <div className="st-h"><span>Background</span></div>
        <div className="swatches">${BGS.map(([n,c])=>html`<button key=${c} title=${n} aria-label=${n+' background'} className=${bg.color===c&&!bg.img?'on':''} style=${{background:c}} onClick=${()=>setBg({color:c,grid:bg.grid})}></button>`)}</div>
        <button className="toggle" onClick=${()=>setBg({...bg,grid:!bg.grid})}><span>Dot grid</span><span className=${'sw'+(bg.grid&&!bg.img?' on':'')}></span></button>
        <button className="btn btn-line btn-sm" onClick=${()=>bgRef.current.click()}>${I('upload',{width:15})} Use a photo of my space</button>
        <input ref=${bgRef} type="file" accept="image/*" hidden onChange=${e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{setBg({img:r.result});setMode('room');setEls(els.map(x=>x.kind==='img'?{...x,room:true,border:false,rot:0,shape:'rect'}:x))};r.readAsDataURL(f)}}/>
        ${bg.img&&html`<button className="lnk" onClick=${()=>setBg({color:'#EFE6D8',grid:true})}>Remove photo</button>`}
        <p className="help">Select anything on the canvas to edit its shape, tone, border, motion or color.</p>
      </div>`}
    </aside>

    <section className="st-center">
      <div className="st-bar">
        <input className="title" aria-label="Collage title" value=${title} onInput=${e=>setTitle(e.target.value)}/>
        <div className="seg" role="group" aria-label="Studio mode"><button className=${mode==='collage'?'on':''} onClick=${()=>{setMode('collage');setEls(els.map(x=>x.kind==='img'?{...x,room:false}:x))}}>Collage</button><button className=${mode==='room'?'on':''} onClick=${()=>{setMode('room');setEls(els.map(x=>x.kind==='img'?{...x,room:true,border:false}:x))}}>Room</button></div>
        <span style=${{flex:1}}></span>
        <button className="ib" aria-label="Undo" title="Undo (Ctrl+Z)" onClick=${undo}>${I('undo')}</button>
        <button className="ib" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" onClick=${redo}>${I('redo')}</button>
        <button className="btn btn-line btn-sm" onClick=${()=>{ctx.saveCollage({title,els,bg});}}>Save</button>
        <button className="btn btn-cog btn-sm" onClick=${()=>setShare(true)}>${I('share',{width:15})} Share</button>
      </div>
      <div className="st-stage" onPointerDown=${()=>setSel(null)}>
        <div className=${'canvas'+(bg.grid&&!bg.img?' grid':'')} ref=${canvasRef} style=${canvasStyle}>
          ${els.map((e,i)=>e.hidden?null:html`<div key=${e.id} className=${'el'+(sel===e.id?' sel':'')} style=${{left:e.x+'%',top:e.y+'%',width:e.kind==='text'?'auto':e.w+'%',maxWidth:e.kind==='text'?'88%':'none',transform:`rotate(${e.rot}deg)`,zIndex:i,cursor:e.locked?'default':'move'}} onPointerDown=${ev=>onDown(ev,e)}>
            ${e.kind==='img'&&html`<div className=${'cut shape-'+e.shape+(e.border?' bd':'')+(e.room?' room':'')+(e.motion?' float':'')} style=${{aspectRatio:e.shape==='circle'?'1':e.shape==='arch'?'4/5':e.shape==='pill'?'3/4':byId(e.pid).ar}}><img src=${byId(e.pid).img} alt=${byId(e.pid).name} draggable="false" style=${{filter:toneF[e.tone]}}/></div>`}
            ${e.kind==='inspo'&&html`<div className=${'cut shape-'+e.shape+(e.border?' bd':'')+(e.motion?' float':'')} style=${{aspectRatio:e.shape==='circle'?'1':e.shape==='arch'?'4/5':e.shape==='pill'?'3/4':e.ar}}><img src=${e.src} alt=${e.title} draggable="false" style=${{filter:toneF[e.tone]}}/></div>`}
            ${e.kind==='text'&&html`<div className="tx" style=${{fontFamily:`var(--${e.font})`,fontStyle:e.font==='display'?'italic':'normal',color:e.color,fontSize:e.size+'cqw',textTransform:e.font==='mono'?'uppercase':'none',letterSpacing:e.font==='mono'?'.08em':'-.01em'}}>${e.text}</div>`}
            ${e.kind==='swatch'&&html`<div className="sw-shape" style=${{background:e.color,borderRadius:'50%',boxShadow:'0 0 0 .6cqw #FFFDF9'}}></div>`}
            ${sel===e.id&&!e.locked&&html`<span className="h h-rs" onPointerDown=${ev=>onDown(ev,e,'rs')}></span><span className="h h-rot" onPointerDown=${ev=>onDown(ev,e,'rot')}></span>`}
          </div>`)}
        </div>
      </div>
      <div className="st-tools">
        <button className="ib" onClick=${()=>{const t=mkText('Add a title',10,10,7);commit([...els,t]);setSel(t.id)}}>${I('text',{width:16})} Text</button>
        <button className="ib" onClick=${()=>setTab('products')}>${I('img',{width:16})} Piece</button>
        <button className="ib" onClick=${()=>{const s={id:uid(),kind:'swatch',color:'#A65F2C',x:80,y:8,w:8,rot:0,locked:false,hidden:false};commit([...els,s]);setSel(s.id)}}>${I('frame',{width:16})} Swatch</button>
        <button className="ib" onClick=${dup} disabled=${!S}>${I('copy',{width:16})} Duplicate</button>
        <button className="ib" onClick=${()=>{ctx.setRoomSeed(pieces.map(p=>p.id));ctx.go('room')}}>${I('cube',{width:16})} 3D preview</button>
      </div>
      <div className="st-foot">
        <span><span className="mono">This ${mode} · ${pieces.length} pieces · ${seats} seats</span><br/><b className="num">${fmt(pieces.reduce((s,p)=>s+pr(p,ctx.mode),0))}</b> <span className="mono">${ctx.mode==='trade'?'trade':'retail'}</span></span>
        <button className="btn" style=${{background:'var(--onink)',color:'var(--ink)'}} disabled=${!pieces.length} onClick=${()=>{pieces.forEach(p=>ctx.addToTray(p.id,1,null,true));ctx.toast(`${pieces.length} pieces added to ${ctx.activeProject.name}`,{label:'Open tray',fn:()=>ctx.setTray(true)})}}>${I('tray',{width:17})} Add all to tray</button>
      </div>
    </section>

    <aside className="st-panel r" aria-label="Add to collage">
      <form className="compose" onSubmit=${e=>{e.preventDefault();if(!prompt.trim())return;commit(compose(prompt,mode));setSel(null)}}>
        <span className="mono" style=${{opacity:.7}}>Compose for me</span>
        <input aria-label="Describe a style, material or color" placeholder="Type a style, texture, material or color" value=${prompt} onInput=${e=>setPrompt(e.target.value)}/>
        <div className="chips">${['cognac leather café','olive velvet bistro','bouclé lobby','rattan coffee bar','brass lounge'].map(c=>html`<button type="button" key=${c} onClick=${()=>{setPrompt(c);commit(compose(c,mode));setSel(null)}}>${c}</button>`)}</div>
        <button className="btn btn-cog btn-sm" style=${{justifySelf:'start'}}>${I('wand',{width:15})} Compose</button>
      </form>
      <div className="tabs left" style=${{margin:0}}>${[['products','Pieces'],['inspo','My Inspo'],['ideas','Ideas'],['boards','Boards']].map(([k,l])=>html`<button key=${k} className=${tab===k?'on':''} onClick=${()=>setTab(k)}>${l}</button>`)}</div>
      ${tab==='products'&&html`<div style=${{display:'grid',gap:10}}>
        <input className="field" style=${{height:40}} placeholder="Search pieces" aria-label="Search pieces" value=${pq} onInput=${e=>setPq(e.target.value)}/>
        <div className="scroll-x">${[['all','All'],...Object.entries(MAT)].map(([k,l])=>html`<button key=${k} className=${'chip'+(pm===k?' on':'')} style=${{height:30,fontSize:12}} onClick=${()=>setPm(k)}>${l}</button>`)}</div>
        <div className="prod-mini">${prods.map(p=>html`<button key=${p.id} onClick=${()=>addProduct(p.id)} title=${'Add '+p.name}><img src=${p.img} alt="" loading="lazy"/><span>${p.name}</span></button>`)}</div></div>`}
      ${tab==='inspo'&&html`<div style=${{display:'grid',gap:10}}>
        <div className="row" style=${{justifyContent:'space-between'}}><span className="help" style=${{margin:0}}>Tap to add. Inspo never shows prices or links.</span><button className="lnk" onClick=${()=>ctx.go('inspo')}>Library</button></div>
        ${ctx.inspo.length?html`<div className="prod-mini">${ctx.inspo.map(x=>html`<div key=${x.id} style=${{display:'grid',gap:4}}><button onClick=${()=>{const n={...mkInspo(x),x:14+Math.random()*30,y:12+Math.random()*30,w:40};commit([...els,n]);setSel(n.id)}} title=${'Add '+x.title}><img src=${x.src} alt="" loading="lazy"/><span>${x.title}</span></button><button className="lnk" style=${{fontSize:11.5,justifySelf:'start'}} onClick=${()=>setBg({img:x.src})}>Set as background</button></div>`)}</div>`
          :html`<p className="help">No inspo yet. <button className="lnk" onClick=${()=>ctx.go('inspo')}>Upload inspiration</button></p>`}</div>`}
      ${tab==='ideas'&&html`<div style=${{display:'grid',gap:16}}>${COMMUNITY.map(b=>html`<button key=${b.id} style=${{textAlign:'left'}} onClick=${()=>{commit(b.items.map((id,i)=>mkImg(id,i,mode)).concat([mkText(b.title,6,88,4.6)]));setTitle(b.title+' (remix)');setSel(null)}}>
        <div className="prod-mini" style=${{gridTemplateColumns:'repeat(3,1fr)',gap:3}}>${b.items.slice(0,3).map(id=>html`<span key=${id} style=${{aspectRatio:1,background:`url(${byId(id).img}) center/cover`,borderRadius:6,display:'block'}}></span>`)}</div>
        <b style=${{fontFamily:'var(--display)',fontSize:19,fontWeight:500,display:'block',marginTop:6}}>${b.title}</b><span className="who" style=${{padding:0}}><span className="role">${b.role}</span>${b.by}</span></button>`)}</div>`}
      ${tab==='boards'&&html`<div style=${{display:'grid',gap:14}}>${ctx.boards.map(b=>html`<div key=${b.id}><div className="st-h"><span>${b.title}</span><button className="lnk" onClick=${()=>commit([...els,...b.pins.slice(0,5).map((x,i)=>mkImg(x.pid,i+els.length,mode))])}>Add all</button></div>
        <div className="prod-mini" style=${{gridTemplateColumns:'repeat(3,1fr)',marginTop:6}}>${b.pins.map(x=>html`<button key=${x.pid} onClick=${()=>addProduct(x.pid)}><img src=${byId(x.pid).img} alt="" loading="lazy"/></button>`)}</div></div>`)}</div>`}
    </aside>
    ${share&&html`<${ShareModal} ctx=${ctx} title=${title} ids=${pieces.map(p=>p.id)} onClose=${()=>setShare(false)}/>`}
  </main>`;
}
// Partner links: a visitor id stays on this device; a partner code is remembered for 30 days.
function visitorId(){let v=load('visitor',null);if(!v){v=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');store('visitor',v)}return v}
function activeRef(){const r=load('ref',null);return r&&Date.now()-r.at<30*864e5?r:null}
const errText=e=>e?.data||String(e?.message||'').replace(/^.*Uncaught Error: /,'').split('\n')[0]||'Something went wrong. Try again.';
async function uploadBlob(getUrl,blob){const url=await getUrl();const r=await fetch(url,{method:'POST',headers:{'Content-Type':blob.type||'application/octet-stream'},body:blob});if(!r.ok)throw new Error('The file did not upload. Try again.');return (await r.json()).storageId}
const dataUrlBlob=async src=>(await fetch(src)).blob();

function ShareModal({ctx,title,ids,onClose}){
  const [m,setM]=useState('shop');const [links,setLinks]=useState({});const [busy,setBusy]=useState(false);const [err,setErr]=useState('');
  const share=useMutation(api.holmSync.shareBoard);
  const pieces=[...new Set(ids)].filter(has);
  const make=async()=>{if(links[m])return links[m];if(!ctx.me.signedIn){onClose();ctx.signInThen(ctx.route);return null}
    setBusy(true);setErr('');try{const slug=await share({title,mode:m==='shop'?'shop':'presentation',items:pieces.map(id=>({productId:byId(id).lid}))});const url=location.origin+'/trade#b/'+slug;setLinks(l=>({...l,[m]:url}));return url}catch(e){setErr(errText(e));return null}finally{setBusy(false)}};
  const copy=async()=>{const u=await make();if(u)copyText(u,ctx.toast)};
  return html`<div className="scrim" onClick=${e=>e.target===e.currentTarget&&onClose()} role="dialog" aria-modal="true" aria-label="Share">
    <div className="sheet share">
      <div className="row" style=${{justifyContent:'space-between'}}><h2 style=${{fontSize:36}}>Share <em style=${{color:'var(--cognac)'}}>${title}</em></h2><button className="ib" aria-label="Close" onClick=${onClose}>${I('x')}</button></div>
      <div className="modecards">
        <button className=${'modecard'+(m==='shop'?' on':'')} onClick=${()=>setM('shop')}><b>Shoppable</b><p>${ctx.me.partner?'Retail prices with your partner link attached. You earn commission on retail orders for 30 days.':'Retail prices, ready to add to a project. Join the partner program to earn on orders from your links.'}</p></button>
        <button className=${'modecard'+(m==='pres'?' on':'')} onClick=${()=>setM('pres')}><b>Presentation</b><p>No prices. Your client sees the pieces; you order at trade.</p></button>
      </div>
      <div className="row" style=${{gap:6}}>${pieces.slice(0,5).map(id=>html`<span key=${id} style=${{flex:1,aspectRatio:1,borderRadius:10,background:`url(${byId(id).img}) center/cover`}}></span>`)}</div>
      ${links[m]?html`<div className="linkbox"><code>${links[m]}</code><button className="btn btn-ink btn-sm" onClick=${copy}>${I('link',{width:15})} Copy</button></div>`
      :html`<button className="btn btn-ink" style=${{justifySelf:'start'}} disabled=${busy||!pieces.length} onClick=${copy}>${I('link',{width:15})} ${busy?'Creating link…':ctx.me.signedIn?'Create and copy link':'Sign in to share'}</button>`}
      ${err&&html`<p className="help" style=${{color:'var(--bad)'}}>${err}</p>`}
      ${m==='shop'&&ctx.me.partner&&html`<p className="help">Posting on social? Add #ad or "I earn commission" to the caption. FTC rules require it, and it's in the partner terms.</p>`}
    </div></div>`;
}
// A board someone shared by link.
function SharedBoard({ctx,slug}){
  const b=useQuery(api.holmSync.sharedBoard,{slug});const record=useMutation(api.holmPartners.recordClick);
  useEffect(()=>{if(b?.refCode){store('ref',{code:b.refCode,ch:'direct',at:Date.now()});record({refCode:b.refCode,channel:'direct',target:'b/'+slug,visitorId:visitorId()}).catch(()=>{})}},[b?.refCode]);
  if(b===undefined)return html`<main className="wrap"><p className="help" style=${{padding:'80px 0'}}>Opening the board…</p></main>`;
  if(!b)return html`<main className="wrap"><div className="empty" style=${{padding:'80px 0'}}><h3>This board link isn't complete</h3><p>Ask for the link again.</p><button className="btn btn-line" onClick=${()=>ctx.go('home')}>Visit House of Louie Mae</button></div></main>`;
  const pieces=b.productIds.map(lid=>PRODUCTS.find(p=>p.lid===lid)).filter(Boolean);const shop=b.mode==='shop';
  return html`<main className="wrap" style=${{paddingBottom:60}}>
    <div className="ph-head"><div><h1>${b.title}</h1><p className="mute" style=${{marginTop:8}}>Shared by ${b.by} · ${pieces.length} pieces</p></div>
      ${shop&&pieces.length>0&&html`<button className="btn btn-ink" onClick=${()=>{pieces.forEach(p=>ctx.addToTray(p.id,1,null,true));ctx.toast(`${pieces.length} pieces added to ${ctx.activeProject.name}`,{label:'Open tray',fn:()=>ctx.setTray(true)})}}>Add all to a project</button>`}</div>
    <div className="lx-grid" style=${{marginTop:12}}>${pieces.map(p=>html`<article key=${p.id} className="lx-piece in">
      <button className="lx-stage" onClick=${()=>ctx.openPin(p.id)} aria-label=${'View '+p.name}><span className="lx-cut"><img src=${cut(p.id)} alt="" loading="lazy"/></span><i className="lx-floor"></i></button>
      <div className="lx-chip glass light"><div className="lx-chip-t"><b>${p.name}</b><span>${p.line}</span></div>${shop&&html`<span className="lx-chip-p num">${fmt(pr(p,ctx.mode))}</span><button className="lx-ic solid" aria-label=${'Add '+p.name+' to a project'} onClick=${e=>ctx.addToTray(p.id,1,e.currentTarget.closest('.lx-piece').querySelector('img'))}>${I('plus',{width:16})}</button>`}</div>
    </article>`)}</div>
  </main>`;
}

/* ================= MY INSPO ================= */
function Inspo({ctx}){
  const [open,setOpen]=useState(null);const [drag,setDrag]=useState(false);const [busy,setBusy]=useState(false);const fileRef=useRef();
  const uploadUrl=useMutation(api.holmSync.inspoUploadUrl);const urlOf=useMutation(api.holmSync.inspoUrl);
  const importPin=useAction(api.holmPins.importPin);const [pinUrl,setPinUrl]=useState('');const [pinBusy,setPinBusy]=useState(false);
  const addPin=async url=>{url=(url||'').trim();if(!url)return;if(!ctx.me.signedIn){ctx.toast('Sign in to import from Pinterest');ctx.signInThen('inspo');return}
    setPinBusy(true);try{const p=await importPin({url});const blob=await (await fetch(p.src)).blob();const item=await fileToInspo(new File([blob],p.title,{type:blob.type}));
      ctx.addInspo([{...item,src:p.src,title:p.title.slice(0,60),source:'pinterest',link:p.link,author:p.author}]);setPinUrl('');ctx.toast('Pin added to My Inspo')}
    catch(e){ctx.toast(errText(e))}setPinBusy(false)};
  const add=async files=>{const fs=[...files].filter(x=>x.type.startsWith('image/'));if(!fs.length)return;setBusy(true);const out=[];
    for(const x of fs){try{const item=await fileToInspo(x);if(ctx.me.signedIn){const id=await uploadBlob(uploadUrl,await dataUrlBlob(item.src));item.src=await urlOf({fileId:id})}out.push(item)}catch(e){}}
    ctx.addInspo(out);setBusy(false);ctx.toast(out.length?`${out.length} image${out.length===1?'':'s'} added to My Inspo`:'Those files could not be added')};
  useEffect(()=>{const h=e=>{const fs=[...(e.clipboardData?.files||[])];if(fs.length){e.preventDefault();add(fs);return}
    const t=e.clipboardData?.getData('text')||'';if(/(pinterest\.[a-z.]+\/pin\/|pin\.it\/)/i.test(t)&&!/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName||'')){e.preventDefault();addPin(t)}};
    addEventListener('paste',h);return()=>removeEventListener('paste',h)},[ctx.me.signedIn]);
  const list=ctx.inspo;const O=ctx.inspo.find(x=>x.id===open);
  return html`<main className="wrap" onDragOver=${e=>{e.preventDefault();setDrag(true)}} onDragLeave=${e=>{if(!e.currentTarget.contains(e.relatedTarget))setDrag(false)}} onDrop=${e=>{e.preventDefault();setDrag(false);add(e.dataTransfer.files)}}>
    <div className="ph-head"><div><h1>My <em>Inspo</em></h1><p className="mute" style=${{maxWidth:'58ch',marginTop:12,fontSize:16}}>Your reference images, visible only to you. Upload photos, paste a screenshot or a Pinterest pin link. Each image finds matching Louie pieces and goes straight into Studio or the 3D room.${ctx.me.signedIn?'':' Sign in to keep your library on every device.'}</p></div>
      <div className="row" style=${{flexWrap:'wrap'}}><button className="btn btn-ink" onClick=${()=>fileRef.current.click()}>${I('upload',{width:16})} Upload images</button><input ref=${fileRef} type="file" accept="image/*" multiple hidden onChange=${e=>{add(e.target.files);e.target.value=''}}/></div></div>
    <form className="row" style=${{gap:8,marginBottom:14,flexWrap:'wrap'}} onSubmit=${e=>{e.preventDefault();addPin(pinUrl)}}>
      <input className="field" style=${{flex:'1 1 320px',maxWidth:520}} aria-label="Pinterest pin link" placeholder="Paste a Pinterest pin link (pinterest.com/pin/… or pin.it/…)" value=${pinUrl} onInput=${e=>setPinUrl(e.target.value)}/>
      <button className="btn btn-line" disabled=${pinBusy||!pinUrl.trim()}>${I('pint',{width:16})} ${pinBusy?'Importing…':'Import pin'}</button></form>
    <div className=${'drop'+(drag?' on':'')} style=${{marginBottom:22}} onClick=${()=>fileRef.current.click()} onKeyDown=${e=>e.key==='Enter'&&fileRef.current.click()} role="button" tabIndex="0">${I('upload',{width:22})}<span><b style=${{color:'var(--ink)',fontWeight:500}}>${busy?'Adding…':drag?'Drop to add':'Drop images anywhere on this page'}</b>, paste a screenshot, or click to choose files</span></div>
    ${list.length?html`<div className="wall">${list.map(x=>html`<div key=${x.id} className="pin"><div className="pin-img" onClick=${()=>setOpen(x.id)}><img src=${x.src} alt=${x.title} style=${{aspectRatio:x.ar||1}}/>
        <div className="pin-ov"><div className="r1"><span className="pin-board"><span>${x.source==='pinterest'?'Pinterest':'Upload'}</span></span></div>
          <div className="r2"><span className="row" style=${{gap:4}}>${x.pal.slice(0,4).map(c=>html`<span key=${c} className="dot" style=${{width:16,height:16,background:c,boxShadow:'0 0 0 2px #fff'}}></span>`)}</span><button className="pin-act" aria-label="Mix in Studio" title="Mix in Studio" onClick=${e=>{e.stopPropagation();ctx.inspoToStudio(x)}}>${I('brush')}</button></div></div></div>
        <div className="pin-meta"><b>${x.title}</b></div></div>`)}</div>`
      :html`<div className="empty"><h3>Nothing here yet</h3><p>Upload a few photos or paste a screenshot to start.</p></div>`}
    ${O&&html`<${InspoDetail} ctx=${ctx} x=${O} onClose=${()=>setOpen(null)}/>`}
  </main>`;
}

function InspoDetail({ctx,x,onClose}){
  const [t,setT]=useState(x.title);
  const sim=[...PRODUCTS].sort((a,b)=>Math.min(...x.pal.map(c=>cdist(c,a.tone)))-Math.min(...x.pal.map(c=>cdist(c,b.tone)))).slice(0,8);
  return html`<div className="scrim" onClick=${e=>e.target===e.currentTarget&&onClose()} role="dialog" aria-modal="true" aria-label=${x.title}><div className="sheet">
    <div className="pd">
      <div className="pd-img"><button className="ib closer" aria-label="Close" onClick=${onClose}>${I('x')}</button><img src=${x.src} alt=${x.title}/></div>
      <div className="pd-body">
        <span className="mono mute">${x.source==='pinterest'?html`Imported from ${x.link?html`<a href=${x.link} target="_blank" rel="noopener">Pinterest</a>`:'Pinterest'}${x.author?' · '+x.author:''}`:'Your upload'} · private to you</span>
        <input className="field" aria-label="Image title" value=${t} onInput=${e=>setT(e.target.value)} onBlur=${()=>ctx.updateInspo(x.id,{title:t})} style=${{fontFamily:'var(--display)',fontSize:30,height:58}}/>
        <div><span className="st-h">Palette from this image</span><div className="palette" style=${{marginTop:8}}>${x.pal.map(c=>html`<i key=${c} style=${{background:c}} title=${c}></i>`)}</div></div>
        <div className="row" style=${{flexWrap:'wrap'}}>
          <button className="btn btn-ink" onClick=${()=>ctx.inspoToStudio(x,sim.slice(0,3).map(p=>p.id))}>${I('brush',{width:16})} Mix in Studio</button>
          <button className="btn btn-line" onClick=${()=>{ctx.setRoomWall(x.src);ctx.setRoomSeed(sim.slice(0,3).map(p=>p.id));ctx.go('room')}}>${I('cube',{width:16})} Use as 3D wall</button>
          ${x.link&&html`<a className="btn btn-line" href=${x.link} target="_blank" rel="noopener">${I('pint',{width:15})} Original pin</a>`}
          <button className="btn btn-line" style=${{color:'var(--bad)'}} onClick=${()=>{ctx.removeInspo(x.id);onClose()}}>${I('trash',{width:15})} Remove</button>
        </div>
        <p className="help">"Mix in Studio" places this image next to the three closest Louie pieces. Your images never carry prices or partner links when shared.</p>
      </div>
    </div>
    <div className="similar"><div className="sec-h" style=${{margin:'22px 0 16px'}}><h2 style=${{fontSize:34}}>Louie pieces for <em style=${{color:'var(--cognac)'}}>this look</em></h2><span className="mono mute">Ranked by color match</span></div><${Wall} items=${sim} ctx=${ctx}/></div>
  </div></div>`;
}

const plShape=(w,h,ops)=>{const T=window.THREE;const s=new T.Shape();s.moveTo(-w/2,0);s.lineTo(w/2,0);s.lineTo(w/2,h);s.lineTo(-w/2,h);s.lineTo(-w/2,0);
  ops.forEach(o=>{const p=new T.Path();const l=o.x-o.w/2,r=o.x+o.w/2;if(o.t==='arch'){const top=o.y+o.h-o.w/2;p.moveTo(l,o.y);p.lineTo(r,o.y);p.lineTo(r,top);p.absarc(o.x,top,o.w/2,0,Math.PI,false);p.lineTo(l,o.y)}else{p.moveTo(l,o.y);p.lineTo(r,o.y);p.lineTo(r,o.y+o.h);p.lineTo(l,o.y+o.h);p.lineTo(l,o.y)}s.holes.push(p)});return s};
/* ================= SPACE PLANNER: plan · model · walk, rendered as material, clay or line ================= */
const PL_FLOORS=[['oakWhite','Whitewashed oak'],['oakLight','Light oak'],['oak','Natural oak'],['oakGrey','Grey oak'],['oakDark','Dark oak'],['herring','Light herringbone'],['herringDark','Dark herringbone'],['tile','Porcelain tile'],['checker','Checkerboard tile'],['marbleLight','White marble'],['marble','Dark marble'],['terrazzo','Terrazzo'],['concrete','Concrete'],['carpet','Carpet']];
// A tint multiplies the floor's own colour: it recolours carpet and tile, and shades wood.
const PL_TINTS=[['','Natural'],['#C9B9A0','Oatmeal'],['#9FA3A0','Stone grey'],['#7C8A6E','Sage'],['#8C6A55','Clay'],['#5D6B80','Slate blue'],['#5A4A42','Charcoal brown']];
// Back-wall window layouts: x is the centre along the wall, in metres from its middle.
const PL_BACK=[['none','No windows',()=>[]],['one','One window',()=>[{t:'win',x:0,w:2.4,h:1.8,y:.8}]],['two','Two windows',W=>[-W/4,W/4].map(x=>({t:'win',x,w:1.6,h:1.8,y:.8}))],
  ['three','Three windows',W=>[-W/3,0,W/3].map(x=>({t:'win',x,w:1.4,h:1.9,y:.7}))],['arches','Two arches',W=>[-W/4,W/4].map(x=>({t:'arch',x,w:1.6,h:2.5,y:.4}))],['glass','Glass wall',(W,H)=>{const n=Math.max(2,Math.round((W-.6)/1.9));const w=(W-.6)/n-.15;return Array.from({length:n},(_,i)=>({t:'win',x:-W/2+.3+(i+.5)*(W-.6)/n,w,h:H-.6,y:.25}))}]];
const PL_WALLS=['#F1E9DC','#E9DCC8','#ECE4D1','#D8B4A6','#C9BFA9','#6C6948','#3B2A1E','#1F2A44'];
const PROXY_H={sofa:.82,sectional:.8,bench:.46,ottoman:.44,lighting:.35,stool:.75,chair:.8,table:.75};
// Pieces outside the curated 24 have no measured cutout: width comes from the listing's facts, the rest from their type.
const PL_W={sofa:220,sectional:280,bench:130,ottoman:80,lighting:60,stool:45,chair:70,table:120};
const PL_AR={sofa:[3,1],sectional:[2.2,1],bench:[3,1],ottoman:[2,1],lighting:[1,1],stool:[1,2],chair:[1,1.1],table:[2,1]};
const plCm=pid=>{const p=byId(pid);return APPROX_CM[pid]||p.widthCm||PL_W[p.type]||100};
const PL_TEMPLATES={blank:{label:'Blank room',W:8,D:6,H:3.2,wall:'#F1E9DC',floor:'oak',openings:[{wall:'back',t:'win',x:0,w:2.4,h:1.8,y:.8}],items:[]}};
SPACE_KEYS.forEach(k=>{const s=STUDY[k];PL_TEMPLATES[k]={label:SPACES[k].label+' study',W:s.W,D:s.D,H:s.H,wall:s.dark?'#3B2A1E':ROOMS[k].wall,floor:ROOMS[k].floor,openings:s.openings.map(o=>({...o,wall:'back'})),items:s.items.map(i=>({pid:i.id,x:i.x,z:i.z,rot:0,hang:!!i.hang}))}});
const plDims=pid=>{const p=byId(pid);const ar=CUT_AR[pid]||PL_AR[p.type]||[1,1];const w=plCm(pid)/100;return {p,w,d:p.type==='lighting'?w:(FOOT_D[p.type]||Math.min(w,.9)),hp:PROXY_H[p.type]||.8,hb:w*ar[1]/ar[0]}};
// Physical footprint: axis-aligned extents of the rotated piece, used for walls and collisions.
const plExt=it=>{const {w,d}=plDims(it.pid);const r=(it.rot||0)*Math.PI/180,c=Math.abs(Math.cos(r)),sn=Math.abs(Math.sin(r));return [c*w/2+sn*d/2,sn*w/2+c*d/2]};
const PL_GAP=.02,PL_SNAP=.12;
// Keep the piece inside the room; side and back walls pull it flush when it comes within 12 cm.
const plClamp=(doc,it,x,z)=>{const [ex,ez]=plExt(it);const lx=doc.W/2-ex,lz=doc.D/2-ez;x=Math.max(-lx,Math.min(lx,x));z=Math.max(-lz,Math.min(lz,z));
  if(lx-Math.abs(x)<PL_SNAP)x=(x<0?-1:1)*lx;if(z<0&&lz+z<PL_SNAP)z=-lz;return [x,z]};
// Floor pieces are solid: no two footprints may overlap (hanging lights are in the air and skip this).
const plHit=(doc,it,x,z)=>{if(it.hang)return false;const [ex,ez]=plExt(it);return doc.items.some(o=>{if(o.uid===it.uid||o.hang)return false;const [ox,oz]=plExt(o);return Math.abs(o.x-x)<ex+ox+PL_GAP-1e-6&&Math.abs(o.z-z)<ez+oz+PL_GAP-1e-6})};
// Nearest free, in-bounds spot to (x, z), searched outward in 5 cm rings.
const plPlace=(doc,it,x,z)=>{const [cx,cz]=plClamp(doc,it,x,z);if(!plHit(doc,it,cx,cz))return [cx,cz];
  for(let r=.05;r<5;r+=.05){const n=Math.max(8,Math.round(r*40));for(let k=0;k<n;k++){const a=k/n*Math.PI*2;const [px,pz]=plClamp(doc,it,x+Math.cos(a)*r,z+Math.sin(a)*r);if(!plHit(doc,it,px,pz))return [px,pz]}}
  return [cx,cz]};
const r2=v=>Math.round(v*100)/100;
// Rugs are layout guides in standard US sizes (metres from feet); they sit under furniture, so they never collide.
const RUG_SIZES=[['5 × 8 ft',1.52,2.44],['6 × 9 ft',1.83,2.74],['8 × 10 ft',2.44,3.05],['9 × 12 ft',2.74,3.66],['10 × 14 ft',3.05,4.27],['2.5 × 8 ft runner',.76,2.44],['6 ft round',1.83,1.83,1],['8 ft round',2.44,2.44,1]];
const RUG_MATS=[['jute','Jute'],['wool','Wool']];
const RUG_COLORS=[['','Natural'],['#F1EADC','Ivory'],['#D9C8A9','Oatmeal'],['#B4683F','Rust'],['#8E9A7C','Sage'],['#6E7787','Slate'],['#4A4440','Charcoal']];
const rugExt=r=>{if(r.round)return [r.w/2,r.w/2];const a=(r.rot||0)*Math.PI/180,c=Math.abs(Math.cos(a)),sn=Math.abs(Math.sin(a));return [c*r.w/2+sn*r.d/2,sn*r.w/2+c*r.d/2]};
const rugClamp=(doc,r,x,z)=>{const [ex,ez]=rugExt(r);const lx=Math.max(0,doc.W/2-ex),lz=Math.max(0,doc.D/2-ez);return [r2(Math.max(-lx,Math.min(lx,x))),r2(Math.max(-lz,Math.min(lz,z)))]};
// Re-seat every piece in order so nothing overlaps or pokes through a wall (after loading or resizing the room).
const plReflow=doc=>{const placed=[];for(const it of doc.items){const d={...doc,items:placed};const [x,z]=plPlace(d,it,it.x,it.z);placed.push({...it,x:r2(x),z:r2(z)})}return {...doc,items:placed,rugs:(doc.rugs||[]).map(r=>{const [x,z]=rugClamp(doc,r,r.x,r.z);return {...r,x,z}})}};
// Fit a back-wall preset to the room: openings never overlap, cross the wall's ends or rise past the ceiling.
const plFit=(W,H,ops)=>ops.map((o,i)=>{const near=Math.min(Infinity,...ops.filter((_,j)=>j!==i).map(p=>Math.abs(p.x-o.x)))-.15;let w=Math.max(.3,Math.min(o.w,near,2*(W/2-.1-Math.abs(o.x))));const y=Math.min(o.y,Math.max(.05,H-.5));const h=Math.max(.3,Math.min(o.h,H-y-.1));if(o.t==='arch')w=Math.min(w,2*(h-.05));return {...o,w:r2(w),y:r2(y),h:r2(h)}});
const plWord=(it,doc)=>`${it.x<-doc.W/6?'left':it.x>doc.W/6?'right':'centre'}${it.z<-doc.D/6?' back':it.z>doc.D/6?' front':''}`;

function Room({ctx}){
  const init=()=>{const key=PL_TEMPLATES[ctx.space]?ctx.space:'blank';const t=JSON.parse(JSON.stringify(PL_TEMPLATES[key]));let items=t.items;
    if(ctx.roomSeed&&ctx.roomSeed.length){items=ctx.roomSeed.map((pid,i)=>({pid,x:(i-(ctx.roomSeed.length-1)/2)*1.7,z:-t.D/2+1.3,rot:0,hang:byId(pid).type==='lighting'}))}
    return plReflow({...t,tpl:key,items:items.map(it=>({...it,uid:uid()})),rugs:[],wallImg:ctx.roomWall||null})};
  const [doc,setDoc]=useState(init);const [view,setView]=useState('orbit');const [style,setStyle]=useState('material');const [tod,setTod]=useState(.12);
  const [sel,setSel]=useState(null);const [tab,setTab]=useState('pieces');const [snap,setSnap]=useState(true);const [q,setQ]=useState('');const [cat,setCat]=useState('all');
  const [shot,setShot]=useState(null);const [showPrompt,setShowPrompt]=useState(false);const [proj,setProj]=useState(ctx.tray.active);
  const [three,threeFailed]=useThree();const [eng,setEng]=useState(0);
  const hist=useRef({past:[],future:[]});const vpRef=useRef(),cvRef=useRef(),labRef=useRef(),E=useRef({}),docRef=useRef(doc);docRef.current=doc;
  const commit=next=>{hist.current.past.push(docRef.current);if(hist.current.past.length>60)hist.current.past.shift();hist.current.future=[];setDoc(next)};
  const undo=()=>{const h=hist.current;if(!h.past.length)return;h.future.push(docRef.current);setDoc(h.past.pop())};
  const redo=()=>{const h=hist.current;if(!h.future.length)return;h.past.push(docRef.current);setDoc(h.future.pop())};
  const patchItem=(id,o)=>{const d=docRef.current;commit({...d,items:d.items.map(i=>{if(i.uid!==id)return i;const n={...i,...o};if('x' in o||'z' in o||'rot' in o){const [x,z]=plPlace(d,n,n.x,n.z);n.x=r2(x);n.z=r2(z)}return n})})};
  const addItem=(pid,x,z)=>{const d=docRef.current;const it={uid:uid(),pid,x:0,z:0,rot:0,hang:byId(pid).type==='lighting'};const [px,pz]=plPlace(d,it,x??0,z??0);it.x=r2(px);it.z=r2(pz);commit({...d,items:[...d.items,it]});setSel(it.uid)};
  const removeItem=id=>{const d=docRef.current;commit({...d,items:d.items.filter(i=>i.uid!==id),rugs:(d.rugs||[]).filter(r=>r.uid!==id)});setSel(null)};
  const rugOf=id=>(docRef.current.rugs||[]).find(r=>r.uid===id);
  const patchRug=(id,o)=>{const d=docRef.current;commit({...d,rugs:(d.rugs||[]).map(r=>{if(r.uid!==id)return r;const n={...r,...o};[n.x,n.z]=rugClamp(d,n,n.x,n.z);return n})})};
  // A new rug centres under the selected piece when there is one, so it lands where the seating is.
  const addRug=([size,w,dp,round])=>{const d=docRef.current;const at=d.items.find(i=>i.uid===sel);const r={uid:uid(),x:0,z:0,rot:0,w,d:dp,round:!!round,size,mat:'jute',color:''};[r.x,r.z]=rugClamp(d,r,at?at.x:0,at?at.z:0);commit({...d,rugs:[...(d.rugs||[]),r]});setSel(r.uid)};
  const patchSel=(id,o)=>rugOf(id)?patchRug(id,o):patchItem(id,o);
  const dupItem=id=>{const rg=rugOf(id);if(rg){const d=docRef.current;const n={...rg,uid:uid()};[n.x,n.z]=rugClamp(d,n,rg.x+.6,rg.z+.3);commit({...d,rugs:[...d.rugs,n]});setSel(n.uid);return}
    const it=docRef.current.items.find(i=>i.uid===id);if(!it)return;const d=docRef.current;const n={...it,uid:uid()};const [px,pz]=plPlace(d,n,it.x+.6,it.z+.3);n.x=r2(px);n.z=r2(pz);commit({...d,items:[...d.items,n]});setSel(n.uid)};
  useEffect(()=>{if(ctx.roomSeed)ctx.setRoomSeed(null);if(ctx.roomWall)ctx.setRoomWall(null)},[]);

  // ---------- engine ----------
  useEffect(()=>{
    if(!three)return;const T=three;const cv=cvRef.current,vp=vpRef.current;
    const renderer=new T.WebGLRenderer({canvas:cv,antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.75));
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;
    const scene=new T.Scene();const persp=new T.PerspectiveCamera(42,1,.05,200);const ortho=new T.OrthographicCamera(-5,5,5,-5,.1,100);
    const hemi=new T.HemisphereLight('#DDE7F0','#B8A58C',.6*LX);scene.add(hemi);
    const sun=new T.DirectionalLight('#FFF4E5',2.2*LX);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-14,right:14,top:14,bottom:-14,near:1,far:60});sun.shadow.bias=-.0004;sun.shadow.normalBias=.02;scene.add(sun,sun.target);
    const fill=new T.DirectionalLight('#FFF8EE',.3*LX);fill.position.set(2,5,9);scene.add(fill);
    const ground=new T.Mesh(new T.PlaneGeometry(120,120),new T.MeshStandardMaterial({color:'#EFE9DF',roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.003;ground.receiveShadow=true;scene.add(ground);
    const grid=new T.GridHelper(60,120,0x2B211A,0x2B211A);grid.material.transparent=true;grid.material.opacity=.07;scene.add(grid);
    const sky=new T.Mesh(new T.SphereGeometry(60,24,16),new T.MeshBasicMaterial({color:'#CFE0EA',side:T.BackSide}));scene.add(sky);
    const roomG=new T.Group(),itemsG=new T.Group(),rugsG=new T.Group(),dimG=new T.Group();scene.add(roomG,itemsG,rugsG,dimG);
    const loader=new T.TextureLoader();const cache={};const tex=(url,rep)=>{const k=url+(rep||'');if(cache[k])return cache[k];const t=loader.load(url);t.colorSpace=T.SRGBColorSpace;if(rep){t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(rep[0],rep[1])}t.anisotropy=8;return cache[k]=t};
    const CLAY=new T.MeshStandardMaterial({color:'#F0E9DB',roughness:.95});const LINE=new T.MeshBasicMaterial({color:'#FBFAF6',polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
    const PLANM=new T.MeshBasicMaterial({color:'#E7D7BF'});const PLANRUG=new T.MeshBasicMaterial({color:'#F3EADB',polygonOffset:true,polygonOffsetFactor:-1});const PLANSEL=new T.MeshBasicMaterial({color:'#F2C4A2'});
    const edgeM=new T.LineBasicMaterial({color:'#1E1B19'});const selM=new T.LineBasicMaterial({color:'#E8541E'});const fpM=new T.LineBasicMaterial({color:'#A65F2C'});const dimM=new T.LineBasicMaterial({color:'#E8541E'});
    const glowTex=(()=>{const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');const gr=g.createRadialGradient(64,64,0,64,64,64);gr.addColorStop(0,'rgba(255,214,150,1)');gr.addColorStop(.3,'rgba(255,170,80,.35)');gr.addColorStop(1,'rgba(255,150,60,0)');g.fillStyle=gr;g.fillRect(0,0,128,128);return new T.CanvasTexture(c)})();
    const S={doc:null,items:new Map(),rugs:new Map(),surfaces:[],edges:[],ceil:null,cam:{th:-.62,ph:.98,r:13,tx:0,ty:.6,tz:-.4},eye:{yaw:0,pitch:-.06,x:0,z:1.5},plan:{x:0,z:0,zoom:1},view:'orbit',style:'material',tod:.12,sel:null,snap:true,drag:null,dims:[]};
    const clear=g=>{while(g.children.length){const o=g.children.pop();o.traverse(c=>{if(c.geometry)c.geometry.dispose()})}};
    const rect=(w,d)=>{const a=w/2,b=d/2;return new T.BufferGeometry().setFromPoints([[-a,-b,a,-b],[a,-b,a,b],[a,b,-a,b],[-a,b,-a,-b]].flatMap(([x1,z1,x2,z2])=>[new T.Vector3(x1,0,z1),new T.Vector3(x2,0,z2)]))};
    function buildRoom(d){clear(roomG);S.surfaces=[];S.edges=[];const {W,D,H}=d;
      const ft=texture(d.floor),tile=FLOOR_TILE[d.floor]||2;const fm=new T.MeshStandardMaterial({map:tex(ft.url,[W/tile,D/tile]),color:new T.Color(d.floorTint||'#ffffff'),roughness:/marble|tile|checker/.test(d.floor)?.35:d.floor==='carpet'?1:.75});
      const floor=new T.Mesh(new T.PlaneGeometry(W,D),fm);floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;floor.userData.fin=fm;roomG.add(floor);S.surfaces.push(floor);
      const lime=texture('lime');
      const mk=(len,ops,place,back)=>{const g=new T.ExtrudeGeometry(plShape(len,H,ops),{depth:.2,bevelEnabled:false});const m=new T.MeshStandardMaterial({color:new T.Color(d.wall),roughness:.92});
        if(back&&d.wallImg){m.map=tex(d.wallImg);m.color=new T.Color('#ffffff')}else{const b=tex(lime.url,[len/4,H/4]);b.colorSpace=T.NoColorSpace;m.bumpMap=b;m.bumpScale=.012}
        const w=new T.Mesh(g,m);place(w);w.castShadow=w.receiveShadow=true;w.userData.fin=m;roomG.add(w);S.surfaces.push(w);const e=new T.LineSegments(new T.EdgesGeometry(g,25),edgeM);place(e);roomG.add(e);S.edges.push(e)};
      mk(W+.4,d.openings.filter(o=>o.wall==='back'),m=>m.position.set(0,0,-D/2-.2),true);
      mk(D,d.openings.filter(o=>o.wall==='left'),m=>{m.rotation.y=Math.PI/2;m.position.set(-W/2-.2,0,0)});
      mk(D,d.openings.filter(o=>o.wall==='right'),m=>{m.rotation.y=-Math.PI/2;m.position.set(W/2+.2,0,0)});
      const ceil=new T.Mesh(new T.PlaneGeometry(W+.4,D),new T.MeshStandardMaterial({color:'#F3EEE6',roughness:1,side:T.DoubleSide}));ceil.rotation.x=Math.PI/2;ceil.position.y=H;roomG.add(ceil);S.ceil=ceil;
      S.doc=d;applyLook()}
    function makeItem(it){const {p,w,d,hp,hb}=plDims(it.pid);const g=new T.Group();g.userData.uid=it.uid;
      const box=new T.BoxGeometry(w,hp,d);const proxy=new T.Mesh(box,CLAY);proxy.position.y=it.hang?0:hp/2;proxy.castShadow=proxy.receiveShadow=true;proxy.userData.uid=it.uid;g.add(proxy);
      const pe=new T.LineSegments(new T.EdgesGeometry(box),edgeM);pe.position.copy(proxy.position);g.add(pe);
      const map=tex(cut(it.pid));const bm=new T.MeshStandardMaterial({map,transparent:true,alphaTest:.45,side:T.DoubleSide,roughness:.85});const bb=new T.Mesh(new T.PlaneGeometry(w,hb),bm);bb.castShadow=true;bb.customDepthMaterial=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,map,alphaTest:.45});bb.position.y=it.hang?0:hb/2;g.add(bb);
      const fp=new T.LineSegments(rect(w,d),fpM);g.add(fp);
      let lamp=null;if(GLOW_AT[it.pid]){const gl=GLOW_AT[it.pid];const light=new T.PointLight('#FFB868',0,7,2);const spr=new T.Sprite(new T.SpriteMaterial({map:glowTex,transparent:true,opacity:0,depthWrite:false,blending:T.AdditiveBlending}));spr.scale.set(w*1.4,w*1.4,1);const ly=(.5-gl[1]/100)*hb+(it.hang?0:hb/2);light.position.set((gl[0]/100-.5)*w,ly,.05);spr.position.copy(light.position);g.add(light,spr);lamp={light,spr}}
      itemsG.add(g);return {g,proxy,pe,bb,fp,lamp,w,d,hp,hb}}
    const circ=r=>{const pts=[];for(let k=0;k<64;k++){const a=k/64*Math.PI*2,b=(k+1)/64*Math.PI*2;pts.push(new T.Vector3(Math.cos(a)*r,0,Math.sin(a)*r),new T.Vector3(Math.cos(b)*r,0,Math.sin(b)*r))}return new T.BufferGeometry().setFromPoints(pts)};
    function makeRug(r){const g=new T.Group();const wool=r.mat==='wool',rep=wool?1.5:.6;
      const fin=new T.MeshStandardMaterial({map:tex(texture(wool?'carpet':'jute').url,[r.w/rep,r.d/rep]),color:new T.Color(r.color||'#ffffff'),roughness:1,polygonOffset:true,polygonOffsetFactor:-1});
      const m=new T.Mesh(r.round?new T.CircleGeometry(r.w/2,64):new T.PlaneGeometry(r.w,r.d),fin);m.rotation.x=-Math.PI/2;m.position.y=.004;m.receiveShadow=true;m.userData.uid=r.uid;m.userData.fin=fin;g.add(m);
      const ol=new T.LineSegments(r.round?circ(r.w/2):rect(r.w,r.d),fpM);ol.position.y=.009;g.add(ol);rugsG.add(g);return {g,m,ol,w:r.w,d:r.d}}
    function placeRug(v){const r=v.it;v.g.position.set(r.x,0,r.z);v.g.rotation.y=(r.rot||0)*Math.PI/180}
    function syncRugs(rugs){const keep=new Set(rugs.map(r=>r.uid));for(const [k,v] of S.rugs){if(!keep.has(k)){rugsG.remove(v.g);v.g.traverse(c=>{if(c.geometry)c.geometry.dispose()});S.rugs.delete(k)}}
      rugs.forEach((r,i)=>{const sig=[r.w,r.d,r.round,r.mat,r.color].join();let v=S.rugs.get(r.uid);if(!v||v.sig!==sig){if(v){rugsG.remove(v.g);v.g.traverse(c=>{if(c.geometry)c.geometry.dispose()})}v=makeRug(r);v.sig=sig;S.rugs.set(r.uid,v)}v.it=r;v.m.position.y=.004+i*.0015;v.ol.position.y=.009+i*.0015;placeRug(v)});applyLook()}
    function syncItems(items){const keep=new Set(items.map(i=>i.uid));for(const [k,v] of S.items){if(!keep.has(k)){itemsG.remove(v.g);v.g.traverse(c=>{if(c.geometry)c.geometry.dispose()});S.items.delete(k)}}
      items.forEach(it=>{let v=S.items.get(it.uid);if(!v||v.pid!==it.pid){if(v){itemsG.remove(v.g)}v=makeItem(it);v.pid=it.pid;S.items.set(it.uid,v);if(S.ready&&!it.hang)v.drop=performance.now()}v.it=it;placeItem(v)});applyLook()}
    function placeItem(v){const it=v.it,d=S.doc;const y=it.hang?d.H-v.hb/2-.05:0;v.baseY=y;v.g.position.set(it.x,y,it.z);v.g.rotation.y=(it.rot||0)*Math.PI/180;v.fp.position.y=it.hang?-y+.012:.012}
    function applyLook(){const st=S.style,plan=S.view==='plan';
      S.surfaces.forEach(m=>{m.material=st==='material'?m.userData.fin:st==='clay'?CLAY:LINE});
      S.edges.forEach(e=>e.visible=st!=='material'||plan);edgeM.color.set(st==='clay'&&!plan?'#9C8E7E':'#1E1B19');if(S.ceil)S.ceil.visible=S.view==='eye';
      for(const [k,v] of S.rugs){const isSel=k===S.sel;v.m.material=plan?PLANRUG:st==='material'?v.m.userData.fin:st==='clay'?CLAY:LINE;v.ol.material=isSel?selM:fpM}
      for(const [k,v] of S.items){const isSel=k===S.sel;const showProxy=plan||st!=='material';v.proxy.visible=showProxy;v.proxy.material=plan?(isSel?PLANSEL:PLANM):st==='line'?LINE:CLAY;
        v.pe.visible=showProxy&&(st!=='material'||plan||isSel);v.pe.material=isSel?selM:edgeM;v.bb.visible=!plan&&st==='material';v.fp.visible=plan||isSel;v.fp.material=isSel?selM:fpM;
        v.bb.material.emissive=v.bb.material.emissive||new T.Color(0);v.bb.material.emissive.setScalar(isSel?.06:0)}
      sky.visible=st==='material'&&!plan;grid.visible=st!=='material'||plan;sun.castShadow=st!=='line'&&!plan}
    const C=(a,b,t)=>new T.Color(a).lerp(new T.Color(b),t);const tri=(a,b,c,t)=>t<.5?C(a,b,t*2):C(b,c,(t-.5)*2);const triN=(a,b,c,t)=>t<.5?a+(b-a)*t*2:b+(c-b)*(t-.5)*2;
    function lights(){const t=S.tod,st=S.style;const ang=t<.5?t*2:1;const sp=new T.Vector3().lerpVectors(new T.Vector3(7,10,8),new T.Vector3(-10,3.2,5),ang);sun.position.copy(sp);
      if(st==='material'){sun.color.copy(tri('#FFF4E5','#FFB46B','#33406A',t));sun.intensity=LX*(triN(2.3,2.1,0,t));hemi.color.copy(tri('#DDE7F0','#F4CFA2','#1C2335',t));hemi.groundColor.copy(tri('#B8A58C','#A47E5A','#1A1410',t));hemi.intensity=LX*(triN(.6,.5,.07,t));fill.intensity=LX*(triN(.35,.3,0,t));
        sky.material.color.copy(tri('#CFE0EA','#F0A866','#070B16',t));const bg=tri('#F1ECE4','#EADCC6','#120E0B',t);renderer.setClearColor(bg);ground.material.color.copy(bg);renderer.toneMappingExposure=triN(1.05,1.08,.92,t)}
      else if(st==='clay'){sun.color.set('#FFE2BC');sun.intensity=LX*(1.55);hemi.color.set('#B4C0EC');hemi.groundColor.set('#3A55B8');hemi.intensity=LX*(.55);fill.intensity=LX*(0);sun.position.set(-9,6.5,6);renderer.setClearColor('#EFE8DA');ground.material.color.set('#EFE8DA');renderer.toneMappingExposure=1.05}
      else{renderer.setClearColor('#F6F3EC');ground.material.color.set('#F6F3EC');hemi.intensity=LX*(.6);sun.intensity=LX*(1)}
      const lk=st==='material'?Math.max(0,Math.min(1,(t-.55)/.3)):0;for(const v of S.items.values()){if(v.lamp){v.lamp.light.intensity=LX*(lk*1.6);v.lamp.spr.material.opacity=lk*.9;v.lamp.spr.visible=!(S.view==='plan')}}}
    // cameras
    const size={w:1,h:1};function resize(){const r=vp.getBoundingClientRect();size.w=r.width;size.h=r.height;renderer.setSize(r.width,r.height,false);persp.aspect=r.width/r.height;persp.updateProjectionMatrix()}
    const ro=new ResizeObserver(resize);ro.observe(vp);resize();
    function camera(){const d=S.doc;if(S.view==='plan'){const a=size.w/size.h;const half=(Math.max(d.D,d.W/a)/2+1.2)/S.plan.zoom;ortho.left=-half*a;ortho.right=half*a;ortho.top=half;ortho.bottom=-half;ortho.position.set(S.plan.x,30,S.plan.z);ortho.up.set(0,0,-1);ortho.lookAt(S.plan.x,0,S.plan.z);ortho.updateProjectionMatrix();return ortho}
      if(S.view==='eye'){const e=S.eye;persp.fov=60;persp.updateProjectionMatrix();persp.up.set(0,1,0);persp.position.set(e.x,1.5,e.z);persp.lookAt(e.x+Math.sin(e.yaw)*Math.cos(e.pitch),1.5+Math.sin(e.pitch),e.z-Math.cos(e.yaw)*Math.cos(e.pitch));return persp}
      const c=S.cam;persp.fov=40;persp.updateProjectionMatrix();persp.up.set(0,1,0);persp.position.set(c.tx+c.r*Math.sin(c.ph)*Math.sin(c.th),c.ty+c.r*Math.cos(c.ph),c.tz+c.r*Math.sin(c.ph)*Math.cos(c.th));persp.lookAt(c.tx,c.ty,c.tz);return persp}
    // picking & dragging
    const ray=new T.Raycaster(),ndc=new T.Vector2(),floorP=new T.Plane(new T.Vector3(0,1,0),0),hit=new T.Vector3();
    const setNdc=e=>{const r=cv.getBoundingClientRect();ndc.set((e.clientX-r.left)/r.width*2-1,-((e.clientY-r.top)/r.height*2-1));ray.setFromCamera(ndc,S.camObj)};
    const floorAt=e=>{setNdc(e);return ray.ray.intersectPlane(floorP,hit)?hit.clone():null};
    const pickItem=e=>{setNdc(e);const hits=ray.intersectObjects([...S.items.values()].map(v=>v.proxy),false);if(hits.length)return hits[0].object.userData.uid;const rh=ray.intersectObjects([...S.rugs.values()].map(v=>v.m),false);return rh.length?rh[0].object.userData.uid:null};
    const snapV=v=>S.snap?Math.round(v/.05)*.05:v;
    const onDown=e=>{vp.focus();const id=pickItem(e);if(id&&e.button===0&&S.rugs.has(id)){const v=S.rugs.get(id);const f=floorAt(e);api.select(id);S.drag={kind:'rug',id,off:f?{x:v.it.x-f.x,z:v.it.z-f.z}:{x:0,z:0},moved:false};cv.setPointerCapture(e.pointerId);return}
      if(id&&e.button===0){const v=S.items.get(id);if(v.it.lock){api.select(id);return}const f=floorAt(e);api.select(id);S.drag={kind:'item',id,off:f?{x:v.it.x-f.x,z:v.it.z-f.z}:{x:0,z:0},moved:false};cv.setPointerCapture(e.pointerId);return}
      if(!id&&e.button===0&&!e.shiftKey)api.select(null);S.drag={kind:e.button===2||e.shiftKey?'pan':'cam',x:e.clientX,y:e.clientY};cv.setPointerCapture(e.pointerId)};
    const onMove=e=>{const g=S.drag;if(!g)return;const d=S.doc;
      if(g.kind==='rug'){const f=floorAt(e);if(!f)return;const v=S.rugs.get(g.id);const [nx,nz]=rugClamp(d,v.it,snapV(f.x+g.off.x),snapV(f.z+g.off.z));v.it={...v.it,x:nx,z:nz};placeRug(v);g.moved=true;return}
      if(g.kind==='item'){const f=floorAt(e);if(!f)return;const v=S.items.get(g.id);const dn={...d,items:[...S.items.values()].map(x=>x.it)};const it=v.it;let [nx,nz]=plClamp(dn,it,snapV(f.x+g.off.x),snapV(f.z+g.off.z));if(!plHit(dn,it,it.x,it.z)&&plHit(dn,it,nx,nz)){const [ax,az]=plClamp(dn,it,nx,it.z),[bx,bz]=plClamp(dn,it,it.x,nz);if(!plHit(dn,it,ax,az)){nx=ax;nz=az}else if(!plHit(dn,it,bx,bz)){nx=bx;nz=bz}else{nx=it.x;nz=it.z}}v.it={...it,x:nx,z:nz};placeItem(v);g.moved=true;return}
      const dx=e.clientX-g.x,dy=e.clientY-g.y;g.x=e.clientX;g.y=e.clientY;
      if(S.view==='plan'){const k=(ortho.right-ortho.left)/size.w;S.plan.x-=dx*k;S.plan.z-=dy*k;return}
      if(S.view==='eye'){S.eye.yaw+=dx*.004;S.eye.pitch=Math.max(-.6,Math.min(.5,S.eye.pitch-dy*.003));return}
      if(g.kind==='pan'){const c=S.cam;const k=c.r*.0016;c.tx-=(Math.cos(c.th)*dx)*k;c.tz-=(-Math.sin(c.th)*dx)*k;c.ty=Math.max(0,Math.min(3,c.ty+dy*k));return}
      S.cam.th-=dx*.006;S.cam.ph=Math.max(.12,Math.min(1.5,S.cam.ph-dy*.005))};
    const onUp=e=>{const g=S.drag;S.drag=null;if(g&&(g.kind==='item'||g.kind==='rug')&&g.moved){const v=(g.kind==='rug'?S.rugs:S.items).get(g.id);api.onMoved(g.id,{x:+v.it.x.toFixed(2),z:+v.it.z.toFixed(2)})}};
    const onWheel=e=>{e.preventDefault();const s=Math.sign(e.deltaY);if(S.view==='plan')S.plan.zoom=Math.max(.5,Math.min(4,S.plan.zoom*(s>0?.9:1.1)));else if(S.view==='eye'){const d=S.doc;S.eye.x=Math.max(-d.W/2+.4,Math.min(d.W/2-.4,S.eye.x-Math.sin(S.eye.yaw)*s*.35));S.eye.z=Math.max(-d.D/2+.4,Math.min(d.D/2+.4,S.eye.z+Math.cos(S.eye.yaw)*s*.35))}else S.cam.r=Math.max(3,Math.min(32,S.cam.r*(s>0?1.08:.93)))};
    const onDrop=e=>{e.preventDefault();const pid=+e.dataTransfer.getData('text/pid');if(!pid)return;const f=floorAt(e);api.onDrop(pid,f?snapV(f.x):0,f?snapV(f.z):0)};
    cv.addEventListener('pointerdown',onDown);cv.addEventListener('pointermove',onMove);cv.addEventListener('pointerup',onUp);cv.addEventListener('wheel',onWheel,{passive:false});cv.addEventListener('contextmenu',e=>e.preventDefault());cv.addEventListener('dragover',e=>e.preventDefault());cv.addEventListener('drop',onDrop);
    // labels (plan names, room dims, distances)
    const tmp=new T.Vector3();
    function labels(){const el=labRef.current;if(!el)return;const d=S.doc;const out=[];const proj=(x,y,z)=>{tmp.set(x,y,z).project(S.camObj);return [(tmp.x+1)/2*size.w,(1-tmp.y)/2*size.h,tmp.z<1]};
      if(S.view==='plan'){const a=proj(0,0,d.D/2+.45),b=proj(d.W/2+.55,0,0);out.push(`<span class="pl-lab dim" style="left:${a[0]}px;top:${a[1]}px">${d.W.toFixed(2)} m</span>`,`<span class="pl-lab dim" style="left:${b[0]}px;top:${b[1]}px">${d.D.toFixed(2)} m</span>`);
        for(const v of S.rugs.values()){const r=v.it;const p=proj(r.x,0,r.z+rugExt(r)[1]-.22);out.push(`<span class="pl-lab rug${r.uid===S.sel?' sel':''}" style="left:${p[0]}px;top:${p[1]}px">Rug · ${r.size}</span>`)}
        for(const v of S.items.values()){const p=proj(v.it.x,0,v.it.z);out.push(`<span class="pl-lab${v.it.uid===S.sel?' sel':''}" style="left:${p[0]}px;top:${p[1]}px">${byId(v.it.pid).name}</span>`)}}
      const sv=S.sel&&(S.items.get(S.sel)||S.rugs.get(S.sel));clear(dimG);
      if(sv&&S.view!=='eye'){const it=sv.it;const [hw,hd]=S.rugs.has(S.sel)?rugExt(it):[sv.w/2,sv.d/2];const segs=[[it.x-hw,it.z,-d.W/2,it.z],[it.x+hw,it.z,d.W/2,it.z],[it.x,it.z-hd,it.x,-d.D/2]];
        segs.forEach(([x1,z1,x2,z2])=>{const len=Math.hypot(x2-x1,z2-z1);if(len<.02)return;const g=new T.BufferGeometry().setFromPoints([new T.Vector3(x1,.03,z1),new T.Vector3(x2,.03,z2)]);dimG.add(new T.Line(g,dimM));const m=proj((x1+x2)/2,.03,(z1+z2)/2);if(m[2])out.push(`<span class="pl-lab dist" style="left:${m[0]}px;top:${m[1]}px">${len.toFixed(2)} m</span>`)})}
      el.innerHTML=out.join('')}
    const bounce=t=>{const n=7.5625,k=2.75;return t<1/k?n*t*t:t<2/k?n*(t-=1.5/k)*t+.75:t<2.5/k?n*(t-=2.25/k)*t+.9375:n*(t-=2.625/k)*t+.984375};
    let raf=0,run=true;const loop=()=>{if(!run)return;S.camObj=camera();const now=performance.now();for(const v of S.items.values()){if(v.drop!=null){const t=Math.min(1,(now-v.drop)/520);v.g.position.y=v.baseY+.45*(1-bounce(t));if(t>=1)v.drop=null}}for(const v of S.items.values()){if(v.bb.visible){const wp=v.g.position;v.bb.rotation.y=Math.atan2(S.camObj.position.x-wp.x,S.camObj.position.z-wp.z)-v.g.rotation.y}}lights();renderer.render(scene,S.camObj);labels();raf=requestAnimationFrame(loop)};
    const api={select:id=>{S.sel=id;applyLook();E.current.onSelect&&E.current.onSelect(id)},onMoved:(id,o)=>E.current.onMoved&&E.current.onMoved(id,o),onDrop:(pid,x,z)=>E.current.onDrop&&E.current.onDrop(pid,x,z)};
    Object.assign(E.current,{S,buildRoom,syncItems,syncRugs,applyLook,api,snapshot:()=>{renderer.render(scene,S.camObj);return cv.toDataURL('image/jpeg',.92)}});
    loop();setEng(n=>n+1);
    return()=>{run=false;cancelAnimationFrame(raf);ro.disconnect();scene.traverse(o=>{if(o.geometry)o.geometry.dispose()});renderer.dispose()};
  },[three]);
  // wire engine callbacks to React
  useEffect(()=>{Object.assign(E.current,{onSelect:id=>setSel(id),onMoved:(id,o)=>patchSel(id,o),onDrop:(pid,x,z)=>addItem(pid,x,z)})});
  const geoKey=JSON.stringify([doc.W,doc.D,doc.H,doc.wall,doc.floor,doc.floorTint,doc.openings,doc.wallImg?doc.wallImg.length:0]);
  useEffect(()=>{const e=E.current;if(!e.buildRoom)return;e.buildRoom(doc);e.syncItems(doc.items);setTimeout(()=>{if(e.S)e.S.ready=true},50)},[geoKey,eng]);
  useEffect(()=>{const e=E.current;if(e.syncItems)e.syncItems(doc.items)},[doc.items,eng]);
  useEffect(()=>{const e=E.current;if(e.syncRugs)e.syncRugs(doc.rugs||[])},[doc.rugs,eng]);
  useEffect(()=>{const e=E.current;if(!e.S)return;e.S.view=view;e.S.style=style;e.S.tod=tod;e.S.snap=snap;e.S.sel=sel;e.applyLook()},[view,style,tod,snap,sel,eng]);
  useEffect(()=>{const k=e=>{if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();e.shiftKey?redo():undo();return}
      if(e.key==='1')setView('plan');if(e.key==='2')setView('orbit');if(e.key==='3')setView('eye');
      const it=sel&&(docRef.current.items.find(i=>i.uid===sel)||rugOf(sel));if(!it)return;
      if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();removeItem(sel)}if(e.key==='r'||e.key==='R')patchSel(sel,{rot:((it.rot||0)+(e.shiftKey?-15:15)+360)%360});if(e.key==='d'&&!e.ctrlKey)dupItem(sel);if(e.key==='Escape')setSel(null);
      const step=e.shiftKey?.25:.05;const mv={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[e.key];if(mv){e.preventDefault();patchSel(sel,{x:+(it.x+mv[0]).toFixed(2),z:+(it.z+mv[1]).toFixed(2)})}};
    addEventListener('keydown',k);return()=>removeEventListener('keydown',k)});

  // ---------- derived ----------
  const S0=doc.items.find(i=>i.uid===sel);const SD=S0&&plDims(S0.pid);const R0=!S0&&(doc.rugs||[]).find(r=>r.uid===sel);
  const rugName=r=>`${r.color?RUG_COLORS.find(c=>c[0]===r.color)?.[1].toLowerCase()+' ':''}${r.mat} rug, ${r.size}`;
  const pieces=doc.items.map(i=>byId(i.pid));const retail=pieces.reduce((s,p)=>s+p.price,0);const seats=pieces.reduce((s,p)=>s+p.seats,0);
  const todLabel=(()=>{const m=Math.round((7.5*60+tod*15.5*60)/10)*10;return `${String(Math.floor(m/60)%24).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`})();
  const prompt=`Photorealistic interior photograph of a ${doc.W} × ${doc.D} m room with a ${doc.H} m ceiling. Walls in ${doc.wall} limewash plaster, ${PL_FLOORS.find(f=>f[0]===doc.floor)?.[1].toLowerCase()} floor. Openings: ${doc.openings.map(o=>`${o.t==='arch'?'an arched window':o.t==='door'?'a doorway':'a window'} on the ${o.wall} wall`).join(', ')||'none'}.\n${(doc.rugs||[]).length?`Rugs: ${doc.rugs.map(r=>`a ${rugName(r)} at ${plWord(r,doc)}`).join('; ')}.\n`:''}Furnished with exactly these Louie Mae pieces, matching their product photos: ${doc.items.map(i=>{const p=byId(i.pid);return `${p.name} ${p.line} at ${plWord(i,doc)}`}).join('; ')||'no furniture yet'}.\nLight: ${tod<.35?'soft morning daylight':tod<.7?'warm golden-hour sun':'after dark, lit by warm lamps'} (${todLabel}). Three-quarter view at 1.3 m height, 26 mm lens, straight verticals, editorial interior photography. No people, no text.`;
  const prods=PRODUCTS.filter(p=>(cat==='all'||p.type===cat)&&(p.name+' '+p.line+' '+p.mat).toLowerCase().includes(q.toLowerCase()));
  const setOpening=(i,o)=>commit({...doc,openings:doc.openings.map((x,k)=>k===i?{...x,...o}:x)});
  const wallLen=w=>w==='back'?doc.W:doc.D;
  return html`<main className="pl">
    <aside className="pl-side">
      <div className="tabs left" style=${{margin:0}}>${[['room','Room'],['pieces','Pieces'],['layers','Layers']].map(([k,l])=>html`<button key=${k} className=${tab===k?'on':''} onClick=${()=>setTab(k)}>${l}</button>`)}</div>
      ${tab==='room'&&html`<div className="pl-sec">
        <label className="lbl" htmlFor="pl-tpl">Start from</label>
        <select id="pl-tpl" className="field" value=${doc.tpl} onChange=${e=>{const t=JSON.parse(JSON.stringify(PL_TEMPLATES[e.target.value]));commit(plReflow({...t,tpl:e.target.value,items:t.items.map(it=>({...it,uid:uid()})),wallImg:null}));setSel(null)}}>${Object.entries(PL_TEMPLATES).map(([k,t])=>html`<option key=${k} value=${k}>${t.label}</option>`)}</select>
        <div className="pl-dims">${[['W','Width',3,30],['D','Depth',3,24],['H','Height',2.4,8]].map(([k,l,mn,mx])=>html`<label key=${k}><span className="mono mute">${l} (m)</span><input className="field num" type="number" step="0.1" min=${mn} max=${mx} value=${doc[k]} onChange=${e=>{const v=Math.max(mn,Math.min(mx,+e.target.value||mn));commit(plReflow({...doc,[k]:v}))}}/></label>`)}</div>
        <span className="lbl">Walls</span>
        <div className="swatches">${PL_WALLS.map(c=>html`<button key=${c} className=${doc.wall===c&&!doc.wallImg?'on':''} style=${{background:c}} aria-label=${'Wall '+c} onClick=${()=>commit({...doc,wall:c,wallImg:null})}></button>`)}<label className="pl-color" title="Custom colour"><input type="color" value=${doc.wall} onChange=${e=>commit({...doc,wall:e.target.value})} aria-label="Custom wall colour"/></label></div>
        <label className="btn btn-line btn-sm" style=${{cursor:'pointer'}}>${I('upload',{width:14})} Photo on back wall<input type="file" accept="image/*" hidden onChange=${e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>commit({...doc,wallImg:r.result});r.readAsDataURL(f)}}/></label>
        ${ctx.inspo.length>0&&html`<div className="pl-mini">${ctx.inspo.slice(0,6).map(x=>html`<button key=${x.id} title=${'Use '+x.title} onClick=${()=>commit({...doc,wallImg:x.src})}><img src=${x.src} alt=""/></button>`)}</div>`}
        <span className="lbl">Floor</span>
        <div className="pl-floors">${PL_FLOORS.map(([k,l])=>html`<button key=${k} className=${doc.floor===k?'on':''} onClick=${()=>commit({...doc,floor:k})}><i style=${{backgroundImage:`url(${texture(k).url})`}}></i>${l}</button>`)}</div>
        <span className="lbl">Floor colour</span>
        <div className="swatches">${PL_TINTS.map(([c,l])=>html`<button key=${l} title=${l} aria-label=${'Floor colour '+l} className=${(doc.floorTint||'')===c?'on':''} style=${{background:c||'linear-gradient(135deg,#fff 45%,#ccc 55%)'}} onClick=${()=>commit({...doc,floorTint:c})}></button>`)}<label className="pl-color" title="Custom floor colour"><input type="color" value=${doc.floorTint||'#ffffff'} onChange=${e=>commit({...doc,floorTint:e.target.value})} aria-label="Custom floor colour"/></label></div>
        <span className="lbl">Back wall</span>
        <div className="pl-floors">${PL_BACK.map(([k,l,f])=>html`<button key=${k} onClick=${()=>commit({...doc,openings:[...doc.openings.filter(o=>o.wall!=='back'),...plFit(doc.W,doc.H,f(doc.W,doc.H)).map(o=>({...o,wall:'back'}))]})}>${l}</button>`)}</div>
        <div className="row" style=${{justifyContent:'space-between'}}><span className="lbl" style=${{margin:0}}>Openings</span><button className="lnk" onClick=${()=>commit({...doc,openings:[...doc.openings,{wall:'back',t:'win',x:0,w:1.4,h:1.8,y:.8}]})}>+ Add</button></div>
        ${doc.openings.map((o,i)=>{const L=wallLen(o.wall);return html`<div key=${i} className="pl-open">
          <div className="row" style=${{gap:6}}><select className="field" value=${o.wall} onChange=${e=>setOpening(i,{wall:e.target.value,x:0})} aria-label="Wall">${['back','left','right'].map(w=>html`<option key=${w} value=${w}>${w} wall</option>`)}</select>
          <select className="field" value=${o.t} onChange=${e=>{const t=e.target.value;setOpening(i,t==='door'?{t,y:.02,h:2.2,w:1}:t==='arch'?{t,y:.5,h:2.4,w:Math.max(1.4,o.w)}:{t,y:.8,h:1.8})}} aria-label="Type"><option value="win">Window</option><option value="arch">Arch</option><option value="door">Door</option></select>
          <button className="ib" aria-label="Remove opening" onClick=${()=>commit({...doc,openings:doc.openings.filter((_,k)=>k!==i)})}>${I('x',{width:14})}</button></div>
          <label className="pl-range"><span className="mono mute">Position</span><input type="range" min=${-L/2+o.w/2+.1} max=${L/2-o.w/2-.1} step="0.05" value=${o.x} onInput=${e=>setOpening(i,{x:+e.target.value})}/></label>
          <label className="pl-range"><span className="mono mute">Width ${o.w.toFixed(1)} m</span><input type="range" min=".6" max=${Math.min(6,L-.4)} step="0.1" value=${o.w} onInput=${e=>setOpening(i,{w:+e.target.value,x:Math.max(-L/2+ +e.target.value/2+.1,Math.min(L/2- +e.target.value/2-.1,o.x))})}/></label>
        </div>`})}
      </div>`}
      ${tab==='pieces'&&html`<div className="pl-sec">
        <span className="lbl">Rugs · layout guide</span>
        <p className="help" style=${{margin:0}}>Standard sizes. A rug lands under the selected piece, or in the middle of the room.</p>
        <div className="pl-floors">${RUG_SIZES.map(z=>html`<button key=${z[0]} onClick=${()=>addRug(z)}><i style=${{background:'#D8C7A6',borderRadius:z[3]?'50%':'3px',width:z[3]?22:Math.round(14+z[1]*4),height:z[3]?22:Math.round(10+z[2]*3)}}></i>${z[0]}</button>`)}</div>
        <span className="lbl">Pieces</span>
        <input className="field" style=${{height:40}} placeholder="Search pieces" aria-label="Search pieces" value=${q} onInput=${e=>setQ(e.target.value)}/>
        <div className="scroll-x">${[['all','All'],...Object.entries(TYPE)].map(([k,l])=>html`<button key=${k} className=${'chip'+(cat===k?' on':'')} style=${{height:30,fontSize:12}} onClick=${()=>setCat(k)}>${l}</button>`)}</div>
        <p className="help" style=${{margin:0}}>Click to place in the middle of the room, or drag onto the floor.</p>
        <div className="pl-cat">${prods.map(p=>html`<button key=${p.id} draggable="true" onDragStart=${e=>e.dataTransfer.setData('text/pid',String(p.id))} onClick=${()=>addItem(p.id,0,0)} title=${'Place '+p.name}><img src=${cut(p.id)} alt="" loading="lazy"/><b>${p.name}</b><span className="mono">${plCm(p.id)} cm · ${ctx.mode==='trade'?fmt(tp(p)):fmt(p.price)}</span></button>`)}</div>
      </div>`}
      ${tab==='layers'&&html`<div className="pl-sec">${doc.items.length?doc.items.map(it=>{const p=byId(it.pid);return html`<div key=${it.uid} className=${'layer'+(sel===it.uid?' on':'')} onClick=${()=>setSel(it.uid)}><span className="th" style=${{backgroundImage:`url(${cut(it.pid)})`,backgroundSize:'contain',backgroundRepeat:'no-repeat',backgroundPosition:'center'}}></span><span>${p.name}</span><button className="ib" aria-label=${it.lock?'Unlock':'Lock'} onClick=${e=>{e.stopPropagation();patchItem(it.uid,{lock:!it.lock})}}>${I(it.lock?'lock':'unlock')}</button><button className="ib" aria-label="Remove" onClick=${e=>{e.stopPropagation();removeItem(it.uid)}}>${I('trash')}</button></div>`}):html`<p className="help">No pieces yet. Add some from the Pieces tab.</p>`}
        ${(doc.rugs||[]).map(r=>html`<div key=${r.uid} className=${'layer'+(sel===r.uid?' on':'')} onClick=${()=>setSel(r.uid)}><span className="th" style=${{background:r.color||'#D8C7A6',borderRadius:r.round?'50%':'4px'}}></span><span>Rug · ${r.size}</span><button className="ib" aria-label="Remove" onClick=${e=>{e.stopPropagation();removeItem(r.uid)}}>${I('trash')}</button></div>`)}</div>`}
    </aside>

    <section className="pl-main">
      <div className="pl-bar">
        <div className="seg" role="group" aria-label="View">${[['plan','Plan','1'],['orbit','Model','2'],['eye','Walk','3']].map(([k,l,n])=>html`<button key=${k} className=${view===k?'on':''} onClick=${()=>setView(k)} title=${l+' ('+n+')'}>${l}</button>`)}</div>
        <div className="seg" role="group" aria-label="Render style">${[['material','Render'],['clay','Clay'],['line','Line']].map(([k,l])=>html`<button key=${k} className=${style===k?'on':''} onClick=${()=>setStyle(k)}>${l}</button>`)}</div>
        <label className="pl-tod"><span className="mono">${todLabel}</span><input type="range" min="0" max="1" step="0.01" value=${tod} onInput=${e=>setTod(+e.target.value)} aria-label="Time of day"/></label>
        <button className=${'chip'+(snap?' on':'')} onClick=${()=>setSnap(!snap)} title="Snap to 5 cm">Snap</button>
        <span style=${{flex:1}}></span>
        <button className="ib" aria-label="Undo" title="Undo (Ctrl+Z)" onClick=${undo}>${I('undo')}</button>
        <button className="ib" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" onClick=${redo}>${I('redo')}</button>
        <button className="btn btn-line btn-sm" disabled=${!eng} onClick=${()=>setShot(E.current.snapshot())}>${I('cam',{width:15})} Snapshot</button>
        <button className="btn btn-cog btn-sm" onClick=${()=>setShowPrompt(true)}>${I('wand',{width:15})} Render brief</button>
      </div>
      <div className="pl-vp" ref=${vpRef} tabIndex="0" aria-label="Room viewport">
        <canvas ref=${cvRef} className="pl-cv"></canvas>
        <div className="pl-labels" ref=${labRef} aria-hidden="true"></div>
        ${threeFailed&&html`<div className="pl-fail" role="alert">The 3D view could not load. Check your connection and reload the page to try again.</div>`}
        <div className="pl-hint mono">${view==='plan'?'Drag to pan · scroll to zoom · drag a piece to move it':view==='eye'?'Drag to look around · scroll to walk':'Drag to orbit · shift-drag to pan · scroll to zoom · drag a piece to move it'} · R rotate · D duplicate</div>
        <div className="pl-style-tag mono">${style==='material'?'Render · materials and light':style==='clay'?'Clay · massing study':'Line · drafting'} · ${doc.W}×${doc.D} m</div>
      </div>
      <div className="st-foot">
        <span><span className="mono">${doc.items.length} pieces · ${seats} seats</span><br/><b className="num">${fmt(pieces.reduce((s,p)=>s+pr(p,ctx.mode),0))}</b> <span className="mono">${ctx.mode}</span></span>
        <span className="row" style=${{flexWrap:'wrap'}}>
          <select className="field" style=${{height:38,width:'auto',background:'transparent',color:'inherit',borderColor:'rgba(127,127,127,.4)'}} value=${proj} onChange=${e=>setProj(e.target.value)} aria-label="Project">${ctx.tray.projects.map(p=>html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}</select>
          <button className="btn" style=${{background:'var(--onink)',color:'var(--ink)'}} disabled=${!doc.items.length} onClick=${()=>{const P=ctx.tray.projects.find(p=>p.id===proj);doc.items.forEach(i=>ctx.addToProject(i.pid,1,proj,P.zones[0],null,true));ctx.toast(`${doc.items.length} pieces added to ${P.name}`,{label:'Open tray',fn:()=>ctx.setTray(true)})}}>${I('tray',{width:16})} Add room to project</button>
        </span>
      </div>
    </section>

    <aside className="pl-side r">
      ${R0?html`<div className="pl-sec">
        <span className="eyebrow">Rug · layout guide</span><h3 style=${{fontSize:26}}>${R0.size}</h3>
        <div className="kv"><span className="mono mute">Size</span><span>${R0.round?`${R0.w.toFixed(2)} m across`:`${R0.w.toFixed(2)} × ${R0.d.toFixed(2)} m`}</span><span className="mono mute">Price</span><span>Not priced</span>
          <span className="mono mute">To left wall</span><span>${(R0.x-rugExt(R0)[0]+doc.W/2).toFixed(2)} m</span><span className="mono mute">To right wall</span><span>${(doc.W/2-R0.x-rugExt(R0)[0]).toFixed(2)} m</span><span className="mono mute">To back wall</span><span>${(R0.z-rugExt(R0)[1]+doc.D/2).toFixed(2)} m</span></div>
        <span className="lbl">Size</span>
        <div className="pl-floors">${RUG_SIZES.map(z=>html`<button key=${z[0]} className=${R0.size===z[0]?'on':''} onClick=${()=>patchRug(R0.uid,{size:z[0],w:z[1],d:z[2],round:!!z[3]})}>${z[0]}</button>`)}</div>
        <span className="lbl">Material</span>
        <div className="seg">${RUG_MATS.map(([k,l])=>html`<button key=${k} className=${R0.mat===k?'on':''} onClick=${()=>patchRug(R0.uid,{mat:k})}>${l}</button>`)}</div>
        <span className="lbl">Colour</span>
        <div className="swatches">${RUG_COLORS.map(([c,l])=>html`<button key=${l} title=${l} aria-label=${'Rug colour '+l} className=${R0.color===c?'on':''} style=${{background:c||'#CDBB98'}} onClick=${()=>patchRug(R0.uid,{color:c})}></button>`)}</div>
        <div className="pl-dims">${[['x','X (m)'],['z','Z (m)']].map(([k,l])=>html`<label key=${k}><span className="mono mute">${l}</span><input className="field num" type="number" step="0.05" value=${R0[k]} onChange=${e=>patchRug(R0.uid,{[k]:+e.target.value||0})}/></label>`)}<label><span className="mono mute">Rotate</span><input className="field num" type="number" step="15" value=${R0.rot||0} onChange=${e=>patchRug(R0.uid,{rot:((+e.target.value||0)%360+360)%360})}/></label></div>
        <div className="row" style=${{flexWrap:'wrap',gap:6}}>
          <button className="btn btn-line btn-sm" onClick=${()=>patchRug(R0.uid,{rot:((R0.rot||0)+90)%360})}>↻ 90°</button>
          <button className="btn btn-line btn-sm" onClick=${()=>dupItem(R0.uid)}>${I('copy',{width:14})} Duplicate</button>
          <button className="btn btn-line btn-sm" style=${{color:'var(--bad)'}} onClick=${()=>removeItem(R0.uid)}>${I('trash',{width:14})} Remove</button>
        </div>
      </div>`:S0?html`<div className="pl-sec">
        <div className="pl-insp-h"><img src=${cut(S0.pid)} alt=""/><div><span className="mono mute">${SD.p.sku} · ${MAT[SD.p.mat]}</span><h3>${SD.p.name}</h3><p className="mute" style=${{fontSize:13}}>${SD.p.line}</p></div></div>
        <div className="kv"><span className="mono mute">Footprint</span><span>${SD.w.toFixed(2)} × ${SD.d.toFixed(2)} m (approx.)</span><span className="mono mute">Price</span><span>${ctx.mode==='trade'?fmt(tp(SD.p),true):fmt(SD.p.price,true)}</span>
          <span className="mono mute">To left wall</span><span>${(S0.x-SD.w/2+doc.W/2).toFixed(2)} m</span><span className="mono mute">To right wall</span><span>${(doc.W/2-S0.x-SD.w/2).toFixed(2)} m</span><span className="mono mute">To back wall</span><span>${(S0.z-SD.d/2+doc.D/2).toFixed(2)} m</span></div>
        <div className="pl-dims">${[['x','X (m)'],['z','Z (m)']].map(([k,l])=>html`<label key=${k}><span className="mono mute">${l}</span><input className="field num" type="number" step="0.05" value=${S0[k]} onChange=${e=>patchItem(S0.uid,{[k]:+e.target.value||0})}/></label>`)}<label><span className="mono mute">Rotate</span><input className="field num" type="number" step="15" value=${S0.rot||0} onChange=${e=>patchItem(S0.uid,{rot:((+e.target.value||0)%360+360)%360})}/></label></div>
        <div className="row" style=${{flexWrap:'wrap',gap:6}}>
          <button className="btn btn-line btn-sm" onClick=${()=>patchItem(S0.uid,{rot:((S0.rot||0)+345)%360})}>↺ 15°</button><button className="btn btn-line btn-sm" onClick=${()=>patchItem(S0.uid,{rot:((S0.rot||0)+15)%360})}>↻ 15°</button>
          <button className="btn btn-line btn-sm" onClick=${()=>dupItem(S0.uid)}>${I('copy',{width:14})} Duplicate</button>
          <button className="btn btn-line btn-sm" onClick=${()=>patchItem(S0.uid,{lock:!S0.lock})}>${I(S0.lock?'unlock':'lock',{width:14})} ${S0.lock?'Unlock':'Lock'}</button>
          <button className="btn btn-line btn-sm" style=${{color:'var(--bad)'}} onClick=${()=>removeItem(S0.uid)}>${I('trash',{width:14})} Remove</button>
        </div>
        <button className="btn btn-ink btn-sm" onClick=${()=>ctx.openPin(S0.pid)}>View product</button>
      </div>`:html`<div className="pl-sec">
        <span className="eyebrow">Space Planner</span><h3 style=${{fontSize:30}}>Plan it, model it, <em style=${{color:'var(--cognac)'}}>render it.</em></h3>
        <p className="help" style=${{margin:0}}>Draft the room in plan, study the massing in clay, check proportions in line, then walk it in full materials with real light. Select any piece to measure and adjust it.</p>
        <div className="pl-modes">
          <div><b>Plan</b><span>Top-down drafting with live dimensions to every wall.</span></div>
          <div><b>Model</b><span>Orbit the room. Clay mode shows massing with sun and blue shadows.</span></div>
          <div><b>Walk</b><span>Eye level at 1.5 m, with the ceiling on, to judge scale.</span></div>
          <div><b>Render brief</b><span>Writes a photoreal render prompt from your exact layout.</span></div>
        </div>
        <span className="lbl">In this room</span>
        ${doc.items.length?[...new Set(doc.items.map(i=>i.pid))].map(pid=>{const n=doc.items.filter(i=>i.pid===pid).length;const p=byId(pid);return html`<div key=${pid} className="sumrow"><span>${n} × ${p.name}</span><span>${fmt(pr(p,ctx.mode)*n)}</span></div>`}):html`<p className="help">Empty. Add pieces from the left.</p>`}
      </div>`}
    </aside>

    ${shot&&html`<div className="scrim" onClick=${e=>e.target===e.currentTarget&&setShot(null)} role="dialog" aria-modal="true" aria-label="Snapshot"><div className="sheet share" style=${{width:'min(1000px,100%)'}}><div className="row" style=${{justifyContent:'space-between'}}><h2 style=${{fontSize:32}}>Snapshot</h2><button className="ib" aria-label="Close" onClick=${()=>setShot(null)}>${I('x')}</button></div><img src=${shot} alt="Snapshot of the room" style=${{borderRadius:12}}/><p className="help">Right-click the image to save it, or attach it to a board.</p></div></div>`}
    ${showPrompt&&html`<div className="scrim" onClick=${e=>e.target===e.currentTarget&&setShowPrompt(false)} role="dialog" aria-modal="true" aria-label="Render brief"><div className="sheet share" style=${{width:'min(720px,100%)'}}>
      <div className="row" style=${{justifyContent:'space-between'}}><h2 style=${{fontSize:32}}>Render <em style=${{color:'var(--cognac)'}}>brief</em></h2><button className="ib" aria-label="Close" onClick=${()=>setShowPrompt(false)}>${I('x')}</button></div>
      <p className="help" style=${{margin:0}}>Written from your exact layout, materials and light. Use it with a snapshot and the product photos to generate a photoreal render, or send it to the House team to render for you.</p>
      <pre style=${{whiteSpace:'pre-wrap',background:'var(--plaster)',padding:16,borderRadius:12,fontFamily:'var(--mono)',fontSize:12.5,lineHeight:1.6,margin:0,maxHeight:320,overflow:'auto'}}>${prompt}</pre>
      <div className="row" style=${{flexWrap:'wrap'}}><button className="btn btn-ink btn-sm" onClick=${()=>copyText(prompt,ctx.toast)}>${I('copy',{width:14})} Copy brief</button><button className="btn btn-line btn-sm" disabled=${!eng} onClick=${()=>{setShowPrompt(false);setShot(E.current.snapshot())}}>${I('cam',{width:14})} Take snapshot</button><button className="btn btn-line btn-sm" onClick=${()=>{ctx.toast('Render request sent to the House team (prototype).');setShowPrompt(false)}}>Request a render from the House</button></div>
    </div></div>`}
  </main>`;
}

/* ================= BOARDS ================= */
function Boards({ctx}){
  const [tab,setTab]=useState('boards');const [sort,setSort]=useState('recent');const [mk,setMk]=useState(false);const [n,setN]=useState('');const [sec,setSec]=useState(false);
  let bs=[...ctx.boards];if(sort==='az')bs.sort((a,b)=>a.title.localeCompare(b.title));else bs.sort((a,b)=>b.t-a.t);
  const allPins=[...new Set(ctx.boards.flatMap(b=>b.pins.map(p=>p.pid)))].map(byId);
  return html`<main className="wrap">
    <div className="ph-head"><div><span className="eyebrow">Your saved ideas</span><h1>Boards & <em>collages</em></h1></div>
      <div className="row" style=${{flexWrap:'wrap'}}><button className="btn btn-line" onClick=${()=>ctx.go('inspo')}>${I('img',{width:16})} My Inspo</button><button className="btn btn-line" onClick=${()=>ctx.go('profile')}>View profile</button><button className="btn btn-ink" onClick=${()=>setMk(true)}>${I('plus',{width:16})} Create</button></div></div>
    <div className="row" style=${{justifyContent:'space-between',flexWrap:'wrap',borderBottom:'1px solid var(--line)',marginBottom:24}}>
      <div className="tabs left" style=${{margin:0}}>${[['pins','Pins'],['boards','Boards'],['collages','Collages']].map(([k,l])=>html`<button key=${k} className=${tab===k?'on':''} onClick=${()=>setTab(k)}>${l}</button>`)}</div>
      ${tab==='boards'&&html`<label className="row" style=${{fontSize:13}}>Sort by <select className="field" style=${{height:34,width:'auto',borderRadius:999}} value=${sort} onChange=${e=>setSort(e.target.value)}><option value="recent">Last saved to</option><option value="az">A to Z</option></select></label>`}
    </div>
    ${tab==='boards'&&html`<div className="boards">
      ${bs.map(b=>html`<button key=${b.id} className="bcard" onClick=${()=>{ctx.setBoard(b.id);ctx.go('board')}}>
        <div className="cov">${[0,1,2].map(i=>html`<div key=${i} style=${{backgroundImage:b.pins[i]?`url(${byId(b.pins[i].pid).img})`:'none'}}></div>`)}</div>
        <h2>${b.title}</h2><p>${b.pins.length} pins${b.sections.length?` · ${b.sections.length} sections`:''}${b.secret?' · Secret':''}${b.collab?` · ${b.collab} collaborator${b.collab>1?'s':''}`:''}</p></button>`)}
      <button className="newboard" onClick=${()=>setMk(true)}><span>${I('plus',{width:22})}<br/>New board</span></button>
    </div>`}
    ${tab==='pins'&&html`<${Wall} items=${allPins} ctx=${ctx}/>`}
    ${tab==='collages'&&html`<div className="boards">${ctx.collages.map((c,i)=>html`<button key=${i} className="bcard" onClick=${()=>{ctx.setStudioSeed({ids:c.els.filter(e=>e.kind==='img').map(e=>e.pid),title:c.title});ctx.go('studio')}}>
        <div className="cov" style=${{background:'var(--plaster)'}}>${c.els.filter(e=>e.kind==='img').slice(0,3).map((e,j)=>html`<div key=${j} style=${{backgroundImage:`url(${byId(e.pid).img})`}}></div>`)}</div><h2>${c.title}</h2><p>${c.els.filter(e=>e.kind==='img').length} pieces · Open in Studio</p></button>`)}
      <button className="newboard" onClick=${()=>ctx.go('studio')}><span>${I('brush',{width:22})}<br/>New collage</span></button></div>`}
    ${mk&&html`<div className="scrim" onClick=${e=>e.target===e.currentTarget&&setMk(false)} role="dialog" aria-modal="true" aria-label="Create board"><form className="sheet share" onSubmit=${e=>{e.preventDefault();if(!n.trim())return;const id=ctx.createBoard(n.trim(),null,sec);setMk(false);setN('');ctx.setBoard(id);ctx.go('board')}}>
      <h2 style=${{fontSize:38}}>Create a board</h2>
      <div><label className="lbl" htmlFor="bn">Name</label><input id="bn" className="field" autoFocus placeholder="e.g. Harbor Street lobby" value=${n} onInput=${e=>setN(e.target.value)}/></div>
      <button type="button" className="toggle" onClick=${()=>setSec(!sec)}><span>Keep this board secret<br/><small className="mute">Only you and collaborators can see it.</small></span><span className=${'sw'+(sec?' on':'')}></span></button>
      <div className="row" style=${{justifyContent:'flex-end'}}><button type="button" className="btn btn-line" onClick=${()=>setMk(false)}>Cancel</button><button className="btn btn-ink">Create</button></div></form></div>`}
  </main>`;
}
function BoardDetail({ctx}){
  const b=ctx.boards.find(x=>x.id===ctx.board)||ctx.boards[0];
  const [tab,setTab]=useState('pins');const [secF,setSecF]=useState('all');const [org,setOrg]=useState(false);const [picked,setPicked]=useState([]);const [ns,setNs]=useState('');const [adding,setAdding]=useState(false);const [mat,setMat]=useState('all');const [share,setShare]=useState(false);
  const pins=b.pins.filter(p=>secF==='all'||p.sec===secF).map(p=>byId(p.pid)).filter(p=>mat==='all'||p.mat===mat);
  const total=b.pins.reduce((s,x)=>s+byId(x.pid).price,0);
  return html`<main className="wrap">
    <div className="ph-head" style=${{alignItems:'flex-start'}}><div><button className="btn btn-line btn-sm" onClick=${()=>ctx.go('boards')}>${I('back',{width:15})} Boards</button>
      <h1 style=${{marginTop:18}}>${b.title}</h1><p className="mute" style=${{marginTop:8}}>${b.pins.length} pins · ${b.sections.length} sections${b.secret?' · Secret board':''}</p></div>
      <div className="row" style=${{flexWrap:'wrap'}}><button className="btn btn-line" onClick=${()=>ctx.toStudio(b.pins.slice(0,6).map(x=>x.pid),b.title)}>${I('brush',{width:16})} Open in Studio</button><button className="btn btn-cog" onClick=${()=>setShare(true)}>${I('share',{width:16})} Share</button></div></div>
    <div className="row" style=${{justifyContent:'space-between',flexWrap:'wrap',borderBottom:'1px solid var(--line)'}}>
      <div className="tabs left" style=${{margin:0}}>${[['pins','Pins'],['shop','Shop'],['organize','Organize']].map(([k,l])=>html`<button key=${k} className=${tab===k?'on':''} onClick=${()=>{setTab(k);setOrg(k==='organize');setPicked([])}}>${l}</button>`)}</div>
    </div>
    ${tab!=='shop'&&html`<div className="filters" style=${{border:0,paddingTop:16}}>
      <button className=${'chip'+(secF==='all'?' on':'')} onClick=${()=>setSecF('all')}>All sections</button>
      ${b.sections.map(s=>html`<button key=${s} className=${'chip'+(secF===s?' on':'')} onClick=${()=>setSecF(s)}>${s} <span className="mono">${b.pins.filter(p=>p.sec===s).length}</span></button>`)}
      ${adding?html`<form className="row" onSubmit=${e=>{e.preventDefault();if(!ns.trim())return;ctx.updateBoard(b.id,x=>({...x,sections:[...x.sections,ns.trim()]}));setNs('');setAdding(false)}}><input className="field" style=${{height:34,width:170}} autoFocus placeholder="Section name" aria-label="Section name" value=${ns} onInput=${e=>setNs(e.target.value)}/><button className="btn btn-ink btn-sm">Add</button></form>`:html`<button className="chip" onClick=${()=>setAdding(true)}>${I('plus',{width:14})} Section</button>`}
      <span className="sep"></span>
      ${[['all','Any material'],...Object.entries(MAT)].map(([k,l])=>html`<button key=${k} className=${'chip'+(mat===k?' on':'')} onClick=${()=>setMat(k)}>${l}</button>`)}
    </div>`}
    ${org&&html`<div className="note" style=${{marginBottom:18,alignItems:'center',flexWrap:'wrap'}}><b style=${{fontWeight:500}}>${picked.length} selected</b><span className="mute">Tap pins to select, then move them into a section.</span><span style=${{flex:1}}></span>
      ${b.sections.map(s=>html`<button key=${s} className="btn btn-line btn-sm" disabled=${!picked.length} onClick=${()=>{ctx.updateBoard(b.id,x=>({...x,pins:x.pins.map(p=>picked.includes(p.pid)?{...p,sec:s}:p)}));ctx.toast(`Moved ${picked.length} to ${s}`);setPicked([])}}>Move to ${s}</button>`)}
      <button className="btn btn-line btn-sm" style=${{color:'var(--bad)'}} disabled=${!picked.length} onClick=${()=>{ctx.updateBoard(b.id,x=>({...x,pins:x.pins.filter(p=>!picked.includes(p.pid))}));setPicked([])}}>Remove</button></div>`}
    ${tab==='shop'?html`<div className="g2" style=${{marginTop:22}}>
      <div>${b.pins.map(x=>{const p=byId(x.pid);return html`<div key=${p.id} className="line" style=${{gridTemplateColumns:'88px minmax(0,1fr) auto'}}><button className="th" style=${{backgroundImage:`url(${p.img})`}} onClick=${()=>ctx.openPin(p.id)} aria-label=${'View '+p.name}></button><div><b>${p.name} <span className="mute" style=${{fontWeight:400}}>${p.line}</span></b><div className="meta">${x.sec||'No section'} · <span className="mono">${p.sku}</span></div></div><div className="row"><span className="mono">${ctx.mode==='trade'?fmt(tp(p)):fmt(p.price)}</span><button className="ib" aria-label=${'Add '+p.name+' to tray'} onClick=${e=>ctx.addToTray(p.id,1,e.currentTarget.closest('.line').querySelector('.th'))}>${I('plus')}</button></div></div>`})}</div>
      <div className="panel" style=${{alignSelf:'start',display:'grid',gap:12}}><h3>Shop the board</h3><div className="sumrow"><span>${b.pins.length} pieces</span><span>${fmt(b.pins.reduce((s,x)=>s+pr(byId(x.pid),ctx.mode),0))}</span></div><button className="btn btn-ink" onClick=${()=>{b.pins.forEach(x=>ctx.addToTray(x.pid,1,null,true));ctx.toast(`${b.pins.length} pieces added to ${ctx.activeProject.name}`,{label:'Open tray',fn:()=>ctx.setTray(true)})}}>Add all to tray</button><p className="help">Shared in shoppable mode, this tab is what your client sees, with your partner link attached.</p></div>
    </div>`:html`<div className=${org?'wall organize':'wall'}>${pins.map(p=>org?html`<button key=${p.id} className="pin" onClick=${()=>setPicked(picked.includes(p.id)?picked.filter(x=>x!==p.id):[...picked,p.id])} aria-pressed=${picked.includes(p.id)}><div className="pin-img" style=${{outline:picked.includes(p.id)?'3px solid var(--cognac)':'none',outlineOffset:2}}><img src=${p.img} alt=${p.name} style=${{aspectRatio:p.ar,opacity:picked.includes(p.id)?.75:1}}/>${picked.includes(p.id)&&html`<span className="oos" style=${{left:'auto',right:10,top:10,bottom:'auto',background:'var(--cognac)',color:'#fff'}}>Selected</span>`}</div><div className="pin-meta"><b>${p.name}</b></div></button>`:html`<${PinCard} key=${p.id} p=${p} ctx=${ctx}/>`)}</div>`}
    ${share&&html`<${ShareModal} ctx=${ctx} title=${b.title} ids=${b.pins.map(x=>x.pid)} onClose=${()=>setShare(false)}/>`}
  </main>`;
}

/* ================= PROFILE ================= */
function Profile({ctx}){
  const me=ctx.me;const [tab,setTab]=useState('saved');
  if(!me.signedIn)return html`<main className="wrap"><div className="empty" style=${{padding:'80px 0'}}><h3>Sign in to see your profile</h3><p>Your boards, collages and trade status live here.</p><button className="btn btn-ink" onClick=${()=>ctx.go('welcome')}>Sign in</button></div></main>`;
  const name=me.businessName||me.displayName;
  return html`<main>
    <div className="prof wrap" style=${{paddingTop:48}}>
      <span className="avatar">${(name||'?')[0].toUpperCase()}</span><h1>${name}</h1>
      <div className="row" style=${{gap:8}}>${me.verified?html`<span className="role" style=${{background:'rgba(78,106,67,.14)',color:'var(--ok)'}}>Trade verified</span>`:html`<span className="role">${me.tradeStatus==='pending'?'Trade application in review':'Member'}</span>`}</div>
      <div className="row" style=${{flexWrap:'wrap',justifyContent:'center'}}><button className="btn btn-line" onClick=${()=>ctx.go('account')}>Account</button><button className="btn btn-ink" onClick=${()=>ctx.go('hub')}>${I('chart',{width:15})} Quotes and trade pass</button></div>
    </div>
    <div className="wrap">
      <div className="tabs">${[['saved','Boards'],['collages','Collages']].map(([k,l])=>html`<button key=${k} className=${tab===k?'on':''} onClick=${()=>setTab(k)}>${l}</button>`)}</div>
      ${tab==='saved'&&(ctx.boards.length?html`<div className="boards">${ctx.boards.map(b=>html`<button key=${b.id} className="bcard" onClick=${()=>{ctx.setBoard(b.id);ctx.go('board')}}><div className="cov">${[0,1,2].map(i=>html`<div key=${i} style=${{backgroundImage:b.pins[i]?`url(${byId(b.pins[i].pid).img})`:'none'}}></div>`)}</div><h2>${b.title}</h2><p>${b.pins.length} pins</p></button>`)}</div>`:html`<div className="empty"><h2>No boards yet</h2><p>Save pieces from the floor to start a board.</p></div>`)}
      ${tab==='collages'&&(ctx.collages.length?html`<div className="boards">${ctx.collages.map((c,i)=>html`<div key=${i} className="bcard"><div className="cov">${c.els.filter(e=>e.kind==='img').slice(0,3).map((e,j)=>html`<div key=${j} style=${{backgroundImage:`url(${byId(e.pid).img})`}}></div>`)}</div><h2>${c.title}</h2></div>`)}</div>`:html`<div className="empty"><h2>No collages yet</h2><p>Compose one in Studio and save it here.</p><button className="btn btn-line" onClick=${()=>ctx.go('studio')}>Open Studio</button></div>`)}
    </div>
    <div className="wrap"><${Footer} ctx=${ctx}/></div>
  </main>`;
}
/* ================= PARTNER HUB ================= */
// The trade pass in the Hub: rendered from the account's business name, issued automatically on approval.
function TradePass({name,since}){
  const ref=useRef();
  const tilt=e=>{const el=ref.current;if(!el)return;const r=el.getBoundingClientRect();el.style.setProperty('--tx',((e.clientX-r.left)/r.width*2-1).toFixed(3));el.style.setProperty('--ty',((e.clientY-r.top)/r.height*2-1).toFixed(3))};
  const rest=()=>{const el=ref.current;if(el){el.style.setProperty('--tx',0);el.style.setProperty('--ty',0)}};
  return html`<div className="tp-wrap" onPointerMove=${tilt} onPointerLeave=${rest}>
    <div ref=${ref} className="tc-card tp-card" role="img" aria-label=${'Trade pass for '+name}>
      <span className="tc-face tc-front"><span className="tc-sheen"></span><span className="tc-mark foil">HL</span><span className="tc-brand foil">House of Louie Mae</span><span className="tc-tier">Trade</span>
        <span className="tc-name foil">${name}</span><span className="tc-meta"><span>Verified ${since}</span><span className="num">25% · Trade</span></span></span>
    </div></div>`;
}
// Partner program panel on the "Your quotes" page.
function PartnerPanel({ctx}){
  const ph=useQuery(api.holmPartners.hub,ctx.me.signedIn?{}:'skip');const join=useMutation(api.holmPartners.join);const w9Url=useMutation(api.holmPartners.w9UploadUrl);const submitW9=useMutation(api.holmPartners.submitW9);
  const [agree,setAgree]=useState(false);const [busy,setBusy]=useState(false);const [ch,setCh]=useState('pinterest');const [target,setTarget]=useState('home');const w9Ref=useRef();
  if(!ctx.me.signedIn||ph===undefined)return null;
  if(!ph)return html`<section className="panel" style=${{marginBottom:24,display:'grid',gap:12}}><h3>Partner program</h3>
    <p className="help" style=${{margin:0}}>Share pieces and boards and earn commission on retail orders placed through your links: 10% to start, up to 18% by tier. Trade-priced orders don't earn commission. Referring a business that's verified and places a first order over $500 earns $100 in store credit.</p>
    <label className="cq-check"><input type="checkbox" checked=${agree} onChange=${e=>setAgree(e.target.checked)}/><span>I agree to the partner terms: commission on retail orders through my links within 30 days, payouts after an approved W-9, and disclosure on social posts.</span></label>
    <button className="btn btn-ink" style=${{justifySelf:'start'}} disabled=${!agree||busy} onClick=${async()=>{setBusy(true);try{await join({acceptTerms:true});ctx.toast('Welcome to the partner program')}catch(e){ctx.toast(errText(e))}finally{setBusy(false)}}}>Join the partner program</button></section>`;
  const base=location.origin+'/trade';const hash=target==='home'?'':target.startsWith('p:')?'#p/'+target.slice(2):'#'+target;
  const link=`${base}?ref=${ph.refCode}&ch=${ch}${hash}`;
  const money=c=>fmt(c/100,true);
  const status={signed_up:'Signed up',verified:'Verified, awaiting first order',credited:'Credit earned'};
  return html`<section style=${{display:'grid',gap:18,marginBottom:24}}>
    <div className="ph-head" style=${{margin:0}}><div><h2 style=${{fontSize:38}}>Partner Hub</h2><p className="mute">${(ph.rateBps/100)}% commission on retail orders · ${ph.tier[0].toUpperCase()+ph.tier.slice(1)} tier</p></div></div>
    <div className="kpis">${[['Link visits · 30 days',ph.clicks30],['Quote requests from your links',ph.quotes],['Pending',money(ph.pendingCents)],['Cleared, ready to pay',money(ph.clearedCents)],['Paid',money(ph.paidCents)]].map(([l,v])=>html`<div key=${l} className="kpi"><span className="mono mute">${l}</span><div className="v">${v}</div></div>`)}</div>
    <div className="g2">
      <div className="panel" style=${{display:'grid',gap:10,alignContent:'start'}}><h3>Your link</h3>
        <div className="g2f" style=${{gap:8}}><select className="field" aria-label="Link to" value=${target} onChange=${e=>setTarget(e.target.value)}><option value="home">House of Louie Mae home</option><option value="discover">Discover</option><optgroup label="Pieces">${PRODUCTS.slice(0,60).map(p=>html`<option key=${p.id} value=${'p:'+p.id}>${p.name} ${p.line}</option>`)}</optgroup></select>
          <select className="field" aria-label="Channel" value=${ch} onChange=${e=>setCh(e.target.value)}>${[['pinterest','Pinterest'],['instagram','Instagram'],['email','Email'],['website','Website'],['tiktok','TikTok'],['direct','Direct']].map(([k,l])=>html`<option key=${k} value=${k}>${l}</option>`)}</select></div>
        <div className="linkbox"><code>${link}</code><button className="btn btn-ink btn-sm" onClick=${()=>copyText(link,ctx.toast)}>Copy</button></div>
        <div className="kv"><span className="mono mute">Code</span><b style=${{fontWeight:500}}>${ph.refCode}</b><span className="mono mute">Window</span><span>30 days from the first click</span><span className="mono mute">Clearing</span><span>30 days after payment</span><span className="mono mute">Tax form</span><span>${ph.w9Status==='approved'?'W-9 approved':ph.w9Status==='pending'?'W-9 in review':html`<button className="lnk" onClick=${()=>w9Ref.current.click()}>Upload your W-9</button>`}</span></div>
        <input ref=${w9Ref} type="file" accept=".pdf,image/*" hidden onChange=${async e=>{const x=e.target.files[0];if(!x)return;try{const id=await uploadBlob(w9Url,x);await submitW9({fileId:id});ctx.toast('W-9 received')}catch(err){ctx.toast(errText(err))}}}/>
        <p className="help" style=${{margin:0}}>Add "I earn a commission" or #ad when you post. Orders you place yourself don't earn commission; your trade account is always the better price.</p></div>
      <div className="panel" style=${{display:'grid',gap:8,alignContent:'start'}}><h3>Referrals and credit</h3>
        ${ph.referrals.length?ph.referrals.map((r,i)=>html`<div key=${i} className="sumrow" style=${{borderBottom:'1px solid var(--line)',padding:'8px 0'}}><span>${r.name}<br/><small className="mute">${status[r.status]}</small></span><span>${r.creditCents?money(r.creditCents):''}</span></div>`):html`<p className="help" style=${{margin:0}}>Businesses who sign up through your link appear here.</p>`}
        <div className="sumrow total"><span>Store credit</span><span>${money(ph.creditCents)}</span></div>
        ${ph.payouts.length>0&&html`<h3 style=${{marginTop:10}}>Payouts</h3>${ph.payouts.map((x,i)=>html`<div key=${i} className="sumrow"><span>${new Date(x.paidAt).toLocaleDateString()}<br/><small className="mute">${x.reference}</small></span><span>${money(x.amountCents)}</span></div>`)}`}
      </div>
    </div>
  </section>`;
}
function Hub({ctx}){
  const me=ctx.me;
  const quotes=useQuery(api.holm.myQuoteRequests)||[];const cqs=useQuery(api.holm.myClientQuotes)||[];const app=useQuery(api.holm.myApplication);
  if(!me.signedIn)return html`<main className="wrap"><div className="empty" style=${{padding:'80px 0'}}><h3>Sign in to see your quotes</h3><p>Quote requests, client quote links and your trade pass live here.</p><button className="btn btn-ink" onClick=${()=>ctx.go('welcome')}>Sign in</button></div></main>`;
  const status={requested:'Requested',quoted:'Quote ready',accepted:'Accepted',invoiced:'Invoiced',paid:'Paid',fulfilled:'Delivered',cancelled:'Cancelled'};
  const cqStatus={sent:'Sent',viewed:'Viewed',approved:'Approved',changes_requested:'Changes requested'};
  return html`<main className="wrap">
    ${me.verified?html`<section className="tp-row"><${TradePass} name=${me.businessName||me.displayName} since="trade"/><div className="tp-copy"><h2>Your trade pass</h2><p>Created automatically when your trade account was approved. Trade pricing and project pricing are on for every piece: an extra 3% over $10,000 and 5% over $25,000 in trade per project.</p></div></section>`
    :html`<section className="panel" style=${{margin:'40px 0 18px',display:'grid',gap:10}}><h2 style=${{fontSize:34}}>${app?.status==='pending'?'Your trade application is in review':app?.status==='needs_info'?'We need a little more information':'Trade pricing for businesses'}</h2><p className="mute">${app?.status==='pending'?`We're checking ${app.businessName}. Most applications are reviewed within one business day, and trade prices appear here as soon as you're approved.`:app?.status==='needs_info'?(app.reviewNote||'Check your email for what we need.'):'Verified trade accounts see trade pricing on every piece, project pricing on larger orders and client quotes.'}</p>${app?.status!=='pending'&&html`<button className="btn btn-ink" style=${{justifySelf:'start'}} onClick=${()=>ctx.go('trade')}>Apply for trade</button>`}</section>`}
    <div className="g2" style=${{margin:'18px 0 60px'}}>
      <div className="panel"><h3>Quote requests</h3>
        ${quotes.length?html`<table className="t" style=${{marginTop:8}}><thead><tr><th>Reference</th><th>Project</th><th className="r">Subtotal</th><th>Status</th></tr></thead><tbody>${quotes.map(r=>html`<tr key=${r.reference}><td className="mono">${r.reference}</td><td>${r.projectName}</td><td className="r num">${fmt(r.subtotal/100)}</td><td>${r.invoiceUrl?html`<a href=${r.invoiceUrl} target="_blank" rel="noopener">${status[r.status]||r.status}</a>`:(status[r.status]||r.status)}</td></tr>`)}</tbody></table>`
        :html`<p className="help">No quote requests yet. Fill a project in your tray and request a final quote.</p>`}</div>
      <div className="panel"><h3>Client quotes</h3>
        ${cqs.length?html`<div style=${{display:'grid',gap:2,marginTop:8}}>${cqs.map(q=>html`<div key=${q.slug} className="sumrow" style=${{borderBottom:'1px solid var(--line)',padding:'10px 0'}}><span>${q.title}<br/><small className="mute">${q.number} · ${q.clientName} · ${cqStatus[q.status]}${q.approval?` by ${q.approval.name}`:''}</small></span><span className="row" style=${{gap:6}}><button className="btn btn-line btn-sm" onClick=${()=>copyText(location.origin+'/trade#q/'+q.slug,ctx.toast)}>Copy link</button><button className="btn btn-line btn-sm" onClick=${()=>{location.hash='q/'+q.slug}}>Open</button></span></div>`)}</div>`
        :html`<p className="help">${me.verified?'Create one from your tray: price a project, add your markup, send one link.':'Client quotes open with a verified trade account.'}</p>`}</div>
    </div>
    <${PartnerPanel} ctx=${ctx}/>
    <div style=${{height:40}}></div>
  </main>`;
}
/* ================= SOURCING REQUESTS ================= */
function Sourcing({ctx}){
  const submit=useMutation(api.holmSourcing.submit);const uploadUrl=useMutation(api.holmSourcing.uploadUrl);const me=ctx.me;
  const blank={type:'specific',title:'',link:'',cat:'Seating',material:'',w:'',d:'',h:'',qty:1,budget:'',date:'',project:ctx.activeProject?.name||'',notes:'',imgs:[]};
  const [f,setF]=useState(blank);const [sent,setSent]=useState(null);const [busy,setBusy]=useState(false);const [err,setErr]=useState('');const set=(k,v)=>{setF({...f,[k]:v});setErr('')};const ok=f.title.trim().length>2&&f.qty>0;
  const can=me.verified||me.partner||me.admin;
  const send=async()=>{setBusy(true);setErr('');try{const imageIds=[];for(const src of f.imgs.slice(0,8))imageIds.push(await uploadBlob(uploadUrl,await dataUrlBlob(src)));
      const n=await submit({type:f.type,title:f.title,link:f.link,category:f.cat,material:f.material,dims:[f.w&&`W ${f.w} cm`,f.d&&`D ${f.d} cm`,f.h&&`H ${f.h} cm`].filter(Boolean).join(' · '),quantity:+f.qty,targetCents:f.budget?Math.round(+f.budget*100):undefined,neededBy:f.date,project:f.project,notes:f.notes,imageIds});setSent(n)}
    catch(e){setErr(errText(e))}finally{setBusy(false)}};
  const intro=html`<div><h1 style=${{fontSize:'clamp(44px,5.6vw,76px)'}}>Can't find it? <em style=${{fontStyle:'italic',color:'var(--cognac)'}}>We'll source it.</em></h1>
      <p className="mute" style=${{marginTop:18,maxWidth:'48ch',fontSize:16}}>Tell us the piece your project needs. Our team finds it through our suppliers and comes back with options, trade pricing and lead times.</p>
      <ol className="tv-time" style=${{marginTop:26}}>${[['Request','Send a link, photo or spec'],['Sourcing','We search our supplier network, usually 2 to 5 business days'],['Options','You get options with pricing and lead times'],['Ordered','Choose an option and we place it in your project']].map(([t,d],i)=>html`<li key=${t} className=${i===0?'on':''}><i></i><b>${t}</b><span>${d}</span></li>`)}</ol>
      <div className="note" style=${{marginTop:6}}>${I('pin',{width:18})}<span>Open to verified trade accounts and partners. Sourcing is free to request; you only pay if you order.</span></div></div>`;
  if(!can)return html`<main className="wrap"><div className="apply">${intro}<div className="formcard" style=${{textAlign:'center',justifyItems:'center',padding:'48px 28px'}}><h2 style=${{fontSize:38}}>For trade accounts and partners</h2><p className="mute" style=${{maxWidth:'38ch'}}>${me.signedIn?'Apply for trade or join the partner program to request sourcing.':'Sign in, then apply for trade or join the partner program.'}</p><div className="row" style=${{flexWrap:'wrap',justifyContent:'center'}}><button className="btn btn-ink" onClick=${()=>me.signedIn?ctx.go('trade'):ctx.signInThen('sourcing')}>${me.signedIn?'Apply for trade':'Sign in'}</button>${me.signedIn&&html`<button className="btn btn-line" onClick=${()=>ctx.go('hub')}>Partner program</button>`}</div></div></div></main>`;
  return html`<main className="wrap"><div className="apply">
    ${intro}
    ${sent?html`<div className="formcard" style=${{textAlign:'center',justifyItems:'center',padding:'48px 28px'}}><span className="pulse" style=${{background:'var(--ok)'}}>${I('check')}</span><h2 style=${{fontSize:42}}>Request received</h2><p className="mono">${sent}</p><p className="mute" style=${{maxWidth:'40ch'}}>We're on it. You'll get an email when options are ready, and they'll appear under "Your requests".</p><div className="row"><button className="btn btn-ink" onClick=${()=>{setSent(null);setF(blank)}}>Request another</button></div></div>`:
    html`<form className="formcard" onSubmit=${e=>{e.preventDefault();if(ok&&!busy)send()}}>
      <span className="pp-lbl">What do you need?</span>
      <div className="types" style=${{gridTemplateColumns:'repeat(3,minmax(0,1fr))'}}>${[['specific','A specific product','You know the exact item'],['similar','Something similar','Like a photo or reference'],['custom','A custom spec','Size, material or finish']].map(([k,l,s])=>html`<button type="button" key=${k} className=${'typec'+(f.type===k?' on':'')} onClick=${()=>set('type',k)} aria-pressed=${f.type===k}><b>${l}</b><small>${s}</small></button>`)}</div>
      <div><label className="lbl" htmlFor="sr-t">Product or description</label><input id="sr-t" className="field" value=${f.title} onInput=${e=>set('title',e.target.value)} placeholder="Cane-back counter stools in walnut"/></div>
      <div className="g2f"><div><label className="lbl" htmlFor="sr-l">Link (optional)</label><input id="sr-l" className="field" value=${f.link} onInput=${e=>set('link',e.target.value)} placeholder="Product page or Pinterest pin"/></div>
        <div><label className="lbl" htmlFor="sr-c">Category</label><select id="sr-c" className="field" value=${f.cat} onChange=${e=>set('cat',e.target.value)}>${['Seating','Tables','Lighting','Rugs & textiles','Storage','Outdoor','Decor','Other'].map(c=>html`<option key=${c}>${c}</option>`)}</select></div></div>
      <div><span className="lbl">Photos or references</span><label className="drop" style=${{cursor:'pointer'}}>${I('upload',{width:22})}<span>${f.imgs.length?f.imgs.length+' image'+(f.imgs.length>1?'s':'')+' added':'Upload photos, screenshots or spec sheets'}</span><input type="file" accept="image/*" multiple hidden onChange=${async e=>{const out=[];for(const x of e.target.files){try{out.push((await fileToInspo(x)).src)}catch(err){}}set('imgs',[...f.imgs,...out].slice(0,8))}}/></label>
        ${f.imgs.length>0&&html`<div className="pl-mini" style=${{marginTop:8}}>${f.imgs.map((s,i)=>html`<button type="button" key=${i} onClick=${()=>set('imgs',f.imgs.filter((_,k)=>k!==i))} title="Remove"><img src=${s} alt=""/></button>`)}</div>`}</div>
      <div><label className="lbl" htmlFor="sr-m">Material, finish or colour</label><input id="sr-m" className="field" value=${f.material} onInput=${e=>set('material',e.target.value)} placeholder="Walnut frame, cognac leather seat"/></div>
      <div className="pl-dims">${[['w','Width (cm)'],['d','Depth (cm)'],['h','Height (cm)']].map(([k,l])=>html`<label key=${k}><span className="mono mute">${l}</span><input className="field num" type="number" min="0" value=${f[k]} onInput=${e=>set(k,e.target.value)}/></label>`)}</div>
      <div className="g2f"><div><label className="lbl" htmlFor="sr-q">Quantity</label><input id="sr-q" className="field num" type="number" min="1" value=${f.qty} onInput=${e=>set('qty',Math.max(1,Math.floor(+e.target.value)||1))}/></div>
        <div><label className="lbl" htmlFor="sr-b">Target price per unit (optional)</label><input id="sr-b" className="field num" type="number" min="0" value=${f.budget} onInput=${e=>set('budget',e.target.value)} placeholder="$"/></div></div>
      <div className="g2f"><div><label className="lbl" htmlFor="sr-d">Needed by</label><input id="sr-d" className="field" type="date" value=${f.date} onInput=${e=>set('date',e.target.value)}/></div>
        <div><label className="lbl" htmlFor="sr-p">For project</label><input id="sr-p" className="field" value=${f.project} onInput=${e=>set('project',e.target.value)} placeholder="Project or room name"/></div></div>
      <div><label className="lbl" htmlFor="sr-n">Notes for our team</label><textarea id="sr-n" className="field" rows="3" value=${f.notes} onInput=${e=>set('notes',e.target.value)} placeholder="Commercial use, fire code, colour matching, anything we should know"></textarea></div>
      ${err&&html`<p className="help" style=${{color:'var(--bad)'}}>${err}</p>`}
      <button className="btn btn-ink btn-lg" disabled=${!ok||busy} style=${{justifySelf:'start'}}>${busy?'Sending…':'Send sourcing request'} ${I('arrow',{width:16})}</button>
    </form>`}
  </div>
  <section style=${{paddingBottom:60}}>
    <h2 style=${{fontSize:38,marginBottom:14}}>Your <em style=${{fontStyle:'italic',color:'var(--cognac)'}}>requests</em></h2>
    <${SourcingList} ctx=${ctx}/>
  </section></main>`;
}
const SR_STEPS=['received','sourcing','options_ready','ordered'];
const SR_LABEL={received:'Received',sourcing:'Sourcing',options_ready:'Options ready',ordered:'Ordered',closed:'Closed'};

function SourcingList({ctx,compact}){
  const rows=useQuery(api.holmSourcing.mine,ctx.me.signedIn?{}:'skip');const choose=useMutation(api.holmSourcing.choose);
  if(!ctx.me.signedIn)return html`<p className="help">Sign in to see your requests.</p>`;
  if(rows===undefined)return html`<p className="help">Loading…</p>`;
  const list=compact?rows.slice(0,3):rows;
  if(!list.length)return html`<p className="help">No requests yet.</p>`;
  return html`<div className="sr-list">${list.map(r=>html`<div key=${r.id} className="sr-row" style=${{alignItems:'flex-start'}}>
    <span className="sr-th" style=${r.image?{backgroundImage:`url(${r.image})`}:{}}>${r.image?'':I('search',{width:18})}</span>
    <div style=${{minWidth:0}}><b>${r.title}</b><div className="meta"><span className="mono">${r.number}</span><span>${r.quantity} × ${r.targetCents?fmt(r.targetCents/100)+' target':'no target price'}</span>${r.project&&html`<span>${r.project}</span>`}<span>${new Date(r.createdAt).toLocaleDateString()}</span></div>
      ${!compact&&html`<div className="sr-steps">${SR_STEPS.map((s,i)=>html`<i key=${s} className=${i<=SR_STEPS.indexOf(r.status)?'on':''} title=${SR_LABEL[s]}></i>`)}</div>`}
      ${!compact&&r.options.length>0&&html`<div style=${{display:'grid',gap:6,marginTop:10}}>${r.options.map((o,i)=>html`<div key=${i} className="sumrow" style=${{border:'1px solid var(--line)',borderRadius:12,padding:'10px 12px'}}><span><b style=${{fontWeight:500}}>${o.title}</b><br/><small className="mute">${fmt(o.unitCents/100)} each${o.leadTime?' · '+o.leadTime:''}${o.note?' · '+o.note:''}</small></span>${r.chosenOption===i?html`<span className="tv-status">Chosen</span>`:r.status==='options_ready'&&html`<button className="btn btn-line btn-sm" onClick=${()=>choose({id:r.id,option:i}).then(()=>ctx.toast('Option chosen. We will follow up by email.')).catch(e=>ctx.toast(errText(e)))}>Choose</button>`}</div>`)}</div>`}</div>
    <span className=${'tv-status'+(r.status==='options_ready'?' warn':'')}>${SR_LABEL[r.status]}</span>
  </div>`)}</div>`;
}
/* ================= PARTNER HUB: Pinterest, links, sourcing, payouts ================= */

/* ================= TRADE APPLICATION ================= */
const BTYPES={
  hosp:{l:'Restaurant, café or bar',s:'Buying for your own space',cred:'Food service permit, health permit or liquor license number',how:'Checked against state or city license lookup. Liquor licenses are public record.'},
  design:{l:'Interior designer',s:'Buying for clients',cred:'Resale certificate, ASID or IIDA member number, or portfolio link',how:'Checked against the sales tax permit lookup or member directory.'},
  re:{l:'Real estate or stager',s:'Staging and model homes',cred:'Real estate license number',how:'Checked against your state real estate commission search.'},
  build:{l:'Home builder or contractor',s:'Builds and developments',cred:'Contractor or builder license number',how:'Checked against state or city contractor license lookup.'},
  pm:{l:'Project manager',s:'Buying on behalf of a company',cred:'Company work email, or a letter of authorization from the owner',how:'We verify the company itself. Orders ship and bill to that business.'},
  retail:{l:'Retailer',s:'Reselling in your shop',cred:'Resale certificate',how:'Checked against the state sales tax permit lookup.'},
};
const STATES=['Alabama','Arizona','California','Colorado','Connecticut','Florida','Georgia','Illinois','Massachusetts','Michigan','Minnesota','New Jersey','New York','North Carolina','Ohio','Oregon','Pennsylvania','Tennessee','Texas','Virginia','Washington','Other'];
function Trade({ctx}){
  const me=ctx.me;const app=useQuery(api.holm.myApplication);const apply=useMutation(api.holm.applyTrade);const uploadUrl=useMutation(api.holm.uploadUrl);
  const [step,setStep]=useState(0);const [f,setF]=useState({type:'',name:'',state:'New York',ein:'',web:'',cred:'',company:'',email:'',tax:false,cert:null});const [done,setDone]=useState(false);const [busy,setBusy]=useState(false);const [err,setErr]=useState('');const certRef=useRef();
  const set=(k,v)=>{setF({...f,[k]:v});setErr('')};
  const steps=['Business type','Business details','Industry credential','Tax exemption','Review'];
  const einOk=/^\d{2}-\d{7}$/.test(f.ein);
  const can=[!!f.type,f.name.trim()&&einOk&&f.web.trim(),f.type==='pm'?(f.company.trim()&&f.email.includes('@')):f.cred.trim(),true,true][step];
  const fmtEin=v=>{const d=v.replace(/\D/g,'').slice(0,9);return d.length>2?d.slice(0,2)+'-'+d.slice(2):d};
  const T=BTYPES[f.type];
  const submit=async()=>{setBusy(true);setErr('');try{let certificateId;
      if(f.tax&&f.cert){const url=await uploadUrl();const r=await fetch(url,{method:'POST',headers:{'Content-Type':f.cert.type||'application/octet-stream'},body:f.cert});if(!r.ok)throw new Error('The certificate did not upload. Try again.');certificateId=(await r.json()).storageId}
      await apply({businessType:f.type,businessName:f.name,state:f.state,ein:f.ein,website:f.web,credential:f.type==='pm'?'':f.cred,company:f.type==='pm'?f.company:undefined,workEmail:f.type==='pm'?f.email:undefined,taxRequested:f.tax,certificateId});setDone(true)}
    catch(e){setErr(e?.data||String(e?.message||'').replace(/^.*Uncaught Error: /,'').split('\n')[0]||'Something went wrong. Try again.')}finally{setBusy(false)}};
  const intro=html`<div><h1 style=${{fontSize:'clamp(44px,5.6vw,76px)'}}>Trade pricing for <em style=${{fontStyle:'italic',color:'var(--cognac)'}}>businesses that build rooms.</em></h1>
      <p className="mute" style=${{marginTop:18,maxWidth:'46ch',fontSize:16}}>One short check for everyone, plus one credential for your industry. Most applications are reviewed within a business day.</p>
      <div className="steps">${steps.map((s,i)=>html`<div key=${s} className=${'stepi'+(i===step&&!done?' on':'')+(i<step||done?' done':'')}><i>${i<step||done?I('check',{width:14}):i+1}</i>${s}</div>`)}</div>
      <div className="note" style=${{marginTop:20}}>${I('pin',{width:18})}<span>Trade approval and tax exemption are separate. Approval gets you trade pricing. Tax exemption needs a valid resale or exemption certificate; without one, trade pricing still applies and sales tax is charged.</span></div>
    </div>`;
  if(!me.signedIn)return html`<main className="wrap"><div className="apply">${intro}<div className="formcard" style=${{textAlign:'center',justifyItems:'center',padding:'48px 28px'}}><h2 style=${{fontSize:38}}>Start with an account</h2><p className="mute" style=${{maxWidth:'38ch'}}>Create an account or sign in, then apply. Your projects and quotes stay with your account.</p><button className="btn btn-ink btn-lg" onClick=${()=>ctx.signInThen('trade')}>Sign in or create an account</button></div></div></main>`;
  if(me.verified||app?.status==='pending'||done){const ok=me.verified;return html`<main className="wrap"><div className="apply">${intro}<div className="formcard" style=${{textAlign:'center',justifyItems:'center',padding:'48px 28px'}}><span className="pulse" style=${{background:'var(--ok)'}}>${I('check')}</span><h2 style=${{fontSize:44}}>${ok?'You are verified':'Application received'}</h2><p className="mute" style=${{maxWidth:'40ch'}}>${ok?'Trade pricing is on for every piece.':`We're checking ${app?.businessName||f.name}. You'll hear from us by email, usually within one business day.`}</p><p className="mono mute">Status: ${ok?'Verified':'In review'}</p><div className="row"><button className="btn btn-ink" onClick=${()=>ctx.go('home')}>${ok?'Shop at trade':'Browse while you wait'}</button></div></div></div></main>`}
  return html`<main className="wrap"><div className="apply">
    ${intro}
    <form className="formcard" onSubmit=${e=>{e.preventDefault();if(!can||busy)return;if(step<4)setStep(step+1);else submit()}}>
      <span className="mono mute">Step ${step+1} of 5</span>
      ${app?.status==='needs_info'&&step===0&&html`<div className="note">${I('pin',{width:18})}<span>${app.reviewNote||'We need a little more information. Update your details and submit again.'}</span></div>`}
      ${step===0&&html`<h2 style=${{fontSize:36}}>What kind of business are you?</h2><div className="types">${Object.entries(BTYPES).map(([k,t])=>html`<button type="button" key=${k} className=${'typec'+(f.type===k?' on':'')} onClick=${()=>set('type',k)} aria-pressed=${f.type===k}><b>${t.l}</b><small>${t.s}</small></button>`)}</div>`}
      ${step===1&&html`<h2 style=${{fontSize:36}}>Tell us about the business</h2>
        <div><label className="lbl" htmlFor="ln">Legal business name</label><input id="ln" className="field" value=${f.name} onInput=${e=>set('name',e.target.value)} placeholder="As registered with your state"/></div>
        <div className="g2f"><div><label className="lbl" htmlFor="st">State of registration</label><select id="st" className="field" value=${f.state} onChange=${e=>set('state',e.target.value)}>${STATES.map(s=>html`<option key=${s}>${s}</option>`)}</select></div>
          <div><label className="lbl" htmlFor="ein">EIN</label><input id="ein" className="field num" inputMode="numeric" value=${f.ein} onInput=${e=>set('ein',fmtEin(e.target.value))} placeholder="12-3456789" aria-invalid=${f.ein&&!einOk}/>${f.ein&&!einOk&&html`<p className="help" style=${{color:'var(--bad)'}}>An EIN has 9 digits, written 12-3456789.</p>`}<p className="help">We keep only the last four digits.</p></div></div>
        <div><label className="lbl" htmlFor="web">Website or business Instagram</label><input id="web" className="field" value=${f.web} onInput=${e=>set('web',e.target.value)} placeholder="yourbusiness.com or @yourbusiness"/><p className="help">We confirm the business is active with the Secretary of State and that it's operating.</p></div>`}
      ${step===2&&T&&html`<h2 style=${{fontSize:36}}>One credential for ${T.l.toLowerCase()}</h2>
        ${f.type==='pm'?html`<div><label className="lbl" htmlFor="co">Company you're buying for</label><input id="co" className="field" value=${f.company} onInput=${e=>set('company',e.target.value)} placeholder="Company legal name"/></div><div><label className="lbl" htmlFor="we">Work email at that company</label><input id="we" type="email" className="field" value=${f.email} onInput=${e=>set('email',e.target.value)} placeholder="you@company.com"/></div>`:
        html`<div><label className="lbl" htmlFor="cred">${T.cred}</label><input id="cred" className="field" value=${f.cred} onInput=${e=>set('cred',e.target.value)} placeholder="Number or link"/></div>`}
        <div className="note">${I('check',{width:18})}<span>${T.how}</span></div>`}
      ${step===3&&html`<h2 style=${{fontSize:36}}>Tax exemption <span className="mute" style=${{fontSize:22}}>(optional)</span></h2>
        <p className="mute">Only for businesses reselling the furniture, like designers billing clients or retailers. A restaurant furnishing its own dining room usually pays sales tax.</p>
        <button type="button" className="toggle" onClick=${()=>set('tax',!f.tax)} aria-pressed=${f.tax}><span>I have a resale or exemption certificate</span><span className=${'sw'+(f.tax?' on':'')}></span></button>
        ${f.tax&&html`<div className="drop" role="button" tabIndex="0" onClick=${()=>certRef.current.click()} onKeyDown=${e=>e.key==='Enter'&&certRef.current.click()}>${I('upload',{width:22})}${f.cert?html`<b style=${{color:'var(--ink)',fontWeight:500}}>${f.cert.name}</b><span>Tap to replace</span>`:html`<span>Upload your certificate (PDF or photo)</span>`}</div><input ref=${certRef} type="file" accept="image/*,.pdf" hidden onChange=${e=>{const x=e.target.files[0];if(x){if(x.size>10*1024*1024){setErr('Use a file under 10 MB.');return}set('cert',x)}}}/>`}`}
      ${step===4&&html`<h2 style=${{fontSize:36}}>Review and submit</h2>
        <dl className="specs" style=${{gridTemplateColumns:'1fr 1fr'}}>
          <div><dt>Business type</dt><dd>${T?.l}</dd></div><div><dt>Legal name</dt><dd>${f.name}</dd></div>
          <div><dt>State</dt><dd>${f.state}</dd></div><div><dt>EIN</dt><dd className="num">••-•••${f.ein.slice(-4)}</dd></div>
          <div><dt>Online</dt><dd>${f.web}</dd></div><div><dt>Credential</dt><dd>${f.type==='pm'?f.company+' · '+f.email:f.cred}</dd></div>
          <div><dt>Tax exemption</dt><dd>${f.tax?(f.cert?'Certificate attached':'Certificate needed'):'Not requested'}</dd></div><div><dt>Pricing</dt><dd>Trade, once approved</dd></div>
        </dl>
        <p className="help">By submitting you agree to the trade terms. Orders ship and bill to the verified business.</p>`}
      ${err&&html`<p className="help" style=${{color:'var(--bad)'}}>${err}</p>`}
      <div className="row" style=${{justifyContent:'space-between',marginTop:6}}>
        ${step>0?html`<button type="button" className="btn btn-line" onClick=${()=>setStep(step-1)}>${I('back',{width:16})} Back</button>`:html`<span></span>`}
        <button className="btn btn-ink btn-lg" disabled=${!can||busy}>${busy?'Submitting…':step===4?'Submit application':'Continue'} ${I('arrow',{width:16})}</button>
      </div>
    </form>
  </div></main>`;
}
// Team review queue for trade applications (admin accounts only).
function AdminPage({ctx}){
  const [tab,setTab]=useState('apps');
  if(!ctx.me.admin)return html`<main className="wrap"><div className="empty" style=${{padding:'80px 0'}}><h3>Team only</h3><p>Sign in with an admin account to manage House of Louie Mae.</p></div></main>`;
  return html`<main className="wrap" style=${{paddingBottom:60}}>
    <div className="seg" style=${{margin:'28px 0 0'}}>${[['apps','Trade applications'],['sourcing','Sourcing'],['partners','Partners'],['pricing','Pricing']].map(([k,l])=>html`<button key=${k} className=${tab===k?'on':''} onClick=${()=>setTab(k)}>${l}</button>`)}</div>
    ${tab==='apps'?html`<${TradeAdmin} ctx=${ctx}/>`:tab==='sourcing'?html`<${SourcingAdmin} ctx=${ctx}/>`:tab==='pricing'?html`<${PricingAdmin} ctx=${ctx}/>`:html`<${PartnersAdmin} ctx=${ctx}/>`}
  </main>`;
}
function SourcingAdmin({ctx}){
  const [status,setStatus]=useState('received');const rows=useQuery(api.holmSourcing.adminList,{status});const update=useMutation(api.holmSourcing.adminUpdate);
  const [edit,setEdit]=useState({});
  const ed=r=>edit[r._id]||{status:r.status,note:r.adminNote||'',options:r.options.map(o=>({...o,price:(o.unitCents/100).toFixed(2)}))};
  const setEd=(r,o)=>setEdit({...edit,[r._id]:{...ed(r),...o}});
  const save=async r=>{const e=ed(r);try{await update({id:r._id,status:e.status,adminNote:e.note||undefined,options:e.options.filter(o=>o.title.trim()).map(o=>({title:o.title.trim(),unitCents:Math.round(+o.price*100)||0,leadTime:o.leadTime||'',note:o.note||''}))});ctx.toast('Saved');setEdit({...edit,[r._id]:undefined})}catch(x){ctx.toast(errText(x))}};
  return html`<div style=${{marginTop:18}}>
    <div className="seg">${['received','sourcing','options_ready','ordered','closed'].map(k=>html`<button key=${k} className=${status===k?'on':''} onClick=${()=>setStatus(k)}>${SR_LABEL[k]}</button>`)}</div>
    ${rows===undefined?html`<p className="help">Loading…</p>`:!rows.length?html`<div className="empty"><h3>Nothing here</h3><p>No requests with this status.</p></div>`:
    html`<div style=${{display:'grid',gap:14,marginTop:14}}>${rows.map(r=>{const e=ed(r);return html`<div key=${r._id} className="panel" style=${{display:'grid',gap:10}}>
      <div className="row" style=${{justifyContent:'space-between',flexWrap:'wrap'}}><h3>${r.number} · ${r.title}</h3><span className="mono mute">${r.email}</span></div>
      <p className="help" style=${{margin:0}}>${r.quantity} × · ${r.category}${r.material?' · '+r.material:''}${r.dims?' · '+r.dims:''}${r.targetCents?' · target '+fmt(r.targetCents/100):''}${r.neededBy?' · needed by '+r.neededBy:''}${r.project?' · '+r.project:''}</p>
      ${r.link&&html`<a href=${r.link} target="_blank" rel="noopener noreferrer">${r.link}</a>`}${r.notes&&html`<p>${r.notes}</p>`}
      ${r.imageUrls.length>0&&html`<div className="pl-mini">${r.imageUrls.filter(Boolean).map((u,i)=>html`<a key=${i} href=${u} target="_blank" rel="noopener"><img src=${u} alt=""/></a>`)}</div>`}
      ${r.chosenOption!=null&&html`<p className="tv-status">Client chose: ${r.options[r.chosenOption]?.title}</p>`}
      <div style=${{display:'grid',gap:6}}>${e.options.map((o,i)=>html`<div key=${i} className="g3f" style=${{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 2fr auto',gap:6}}><input className="field" placeholder="Option" value=${o.title} onInput=${x=>{const op=[...e.options];op[i]={...o,title:x.target.value};setEd(r,{options:op})}}/><input className="field num" placeholder="Price $" value=${o.price} onInput=${x=>{const op=[...e.options];op[i]={...o,price:x.target.value};setEd(r,{options:op})}}/><input className="field" placeholder="Lead time" value=${o.leadTime} onInput=${x=>{const op=[...e.options];op[i]={...o,leadTime:x.target.value};setEd(r,{options:op})}}/><input className="field" placeholder="Note" value=${o.note} onInput=${x=>{const op=[...e.options];op[i]={...o,note:x.target.value};setEd(r,{options:op})}}/><button className="ib" aria-label="Remove option" onClick=${()=>setEd(r,{options:e.options.filter((_,k)=>k!==i)})}>${I('x',{width:14})}</button></div>`)}
        <button className="btn btn-line btn-sm" style=${{justifySelf:'start'}} onClick=${()=>setEd(r,{options:[...e.options,{title:'',price:'',leadTime:'',note:''}]})}>${I('plus',{width:14})} Add option</button></div>
      <div className="g2f"><select className="field" value=${e.status} onChange=${x=>setEd(r,{status:x.target.value})}>${['received','sourcing','options_ready','ordered','closed'].map(k=>html`<option key=${k} value=${k}>${SR_LABEL[k]}</option>`)}</select><input className="field" placeholder="Note to the requester (emailed when the status changes)" value=${e.note} onInput=${x=>setEd(r,{note:x.target.value})}/></div>
      <button className="btn btn-ink" style=${{justifySelf:'start'}} onClick=${()=>save(r)}>Save</button>
    </div>`})}</div>`}
  </div>`;
}
function PricingAdmin({ctx}){
  const rows=useQuery(api.holm.adminPricing);const [only,setOnly]=useState(true);
  if(rows===undefined)return html`<p className="help" style=${{marginTop:18}}>Loading…</p>`;
  const flagged=rows.filter(r=>r.flags.length);const list=only?flagged:rows;const m=b=>b==null?'—':(b/100).toFixed(1)+'%';const $=c=>fmt(c/100,true);
  return html`<div style=${{marginTop:18,display:'grid',gap:14}}>
    <p className="help">Cost is the dealer cost plus the supplier freight allowance. Margins are after card processing (2.9% + 30¢). Trade never goes below a 25% margin; where that would happen, the floor holds the price and the piece is flagged. Delivery is one flat fee per order: ${deliveryText()}.</p>
    <div className="row" style=${{gap:8}}><button className=${'chip'+(only?' on':'')} onClick=${()=>setOnly(true)}>Flagged · ${flagged.length}</button><button className=${'chip'+(!only?' on':'')} onClick=${()=>setOnly(false)}>All pieces · ${rows.length}</button></div>
    ${list.length?html`<div style=${{overflowX:'auto'}}><table className="ptable" style=${{width:'100%',borderCollapse:'collapse',fontSize:13}}>
      <thead><tr>${['Piece','SKU','Cost','Retail','Trade','Project 5%','Trade margin','Project margin','Flags'].map(h=>html`<th key=${h} style=${{textAlign:'left',padding:'8px 10px',borderBottom:'1px solid var(--line2)',whiteSpace:'nowrap'}}>${h}</th>`)}</tr></thead>
      <tbody>${list.map(r=>html`<tr key=${r.productId+r.sku}>
        <td style=${{padding:'8px 10px',borderBottom:'1px solid var(--line)'}}>${r.name}${r.variant&&r.variant!=='Default'?html`<span className="mute"> · ${r.variant}</span>`:''}</td>
        <td className="mono" style=${{padding:'8px 10px',borderBottom:'1px solid var(--line)'}}>${r.sku}</td>
        ${[r.costCents?$(r.costCents):'Missing',$(r.retailCents),$(r.tradeCents),$(r.projectCents),m(r.tradeMarginBps),m(r.projectMarginBps)].map((v,i)=>html`<td key=${i} className="num" style=${{padding:'8px 10px',borderBottom:'1px solid var(--line)',whiteSpace:'nowrap'}}>${v}</td>`)}
        <td style=${{padding:'8px 10px',borderBottom:'1px solid var(--line)',color:r.flags.length?'var(--cognac)':'inherit'}}>${r.flags.join(' · ')||'OK'}</td></tr>`)}</tbody></table></div>`
      :html`<div className="empty"><h3>Nothing flagged</h3><p>Every piece keeps the full trade discount above the margin floor.</p></div>`}
  </div>`;
}
function PartnersAdmin({ctx}){
  const rows=useQuery(api.holmPartners.adminPartners);const setP=useMutation(api.holmPartners.adminSetPartner);const pay=useMutation(api.holmPartners.adminRecordPayout);const [refs,setRefs]=useState({});
  const run=(p,ok)=>p.then(()=>ctx.toast(ok)).catch(e=>ctx.toast(errText(e)));
  if(rows===undefined)return html`<p className="help" style=${{marginTop:18}}>Loading…</p>`;
  if(!rows.length)return html`<div className="empty"><h3>No partners yet</h3><p>Accounts that join the partner program appear here.</p></div>`;
  return html`<div style=${{display:'grid',gap:14,marginTop:18}}>${rows.map(p=>html`<div key=${p.userId} className="panel" style=${{display:'grid',gap:10}}>
    <div className="row" style=${{justifyContent:'space-between',flexWrap:'wrap'}}><h3>${p.name}</h3><span className="mono mute">${p.email} · ${p.refCode}</span></div>
    <div className="kv"><span className="mono mute">Pending</span><span>${fmt(p.pendingCents/100,true)}</span><span className="mono mute">Cleared</span><span>${fmt(p.clearedCents/100,true)}</span><span className="mono mute">Paid</span><span>${fmt(p.paidCents/100,true)}</span><span className="mono mute">W-9</span><span>${p.w9Status==='none'?'Not uploaded':html`${p.w9Url&&html`<a href=${p.w9Url} target="_blank" rel="noopener">View</a> · `}${p.w9Status==='approved'?'Approved':html`<button className="lnk" onClick=${()=>run(setP({userId:p.userId,w9Approved:true}),'W-9 approved')}>Approve</button>`}`}</span></div>
    <div className="row" style=${{flexWrap:'wrap'}}><select className="field" style=${{maxWidth:200}} value=${p.tier} onChange=${e=>run(setP({userId:p.userId,tier:e.target.value}),'Tier saved')}>${[['base','Base · 10%'],['active','Active · 12%'],['top','Top · 15%'],['elite','Elite · 18%']].map(([k,l])=>html`<option key=${k} value=${k}>${l}</option>`)}</select>
      ${p.clearedCents>0&&html`<input className="field" style=${{maxWidth:260}} placeholder="Payment reference" value=${refs[p.userId]||''} onInput=${e=>setRefs({...refs,[p.userId]:e.target.value})}/><button className="btn btn-ink" onClick=${()=>run(pay({userId:p.userId,reference:refs[p.userId]||''}),'Payout recorded')}>Record payout of ${fmt(p.clearedCents/100,true)}</button>`}</div>
  </div>`)}</div>`;
}
function TradeAdmin({ctx}){
  const [status,setStatus]=useState('pending');const rows=useQuery(api.holm.adminApplications,ctx.me.admin?{status}:'skip');const review=useMutation(api.holm.reviewApplication);
  const [notes,setNotes]=useState({});const [busy,setBusy]=useState('');
  if(!ctx.me.admin)return null;
  const decide=async(id,decision)=>{setBusy(id+decision);try{await review({id,decision,note:notes[id]||undefined});ctx.toast('Saved')}catch(e){ctx.toast(e?.data||'Could not save the decision')}finally{setBusy('')}};
  return html`<div>
    <div className="ph-head"><div><h1>Trade applications</h1></div><div className="seg">${[['pending','In review'],['needs_info','Needs info'],['approved','Approved'],['rejected','Not approved']].map(([k,l])=>html`<button key=${k} className=${status===k?'on':''} onClick=${()=>setStatus(k)}>${l}</button>`)}</div></div>
    ${rows===undefined?html`<p className="help">Loading…</p>`:!rows.length?html`<div className="empty"><h3>Nothing here</h3><p>No applications with this status.</p></div>`:
    html`<div style=${{display:'grid',gap:14}}>${rows.map(r=>html`<div key=${r._id} className="panel" style=${{display:'grid',gap:10}}>
      <div className="row" style=${{justifyContent:'space-between',flexWrap:'wrap'}}><h3>${r.businessName}</h3><span className="mono mute">${new Date(r.submittedAt).toLocaleString()}</span></div>
      <dl className="specs" style=${{gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))'}}>
        <div><dt>Type</dt><dd>${BTYPES[r.businessType]?.l||r.businessType}</dd></div><div><dt>State</dt><dd>${r.state}</dd></div><div><dt>EIN</dt><dd className="num">••-•••${r.einLast4}</dd></div>
        <div><dt>Online</dt><dd>${r.website}</dd></div><div><dt>Credential</dt><dd>${r.businessType==='pm'?`${r.company} · ${r.workEmail}`:r.credential}</dd></div><div><dt>Account</dt><dd>${r.email}</dd></div>
        <div><dt>Tax exemption</dt><dd>${r.taxRequested?(r.certificateUrl?html`<a href=${r.certificateUrl} target="_blank" rel="noopener">View certificate</a>`:'Requested, no file'):'No'}</dd></div>
      </dl>
      ${status==='pending'||status==='needs_info'?html`<textarea className="field" rows="2" placeholder="Note to the applicant (sent with needs info or not approved)" value=${notes[r._id]||''} onInput=${e=>setNotes({...notes,[r._id]:e.target.value})}></textarea>
      <div className="row" style=${{flexWrap:'wrap'}}><button className="btn btn-ink" disabled=${!!busy} onClick=${()=>decide(r._id,'approved')}>Approve</button><button className="btn btn-line" disabled=${!!busy} onClick=${()=>decide(r._id,'needs_info')}>Ask for more information</button><button className="btn btn-line" disabled=${!!busy} onClick=${()=>decide(r._id,'rejected')}>Don't approve</button></div>`:r.reviewNote&&html`<p className="help">${r.reviewNote}</p>`}
    </div>`)}</div>`}
  </div>`;
}
/* ================= QUIZ v2: blend two styles ================= */
const STYLES={
  'warm-modern':{name:'Warm Modern',line:'Clean lines in cognac leather and warm oak.',pal:['#A0612F','#E9DCC8','#6B4A33','#C9A273'],picks:[3,2,13,9,24,8],mats:['leather'],anchor:'a clean-lined leather sofa',accent:'warm oak and soft cream walls',avoid:'heavy ornament'},
  'club':{name:'Moody Club',line:'Velvet, brass and low light, built for evenings.',pal:['#1F2A44','#9A5A2E','#B58D52','#3B2A1E'],picks:[5,17,11,16,20,9],mats:['velvet','brass','leather'],anchor:'a deep velvet sectional',accent:'brass lamps and dark lacquer',avoid:'bright, flat lighting'},
  'organic':{name:'Organic Mediterranean',line:'Rattan, bouclé, limestone and soft curves.',pal:['#E7DFD0','#C9A46C','#B07A4A','#8C8A6E'],picks:[12,8,19,21,14,7],mats:['rattan','boucle'],anchor:'a woven or curved bench',accent:'rattan light and olive greenery',avoid:'glossy, hard finishes'},
  'parisian':{name:'Parisian Classic',line:'Olive velvet, marble and brass, with a little romance.',pal:['#5E6338','#D8B4A6','#B58D52','#EDE7DD'],picks:[4,11,14,16,10,15],mats:['velvet','brass'],anchor:'an olive velvet sofa',accent:'brass, marble and panelled walls',avoid:'stark minimalism'},
  'soft-minimal':{name:'Soft Minimal',line:'Ivory bouclé, pale wood and quiet space.',pal:['#EEEAE3','#E7DFD0','#CFCBC4','#CDAA7C'],picks:[7,10,19,22,18,11],mats:['boucle'],anchor:'an ivory bouclé corner sofa',accent:'pale oak and lots of daylight',avoid:'clutter and dark colour'},
  'mid-century':{name:'Mid-Century Studio',line:'Tan leather on tapered walnut legs.',pal:['#B07A4A','#6B4A33','#E9DCC8','#5E6338'],picks:[24,23,13,16,15,1],mats:['leather'],anchor:'a tufted leather bench on tapered legs',accent:'walnut with olive accents',avoid:'overstuffed shapes'},
  'industrial':{name:'Industrial Loft',line:'Cognac against brick, steel and concrete.',pal:['#A0612F','#8E4A3A','#2A2522','#BDB6AC'],picks:[2,20,13,9,1,16],mats:['leather'],anchor:'a channelled cognac sofa',accent:'black steel and raw concrete',avoid:'delicate, frilly pieces'},
};
const SK=Object.keys(STYLES);
const SPACE_BIAS={cafe:{organic:1,parisian:1,'warm-modern':.6},coffee:{organic:.8,industrial:.8,'mid-century':.8},restaurant:{parisian:1,club:.8,'warm-modern':.6},bar:{club:1.4,industrial:.6,parisian:.4},work:{'soft-minimal':1,'warm-modern':.8,industrial:.6},staging:{'soft-minimal':1,organic:.8,'warm-modern':.6}};
const PAIRS=[['Tailored','Relaxed',['club','mid-century','parisian'],['organic','soft-minimal'],20,19],['Light & airy','Dark & moody',['soft-minimal','organic','parisian'],['club','industrial'],7,5],['Clean lines','Soft curves',['mid-century','warm-modern','industrial'],['organic','parisian','club'],3,6],['Classic','Contemporary',['parisian','club'],['soft-minimal','warm-modern','industrial'],16,18]];
const PAIR_LABELS=['Very','Leaning','A bit of both','Leaning','Very'];
function Quiz({ctx}){
  const [step,setStep]=useState(0);const [space,setSpace]=useState(ctx.space);const [rooms,setRooms]=useState([]);const [sl,setSl]=useState([0,0,0,0]);const [mats,setMats]=useState([]);const [budget,setBudget]=useState(9999);const [blend,setBlend]=useState(null);
  const STEPS=['Your space','Rooms you love','Your balance','Materials','Budget'];
  const scores=useMemo(()=>{const s=Object.fromEntries(SK.map(k=>[k,.2]));const add=(ks,w)=>ks.forEach(k=>s[k]+=w);
    Object.entries(SPACE_BIAS[space]||{}).forEach(([k,w])=>s[k]+=w);rooms.forEach(k=>s[k]+=3);
    PAIRS.forEach((p,i)=>{const v=sl[i];if(v===0){add(p[2],.5);add(p[3],.5)}else add(v<0?p[2]:p[3],Math.abs(v)*1.5)});
    mats.forEach(m=>SK.forEach(k=>{if(STYLES[k].mats.includes(m))s[k]+=1.5}));
    const tot=Object.values(s).reduce((a,b)=>a+b,0);return SK.map(k=>({k,v:s[k]/tot})).sort((a,b)=>b.v-a.v)},[space,rooms,sl,mats]);
  const A=scores[0],B=scores[1];const defBlend=Math.round(B.v/(A.v+B.v)*100);const b=(blend??defBlend)/100;const close=(A.v-B.v)<.04;
  const SA=STYLES[A.k],SB=STYLES[B.k];
  const fits=p=>!(p.seats>0&&p.price/p.seats>budget);
  const picks=(()=>{const nB=Math.round(b*6),nA=6-nB;const out=[];const take=(st,n)=>{st.picks.map(byId).filter(fits).forEach(p=>{if(n>0&&!out.includes(p)){out.push(p);n--}})};take(SA,nA);take(SB,nB);
    if(out.length<6)[...SA.picks,...SB.picks].map(byId).forEach(p=>{if(out.length<6&&!out.includes(p))out.push(p)});return out})();
  const name=b<.2?SA.name:b>.8?SB.name:`${SA.name} × ${SB.name}`;
  const lead=b<=.5?SA:SB,second=b<=.5?SB:SA;
  const tog=(arr,set,v,max)=>set(arr.includes(v)?arr.filter(x=>x!==v):arr.length>=max?arr:[...arr,v]);
  const done=step>=STEPS.length;
  return html`<main className="wrap"><div className="quiz">
    <div className="qbar"><i style=${{width:Math.min(100,step/STEPS.length*100)+'%'}}></i></div>
    ${!done&&html`<span className="mono mute">${String(step+1).padStart(2,'0')} / ${String(STEPS.length).padStart(2,'0')} · ${STEPS[step]}</span>`}
    ${step===0&&html`<div key="0" className="qz-step"><h1 className="qz-h">What are you furnishing?</h1>
      <div className="qopts">${SPACE_KEYS.map(k=>html`<button key=${k} className=${'qopt'+(space===k?' on':'')} onClick=${()=>{setSpace(k);setStep(1)}}><div className="im" style=${{backgroundImage:`url(${byId(SPACES[k].picks[0]).img})`}}></div><div className="t"><b>${SPACES[k].label}</b><small>${SPACES[k].lede.split('.')[0]}</small></div></button>`)}</div></div>`}
    ${step===1&&html`<div key="1" className="qz-step"><h1 className="qz-h">Which rooms pull you in?</h1><p className="qz-sub">Pick up to three. If you love two different looks, pick both; we'll blend them.</p>
      <div className="qopts">${SK.map(k=>html`<button key=${k} className=${'qopt'+(rooms.includes(k)?' on':'')} onClick=${()=>tog(rooms,setRooms,k,3)} aria-pressed=${rooms.includes(k)}><div className="im" style=${{backgroundImage:`url(${byId(STYLES[k].picks[0]).img})`}}></div><div className="t"><b>${STYLES[k].name}</b><small>${STYLES[k].line}</small></div></button>`)}</div>
      <div className="qz-nav"><button className="btn btn-line" onClick=${()=>setStep(0)}>${I('back',{width:15})} Back</button><button className="btn btn-line" onClick=${()=>{setRooms([]);setStep(2)}}>None of these, skip</button><button className="btn btn-ink" onClick=${()=>setStep(2)}>Continue ${I('arrow',{width:15})}</button></div></div>`}
    ${step===2&&html`<div key="2" className="qz-step"><h1 className="qz-h">Where do you land?</h1><p className="qz-sub">Slide toward what feels right. The middle means a bit of both, which is a perfectly good answer.</p>
      <div className="qz-pairs">${PAIRS.map((p,i)=>html`<div key=${i} className="qz-pair">
        <div className="qz-end"><span style=${{backgroundImage:`url(${byId(p[4]).img})`}}></span><b>${p[0]}</b></div>
        <div className="qz-slide"><input type="range" min="-2" max="2" step="1" value=${sl[i]} onInput=${e=>{const n=[...sl];n[i]=+e.target.value;setSl(n)}} aria-label=${p[0]+' or '+p[1]}/><span className="mono">${sl[i]===0?PAIR_LABELS[2]:`${PAIR_LABELS[sl[i]<0?0:4].replace('Very',Math.abs(sl[i])===2?'Very':'Leaning')} ${(sl[i]<0?p[0]:p[1]).toLowerCase()}`}</span></div>
        <div className="qz-end r"><span style=${{backgroundImage:`url(${byId(p[5]).img})`}}></span><b>${p[1]}</b></div></div>`)}</div>
      <div className="qz-nav"><button className="btn btn-line" onClick=${()=>setStep(1)}>${I('back',{width:15})} Back</button><button className="btn btn-ink" onClick=${()=>setStep(3)}>Continue ${I('arrow',{width:15})}</button></div></div>`}
    ${step===3&&html`<div key="3" className="qz-step"><h1 className="qz-h">Which materials do you want to touch?</h1><p className="qz-sub">Choose up to three, or skip if you're not sure.</p>
      <div className="qopts">${Object.keys(MAT).map(m=>html`<button key=${m} className=${'qopt'+(mats.includes(m)?' on':'')} onClick=${()=>tog(mats,setMats,m,3)} aria-pressed=${mats.includes(m)}><div className="im" style=${{backgroundImage:`url(${PRODUCTS.find(p=>p.mat===m).img})`}}></div><div className="t"><b>${MAT[m]}</b></div></button>`)}</div>
      <div className="qz-nav"><button className="btn btn-line" onClick=${()=>setStep(2)}>${I('back',{width:15})} Back</button><button className="btn btn-line" onClick=${()=>{setMats([]);setStep(4)}}>Not sure, skip</button><button className="btn btn-ink" onClick=${()=>setStep(4)}>Continue ${I('arrow',{width:15})}</button></div></div>`}
    ${step===4&&html`<div key="4" className="qz-step"><h1 className="qz-h">Budget per seat?</h1>
      <div className="qopts">${[[400,'Under $400','Benches and ottomans',18],[800,'$400 to $800','Leather benches, tufted pieces',23],[9999,'Open','Sofas and sectionals',3]].map(([v,l,s,img])=>html`<button key=${v} className=${'qopt'+(budget===v?' on':'')} onClick=${()=>{setBudget(v);setBlend(null);setStep(5)}}><div className="im" style=${{backgroundImage:`url(${byId(img).img})`}}></div><div className="t"><b>${l}</b><small>${s}</small></div></button>`)}</div>
      <div className="qz-nav"><button className="btn btn-line" onClick=${()=>setStep(3)}>${I('back',{width:15})} Back</button></div></div>`}
    ${done&&html`<div className="qz-step">
      <span className="eyebrow">Your style${close?' sits between two looks':''}</span>
      <h1 style=${{fontSize:'clamp(44px,6vw,84px)'}}><em style=${{color:'var(--cognac)'}}>${name}</em></h1>
      <p className="mute" style=${{maxWidth:'62ch',marginTop:12,fontSize:16}}>${close?`You land almost evenly between ${SA.name} and ${SB.name}. That's a great place to be: use the slider to choose how much of each you want.`:`You lean ${SA.name}, with ${SB.name} as your second voice. Slide to bring in more or less of it.`}</p>
      <div className="qz-blend">
        <div className="qz-blend-h"><b>${SA.name}</b><span className="mono">${100-Math.round(b*100)}% · ${Math.round(b*100)}%</span><b>${SB.name}</b></div>
        <input type="range" min="0" max="100" step="5" value=${Math.round(b*100)} onInput=${e=>setBlend(+e.target.value)} aria-label="Blend between the two styles"/>
        <div className="palette" style=${{height:40,marginTop:12}}>${SA.pal.map(c=>html`<i key=${'a'+c} style=${{background:c,flex:1-b+.05}}></i>`)}${SB.pal.map(c=>html`<i key=${'b'+c} style=${{background:c,flex:b+.05}}></i>`)}</div>
      </div>
      <div className="g2" style=${{marginTop:18}}>
        <div className="panel"><h3>How to blend it</h3><ul className="pp-list" style=${{marginTop:8}}><li><b>Anchor</b> with ${lead.anchor}.</li><li><b>Layer in</b> ${second.accent}.</li><li><b>Materials:</b> ${[...new Set([...lead.mats,...second.mats])].map(m=>MAT[m].toLowerCase()).join(', ')}.</li><li><b>Steer away from</b> ${lead.avoid}.</li></ul></div>
        <div className="panel"><h3>Your style mix</h3>${scores.map(s=>html`<div key=${s.k} className="hbar"><span>${STYLES[s.k].name}</span><span className="b"><i style=${{width:Math.round(s.v/scores[0].v*100)+'%',background:s.k===A.k||s.k===B.k?'var(--cognac)':'var(--sand)'}}></i></span><span className="mono num">${Math.round(s.v*100)}%</span></div>`)}
          <p className="help">Curious about ${STYLES[scores[2].k].name}? <button className="lnk" onClick=${()=>setBlend(null)||setRooms([...new Set([...rooms,scores[2].k])].slice(-3))}>Add it to the mix</button></p></div>
      </div>
      <div className="row" style=${{margin:'24px 0',flexWrap:'wrap'}}><button className="btn btn-ink btn-lg" onClick=${()=>ctx.toStudio(picks.slice(0,5).map(p=>p.id),name)}>${I('brush',{width:17})} Open in Studio</button><button className="btn btn-line btn-lg" onClick=${()=>{const id=ctx.createBoard(name,null);picks.forEach(p=>ctx.saveTo(p.id,id,true));ctx.toast('Saved as a board',{label:'View',fn:()=>{ctx.setBoard(id);ctx.go('board')}})}}>Save as board</button><button className="btn btn-line btn-lg" onClick=${()=>{ctx.setRoomSeed(picks.slice(0,5).map(p=>p.id));ctx.go('room')}}>Plan it in 3D</button><button className="btn btn-line btn-lg" onClick=${()=>setStep(1)}>Adjust answers</button></div>
      <${Wall} items=${picks} ctx=${ctx}/>
    </div>`}
  </div></main>`;
}
/* ================= ACCOUNT ================= */
function Account({ctx}){
  const me=ctx.me;const app=useQuery(api.holm.myApplication);
  if(!me.signedIn)return html`<main className="wrap"><div className="empty" style=${{padding:'80px 0'}}><h3>Sign in to manage your account</h3><button className="btn btn-ink" onClick=${()=>ctx.go('welcome')}>Sign in</button></div></main>`;
  const trade={approved:'Verified',pending:'In review',needs_info:'More information needed',rejected:'Not approved',none:'Not applied'}[me.tradeStatus]||'Not applied';
  return html`<main className="wrap"><div className="acct">
    <nav aria-label="Account settings"><button className="on">Account</button><button onClick=${()=>ctx.go('hub')}>Quotes and trade pass</button><button onClick=${ctx.signOut}>Log out</button></nav>
    <section className="acct-sec">
      <h2>Your account</h2>
      <dl className="specs">
        <div><dt>Email</dt><dd>${me.email}</dd></div>
        <div><dt>Business</dt><dd>${me.businessName||app?.businessName||'Not added yet'}</dd></div>
        <div><dt>Trade status</dt><dd style=${me.verified?{color:'var(--ok)'}:{}}>${trade}</dd></div>
        <div><dt>Pricing</dt><dd>${me.verified?'Trade, with project pricing':'Retail'}</dd></div>
      </dl>
      ${!me.verified&&me.tradeStatus!=='pending'&&html`<button className="btn btn-ink" style=${{justifySelf:'start'}} onClick=${()=>ctx.go('trade')}>Apply for trade pricing</button>`}
      ${me.admin&&html`<button className="btn btn-line" style=${{justifySelf:'start'}} onClick=${()=>ctx.go('admin')}>Review trade applications</button>`}
      <p className="help">To change your email, add a resale certificate after approval or close your account, email withlove@louiemae.com from the address on this account.</p>
    </section>
  </div></main>`;
}
/* ================= WELCOME / LOGIN ================= */
function Welcome({ctx}){
  const {signIn}=useAuthActions();const ensure=useMutation(api.holm.ensureProfile);const opts=useQuery(api.holm.signInOptions);
  // Google returns to /trade/ (OAuth adds ?code=, which can't follow a #route), so the next page waits in session storage.
  const google=async()=>{setErr('');setBusy(true);try{sessionStorage.setItem('hol:after',ctx.afterSignIn||'home')}catch(x){}try{await signIn('google',{redirectTo:'/trade/'})}catch(x){setBusy(false);setErr('Google sign-in is not available right now. Use your email instead.')}};
  const [flow,setFlow]=useState('signIn');const [e,setE]=useState('');const [pw,setPw]=useState('');const [err,setErr]=useState('');const [busy,setBusy]=useState(false);
  const cols=[[1,7,12,17,4,20],[2,8,13,19,9,22],[3,10,14,21,5,11]];
  useEffect(()=>{if(ctx.me.signedIn){ensure().catch(()=>{});ctx.go(ctx.afterSignIn||'home')}},[ctx.me.signedIn]);
  const submit=async ev=>{ev.preventDefault();setErr('');
    if(!/^\S+@\S+\.\S+$/.test(e))return setErr('Enter your email address.');
    if(pw.length<8)return setErr('Use a password of at least 8 characters.');
    setBusy(true);try{const fd=new FormData();fd.set('email',e.trim().toLowerCase());fd.set('password',pw);fd.set('flow',flow);await signIn('password',fd)}
    catch(x){setErr(flow==='signIn'?'That email and password did not match. Try again or create an account.'+(opts?.google?' If you have signed in with Google before, use Continue with Google.':''):'We could not create that account. If you already have one, sign in instead.')}finally{setBusy(false)}};
  return html`<main className="welcome">
    <div className="wl-art"><div className="wl-cols">${cols.map((c,i)=>html`<div key=${i} className="wl-col">${[...c,...c].map((id,j)=>html`<img key=${j} src=${byId(id).img} alt="" loading="lazy"/>`)}</div>`)}</div>
      <div className="wl-mark"><div><h1>House of Louie Mae</h1><p style=${{opacity:.8}}>The trade floor for rooms people remember.</p></div></div></div>
    <div className="wl-form"><form onSubmit=${submit} noValidate>
      <h2>${flow==='signIn'?html`Welcome <em style=${{color:'var(--cognac)'}}>back</em>`:html`Create your <em style=${{color:'var(--cognac)'}}>account</em>`}</h2>
      <p className="mute">${flow==='signIn'?'Sign in to your projects, client quotes and trade pricing.':'Save projects, request quotes and apply for trade pricing.'}</p>
      ${opts?.google&&html`<button type="button" className="btn btn-line btn-lg" style=${{justifyContent:'center',gap:10}} disabled=${busy} onClick=${google}><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.7l-7.8 6C6.6 42.6 14.6 48 24 48z"/></svg>Continue with Google</button>
      <div className="row" style=${{gap:10,alignItems:'center'}}><span style=${{flex:1,height:1,background:'var(--line2)'}}></span><span className="mono mute">or with email</span><span style=${{flex:1,height:1,background:'var(--line2)'}}></span></div>`}
      <div><label className="lbl" htmlFor="le">Work email</label><input id="le" className="field" type="email" autoComplete="email" value=${e} onInput=${x=>{setE(x.target.value);setErr('')}} placeholder="you@business.com"/></div>
      <div><label className="lbl" htmlFor="lp">Password</label><input id="lp" className="field" type="password" autoComplete=${flow==='signIn'?'current-password':'new-password'} value=${pw} onInput=${x=>{setPw(x.target.value);setErr('')}}/>${flow==='signUp'&&html`<p className="help">At least 8 characters.</p>`}</div>
      ${err&&html`<p className="help" style=${{color:'var(--bad)'}}>${err}</p>`}
      <button className="btn btn-ink btn-lg" style=${{justifyContent:'center'}} disabled=${busy}>${busy?'One moment…':flow==='signIn'?'Sign in':'Create account'}</button>
      <p className="help" style=${{textAlign:'center'}}>${flow==='signIn'?html`New to the House? <button type="button" className="lnk" onClick=${()=>{setFlow('signUp');setErr('')}}>Create an account</button>`:html`Already have an account? <button type="button" className="lnk" onClick=${()=>{setFlow('signIn');setErr('')}}>Sign in</button>`}</p>
      <p className="help" style=${{textAlign:'center'}}>By continuing you agree to our <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</p>
    </form></div>
  </main>`;
}

/* ================= APP ================= */
export function App(){
  const me0=useQuery(api.holm.me);const me=me0||{signedIn:false,verified:false,admin:false,tradeStatus:'none'};
  const {signOut:authSignOut}=useAuthActions();const ensureProfile=useMutation(api.holm.ensureProfile);
  useEffect(()=>{if(me.signedIn)ensureProfile({ref:activeRef()?.code}).catch(()=>{})},[me.signedIn]);
  // back from Google sign-in: continue to the page that asked for it
  useEffect(()=>{if(!me.signedIn)return;let r=null;try{r=sessionStorage.getItem('hol:after');sessionStorage.removeItem('hol:after')}catch(x){}if(r&&r!=='welcome')location.hash=r},[me.signedIn]);
  const [afterSignIn,setAfterSignIn]=useState(null);
  const getRoute=()=>(location.hash.replace('#','')||'home');
  const [route,setRoute]=useState(getRoute());
  const [space,setSpace]=useState(()=>load('space','bar'));
  const [modePref,setModePref]=useState(()=>load('mode','trade'));const mode=me.verified?modePref:'retail';const setMode=m=>{if(me.verified)setModePref(m)};
  const [boards,setBoards]=useState(()=>load('boards',BOARD_SEED).map(b=>({...b,pins:b.pins.filter(x=>has(x.pid))})));
  const [tray,setTrayState]=useState(()=>{const t=load('tray',TRAY_SEED);const projects=(t.projects||[]).map(p=>({...p,items:(p.items||[]).filter(i=>has(i.pid))}));return projects.length?{...t,taxExempt:false,later:(t.later||[]).filter(x=>has(x.pid)),projects,active:projects.some(p=>p.id===t.active)?t.active:projects[0].id}:TRAY_SEED});
  const [collages,setCollages]=useState(()=>load('collages',[]).filter(c=>c.els.every(e=>e.kind!=='img'||has(e.pid))));
  const [likes,setLikes]=useState([]);const [recent,setRecent]=useState([]);
  const [inspo,setInspo]=useState(()=>load('inspo',INSPO_SEED));const [roomWall,setRoomWall]=useState(null);
  useEffect(()=>store('inspo',inspo),[inspo]);
  const [pin,setPin]=useState(null);const [trayOpen,setTray]=useState(false);const [menu,setMenu]=useState(false);const [toastS,setToastS]=useState(null);
  const [query,setQuery]=useState('');const [imgQ,setImgQ]=useState(null);
  const [studioSeed,setStudioSeed]=useState(null);const [nonce,setNonce]=useState(0);const [roomSeed,setRoomSeed]=useState(null);const [board,setBoard]=useState('b1');const [trend,setTrend]=useState('t1');
  useEffect(()=>{const h=()=>{const r=getRoute();if(r.startsWith('p/')){const id=+r.slice(2);if(has(id)){setPin(id);return}}setRoute(r);setPin(null);scrollTo(0,0)};h();addEventListener('hashchange',h);return()=>removeEventListener('hashchange',h)},[]);
  // a visit through a partner link (?ref=CODE&ch=channel)
  const recordClick=useMutation(api.holmPartners.recordClick);
  useEffect(()=>{const q=new URLSearchParams(location.search);const code=(q.get('ref')||'').toUpperCase().replace(/[^A-Z0-9]/g,'');if(!code)return;const ch=(q.get('ch')||'direct').toLowerCase();store('ref',{code,ch,at:Date.now()});recordClick({refCode:code,channel:ch,target:getRoute(),visitorId:visitorId()}).catch(()=>{})},[]);
  // projects, boards, collages and inspiration follow the account
  const remote=useQuery(api.holmSync.load,me.signedIn?{}:'skip');const saveState=useMutation(api.holmSync.save);const synced=useRef(false);
  useEffect(()=>{if(!me.signedIn)synced.current=false},[me.signedIn]);
  useEffect(()=>{if(!me.signedIn||!remote||synced.current)return;synced.current=true;
    const push=(key,value)=>saveState({key,value}).catch(()=>{});
    // the account wins on matching ids; work from this device that the account doesn't have is kept
    const localProjects=tray.projects.filter(p=>p.items.length&&!(remote.tray?.projects||[]).some(r=>r.id===p.id));
    if(remote.tray?.projects?.length){const projects=[...remote.tray.projects.map(p=>({...p,items:(p.items||[]).filter(i=>has(i.pid))})),...localProjects];const merged={...remote.tray,taxExempt:false,later:(remote.tray.later||[]).filter(x=>has(x.pid)),projects,active:projects.some(p=>p.id===remote.tray.active)?remote.tray.active:projects[0].id};setTrayState(merged);if(localProjects.length)push('tray',merged)}
    else if(tray.projects.some(p=>p.items.length))push('tray',tray);
    const remoteBoards=Array.isArray(remote.boards)?remote.boards:[];
    const localBoards=boards.filter(b=>b.pins.length&&!remoteBoards.some(r=>r.id===b.id));
    if(remoteBoards.length){const merged=[...remoteBoards.map(b=>({...b,pins:b.pins.filter(x=>has(x.pid))})),...localBoards];setBoards(merged);if(localBoards.length)push('boards',merged)}
    else if(localBoards.length)push('boards',boards);
    if(Array.isArray(remote.collages))setCollages(remote.collages.filter(c=>c.els.every(e=>e.kind!=='img'||has(e.pid))));
    if(Array.isArray(remote.inspo))setInspo(l=>[...remote.inspo,...l.filter(x=>!/^https?:/.test(x.src)&&!remote.inspo.some(y=>y.id===x.id))]);
    if(!Array.isArray(remote.collages)&&collages.length)push('collages',collages.map(c=>({...c,bg:c.bg?.img?.startsWith('data:')?{color:'#EFE6D8'}:c.bg,els:c.els.filter(e=>!String(e.src||'').startsWith('data:'))})));
  },[me.signedIn,remote]);
  const syncSave=(key,value)=>{if(!me.signedIn||!synced.current)return;const t=setTimeout(()=>saveState({key,value}).catch(()=>{}),1500);return()=>clearTimeout(t)};
  useEffect(()=>store('space',space),[space]);useEffect(()=>syncSave('tray',tray),[tray,me.signedIn]);useEffect(()=>syncSave('boards',boards),[boards,me.signedIn]);useEffect(()=>syncSave('collages',collages.map(c=>({...c,bg:c.bg?.img?.startsWith('data:')?{color:'#EFE6D8'}:c.bg,els:c.els.filter(e=>!String(e.src||'').startsWith('data:'))}))),[collages,me.signedIn]);useEffect(()=>syncSave('inspo',inspo.filter(x=>/^https?:/.test(x.src))),[inspo,me.signedIn]);useEffect(()=>store('mode',modePref),[modePref]);useEffect(()=>store('boards',boards),[boards]);useEffect(()=>store('tray',tray),[tray]);useEffect(()=>store('collages',collages),[collages]);
  useEffect(()=>{document.body.style.overflow=(pin||trayOpen||menu)?'hidden':''},[pin,trayOpen,menu]);
  const go=r=>{if(getRoute()===r){scrollTo({top:0,behavior:'smooth'});setPin(null)}else location.hash=r};
  const toast=(msg,action)=>setToastS({msg,action,k:Date.now()});
  const activeProject=tray.projects.find(p=>p.id===tray.active);
  const trayCount=activeProject.items.reduce((s,i)=>s+i.qty,0);
  const fly=(fromEl)=>{try{const btn=document.getElementById('trayBtn');if(!fromEl||!btn)return;const a=fromEl.getBoundingClientRect(),b=btn.getBoundingClientRect();const im=document.createElement('img');im.src=fromEl.src||fromEl.style.backgroundImage.slice(5,-2);im.className='fly';const sz=Math.min(140,a.width);Object.assign(im.style,{left:a.left+a.width/2-sz/2+'px',top:a.top+a.height/2-sz/2+'px',width:sz+'px',height:sz+'px'});document.body.appendChild(im);
    im.animate([{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${b.left+b.width/2-(a.left+a.width/2)}px,${b.top+b.height/2-(a.top+a.height/2)}px) scale(.12)`,opacity:.6}],{duration:700,easing:'cubic-bezier(.5,0,.2,1)'}).onfinish=()=>im.remove()}catch(e){}};
  const addToTray=(pid,qty=1,fromEl,quiet)=>{setTrayState(t=>({...t,projects:t.projects.map(p=>{if(p.id!==t.active)return p;const z=p.zones[0];const ex=p.items.find(i=>i.pid===pid&&i.zone===z);return {...p,items:ex?p.items.map(i=>i===ex?{...i,qty:i.qty+qty}:i):[...p.items,{pid,qty,zone:z}]}})}));
    fly(fromEl);if(!quiet)toast(`${byId(pid).name} added to ${activeProject.name}`,{label:'Open tray',fn:()=>setTray(true)})};
  const saveTo=(pid,bid,quiet)=>{setBoards(bs=>bs.map(b=>b.id===bid?{...b,t:Date.now(),pins:b.pins.some(x=>x.pid===pid)?b.pins:[{pid,sec:b.sections[0]||''},...b.pins]}:b).sort((a,b)=>b.t-a.t));if(!quiet){const b=boards.find(x=>x.id===bid);toast(`Saved to ${b?b.title:'board'}`,{label:'View',fn:()=>{setBoard(bid);go('board')}})}};
  const createBoard=(title,pid,secret=false)=>{const id='b'+uid();setBoards(bs=>[{id,title,secret,collab:0,sections:[],pins:pid?[{pid,sec:''}]:[],t:Date.now()},...bs]);if(pid)toast('Saved to '+title);return id};
  const updateBoard=(id,fn)=>setBoards(bs=>bs.map(b=>b.id===id?fn(b):b));
  const imageSearch=f=>{const r=new FileReader();r.onload=()=>{const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=c.height=48;const g=c.getContext('2d');g.drawImage(img,0,0,48,48);const d=g.getImageData(0,0,48,48).data;const buckets={};for(let i=0;i<d.length;i+=4){const k=[d[i]>>5,d[i+1]>>5,d[i+2]>>5].join();(buckets[k]=buckets[k]||{n:0,r:0,g:0,b:0});const B=buckets[k];B.n++;B.r+=d[i];B.g+=d[i+1];B.b+=d[i+2]}
    const pal=Object.values(buckets).sort((a,b)=>b.n-a.n).slice(0,5).map(B=>rgb2hex(B.r/B.n,B.g/B.n,B.b/B.n));setImgQ({src:r.result,pal});setQuery('');go('discover')};img.src=r.result};r.readAsDataURL(f)};
  const toStudio=(ids,title)=>{setStudioSeed({ids,title:title||'New collage'});setNonce(n=>n+1);setPin(null);go('studio')};
  const openPin=id=>{setPin(id);if(id)setRecent(r=>[id,...r.filter(x=>x!==id)].slice(0,8))};
  const addToProject=(pid,qty,projId,zone,fromEl,quiet)=>{setTrayState(t=>({...t,projects:t.projects.map(p=>{if(p.id!==projId)return p;const z=zone||p.zones[0];const ex=p.items.find(i=>i.pid===pid&&i.zone===z);return {...p,items:ex?p.items.map(i=>i===ex?{...i,qty:i.qty+qty}:i):[...p.items,{pid,qty,zone:z}]}})}));fly(fromEl);if(!quiet){const pn=(tray.projects.find(p=>p.id===projId)||{}).name||'project';toast(byId(pid).name+' added to '+pn+(zone?' · '+zone:''),{label:'Open tray',fn:()=>{setPin(null);setTray(true)}})}};
  const createProject=name=>{const id=uid();setTrayState(t=>({...t,projects:[...t.projects,{id,name,target:20,zones:['Main room'],items:[]}]}));toast(`Project "${name}" created`);return id};
  const addZone=(pid,z)=>setTrayState(t=>({...t,projects:t.projects.map(p=>p.id===pid&&!p.zones.includes(z)?{...p,zones:[...p.zones,z]}:p)}));
  const inspoCtx={inspo,addInspo:items=>setInspo(l=>[...items,...l]),removeInspo:id=>setInspo(l=>l.filter(x=>x.id!==id)),updateInspo:(id,o)=>setInspo(l=>l.map(x=>x.id===id?{...x,...o}:x)),roomWall,setRoomWall,inspoToStudio:(x,ids=[])=>{setStudioSeed({inspo:x,ids,title:x.title});setNonce(n=>n+1);go('studio')}};
  const signInThen=r=>{setAfterSignIn(r);go('welcome')};const signOut=async()=>{await authSignOut();synced.current=false;['tray','boards','collages','inspo'].forEach(k=>{try{localStorage.removeItem('hol:'+k)}catch(e){}});setTrayState(TRAY_SEED);setBoards(BOARD_SEED);setCollages([]);setInspo(INSPO_SEED);toast('Signed out');go('home')};
  const ctx={...inspoCtx,me,afterSignIn,signInThen,signOut,route,go,space,setSpace,mode,setMode,boards,saveTo,createBoard,updateBoard,tray,setTrayState,activeProject,trayCount,addToTray,setTray,setMenu,pin,openPin,recent,createProject,addZone,addToProject,toggleLike:id=>setLikes(l=>l.includes(id)?l.filter(x=>x!==id):[...l,id]),likes,toast,query,setQuery,imgQ,setImgQ,imageSearch,studioSeed,setStudioSeed,roomSeed,setRoomSeed,toStudio,board,setBoard,trend,setTrend,collages,saveCollage:c=>{setCollages(cs=>[c,...cs.filter(x=>x.title!==c.title)]);toast('Collage saved',{label:'View',fn:()=>go('boards')})},setTarget:n=>{setTrayState(t=>({...t,projects:t.projects.map(p=>p.id===t.active?{...p,target:n}:p)}));toast(`Seat target for ${activeProject.name} set to ${n}`,{label:'Open tray',fn:()=>setTray(true)})}};
  const pages={inspo:Inspo,home:Home,discover:Discover,trend:Trend,studio:Studio,room:Room,boards:Boards,board:BoardDetail,profile:Profile,hub:Hub,trade:Trade,quiz:Quiz,account:Account,welcome:Welcome,admin:AdminPage,sourcing:Sourcing};
  const Page=pages[route]||Home;
  if(route.startsWith('q/'))return html`<${React.Fragment}><${ClientQuote} ctx=${ctx} code=${route.slice(2)}/><${Toast} t=${toastS} onClose=${()=>setToastS(null)}/><//>`;
  return html`<${React.Fragment}>
    <${Header} ctx=${ctx}/>
    ${route.startsWith('b/')?html`<${SharedBoard} key=${route} ctx=${ctx} slug=${route.slice(2)}/>`:html`<${Page} key=${route+(route==='studio'?nonce:'')} ctx=${ctx}/>`}
    <${TabBar} ctx=${ctx}/>
    ${pin&&html`<${PinDetail} ctx=${ctx}/>`}
    ${trayOpen&&html`<${Tray} ctx=${ctx}/>`}
    ${menu&&html`<${IndexMenu} ctx=${ctx}/>`}
    <${Toast} t=${toastS} onClose=${()=>setToastS(null)}/>
  <//>`;
}
