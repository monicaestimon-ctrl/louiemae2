/* eslint-disable */
// @ts-nocheck
import { useRecoverableQuery } from '../contexts/useRecoverableQuery';
import { usePendingStudioSeed } from './pendingStudioSeed';
import {Studio,Room,Quiz,ShareSheet} from './DesignTools';
import { html, MAT, TYPE, byId, has, tp, pr, cut, pinItUrl, threeP, loadThree, LX, useThree, SPACES, SPACE_KEYS, COMMUNITY, load, store, hex2rgb, cdist, uid, copyText, COLOR_WORDS, matchPrompt, ICONS, I, useOutside, SaveMenu, PinCard, BoardPin, Wall, GLOW_AT, ROOMS, TEX, rnd, texture, STUDY, FLOOR_TILE, PAGES, pageOf, borderOf, POLY0, BW, boardH, boardPath, maskOf, LAYOUTS, SLOTS, mkImg, mkText, toneF, cropStyle, ElView, blends, elStyle, bgStyle, BoardPreview, errText, dataUrlBlob, dimsText, bundleUrl, gltfP, gltfLoader, glbCache, loadGLB, fitToDims } from './editorShared';
export {html} from './editorShared';
/* eslint-disable */
// @ts-nocheck
import { HouseStaffGate } from './admin/HouseStaffGate';

import { TradeAccount, TradeWelcome, TradeApplication, ProjectDeliveryPanel, ProductDeliveryEstimate, ProgramHubV2, TeamPanel } from './deferredFeatures';

import { DeliveryCalculatorDisclosure } from './DeliveryCalculatorDisclosure';

import { TradeNewsletter } from './TradeNewsletter';

import { ProgressiveSections } from './ProgressiveSections';

import { DiscoverCatalog } from './deferredFeatures';

import { SaveBoardMenu } from './SaveBoardMenu';

import { CatalogProductCard } from './CatalogProductCard';

import { ProductPrice as Price } from './ProductPrice';

import { formatHolmPrice as fmt } from './formatHolmPrice';

import { products as PRODUCTS, productsById as BY_ID, catalogGeneration, useCatalogRevision } from './catalogStore';

export { setProducts } from './catalogStore';

import { usePrivateIndexing } from '../components/usePrivateIndexing';

import React, { useState, useEffect, useLayoutEffect, useRef, useId, useMemo, startTransition } from 'react';

import htm from 'htm';

import type { HolmProduct } from './catalog';

import { displayProduct } from './catalogLookup';

import { plannerGeometry, rugExtents as rugExt, clampRug as rugClamp } from './plannerGeometry';

import { studioGeometry, studioStyle as styleOf, frameAspect as frameAR } from './studioGeometry';

import { holmLegacyId } from '../lib/holmProductIdentity';

import { editorSelections, reconcileEditorSelections, editorOrderQuantity } from './editorSelections';

import { editorShortcutsBlocked } from './editorShortcuts';

import { useProjectCatalog, projectResolutionMessage } from './useProjectCatalog';

import { useSavedBoardShelf } from './useSavedBoardShelf';

import { PlannerReview } from './PlannerReview';

import { usePlannerPersistence } from './usePlannerPersistence';

import { Modal } from '../components/Modal';

import { useFormValidation } from '../components/forms/useFormValidation';

import { ValidationSummary } from '../components/forms/ValidationSummary';

import { customerMessage } from '../lib/errors';

import { navigatePlainLink } from '../lib/navigation';

import { useQuery, useMutation, useAction } from 'convex/react';

import { SPLIT_MAY } from '../lib/customerCopy';

import { partnerCopy, partnerTerms, rateRows } from '../lib/holmPartners';

import { activeRef, captureRefFromUrl, pieceShareUrl, rememberRef, shareOrigin, visitorId } from '../lib/partnerLink';

import { useAuthActions } from '@convex-dev/auth/react';

import { api } from '../convex/_generated/api';

import { phoneCut } from './phoneCut.mjs';

import {LazyDeliveryQuoteAccess as DeliveryQuoteAccess} from '../components/delivery/LazyDeliveryQuoteAccess';

import { projectLines } from './projectLines';

import { resolveProjectProduct, resolveProjectItems, sameProjectSelection, sameSavedRow, restoreProjectItem, projectItemKey, mergeProjectItem } from './projectIdentity';

import { SafeImage } from '../components/SafeImage';

import DeliveryBoundary from '../components/delivery/DeliveryBoundary';

import { area as polyArea, inside as inPoly, centroid as polyCentre, bounds as polyBounds, setWallLength } from '../lib/holmPlan';

// Width / height of what cut() returns, as [w, h]; true size in cm from the product's W × D × H.
const cutWH = (id: number) => [byId(id).cutAR || byId(id).ar || 1, 1];

const cmW = (id: number) => byId(id).dimsCm?.w ?? byId(id).widthCm ?? 100;

const PIN_BOARDS=[];

const INSPO_SEED=[];

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

const rgb2hex=(r,g,b)=>'#'+[r,g,b].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');

// The screen height trade/index.html measured once (see --app-h), so scroll effects don't jump
// when a phone's toolbar slides away mid-scroll.
const appH=()=>parseFloat(document.documentElement.style.getPropertyValue('--app-h'))||innerHeight;

const palOf=img=>{const c=document.createElement('canvas');c.width=c.height=48;const g=c.getContext('2d');g.drawImage(img,0,0,48,48);const d=g.getImageData(0,0,48,48).data;const bk={};for(let i=0;i<d.length;i+=4){const k=[d[i]>>5,d[i+1]>>5,d[i+2]>>5].join();const B=(bk[k]=bk[k]||{n:0,r:0,g:0,b:0});B.n++;B.r+=d[i];B.g+=d[i+1];B.b+=d[i+2]}return Object.values(bk).sort((a,b)=>b.n-a.n).slice(0,5).map(B=>rgb2hex(B.r/B.n,B.g/B.n,B.b/B.n))};

const fileToInspo=f=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>{const img=new Image();img.onload=()=>{const s=Math.min(1,900/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);c.getContext('2d').drawImage(img,0,0,c.width,c.height);res({id:uid(),src:c.toDataURL('image/jpeg',.82),title:(f.name||'Pasted image').replace(/\.[^.]+$/,'').replace(/[-_]+/g,' ').slice(0,40),source:'upload',pal:palOf(img),ar:img.width/img.height,t:Date.now()})};img.onerror=rej;img.src=r.result};r.onerror=rej;r.readAsDataURL(f)});


/* ================= shared bits ================= */
function Toast({t,onClose}){
  useEffect(()=>{if(!t)return;const id=setTimeout(onClose,3200);return()=>clearTimeout(id)},[t]);
  if(!t)return null;
  return html`<div className="toast" role="status"><span>${t.msg}</span>${t.action&&html`<button onClick=${()=>{t.action.fn();onClose()}}>${t.action.label}</button>`}</div>`;
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
    <a className="site-out hide-sm" href="https://www.louiemae.com" title="Louie Mae, our retail site for your home">Louie Mae retail ${I('arrow',{width:14})}</a>
    <button className="ib hide-sm" title="Studio" aria-label="Studio" onClick=${()=>ctx.go('studio')}>${I('brush')}</button>
    <button className="ib tray-btn" id="trayBtn" title="Project tray" aria-label="Open project tray" onClick=${()=>ctx.setTray(true)}>${I('tray')}${ctx.trayCount>0&&html`<span className="badge">${ctx.trayCount}</span>`}</button>
    ${ctx.me.signedIn?html`<button className="hide-sm" onClick=${()=>ctx.go('profile')} aria-label="Your profile"><span className="avatar">${(ctx.me.businessName||ctx.me.displayName||'?')[0].toUpperCase()}</span></button>`:html`<button className="btn btn-line btn-sm hide-sm" onClick=${()=>ctx.go('welcome')}>Sign in</button>`}
    <button className="ib" title="Menu" aria-label="Open menu" data-modal-return-focus onClick=${()=>ctx.setMenu(true)}>${I('menu')}</button>
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
      ${items.map((it,i)=>{const p=byId(it.id);const ar=cutWH(it.id);const hang=it.top!=null;const w=hang?it.cm/roomCm*100:it.cm/roomCm*100*depth(it.b);const g=GLOW_AT[it.id];
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

const CHAPTERS=[
  ['The plan','Every room starts as a line.','We draw your floor at true scale: walls, openings and a footprint for every piece.'],
  ['The shell','The walls go up.','The plan extrudes into a clay model, with arches and windows cut where the light will come in.'],
  ['The pieces','Your pieces, placed at true scale.','Each Louie piece lands where it will live, sized from its real dimensions and casting real shadows.'],
  ['The finish','Plaster, oak, linen.','Materials wash over the clay: limewash walls, the floor you specify, a jute rug under the banquette.'],
  ['The light','Morning to last call.','Scroll through the day. Sun moves through the windows, then the pendants take over after dark.'],
];

const clamp01=v=>Math.max(0,Math.min(1,v));
const ease=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
const seg=(p,a,b)=>ease(clamp01((p-a)/(b-a)));


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
    const rugW=Math.min(W-1,cmW(rugAnchor.id)/100+1.2),rugD=2.6;
    const rug=new T.Mesh(new T.PlaneGeometry(rugW,rugD),new T.MeshStandardMaterial({map:tex(texture('jute').url,[rugW*1.6,rugD*1.6]),roughness:1,transparent:true,opacity:0}));rug.rotation.x=-Math.PI/2;rug.position.set(rugAnchor.x,.006,rugAnchor.z+1.1);rug.receiveShadow=true;scene.add(rug);
    // ---------- pieces (billboards with real alpha shadows) ----------
    const blob=(()=>{const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');const gr=g.createRadialGradient(64,64,0,64,64,64);gr.addColorStop(0,'rgba(0,0,0,.55)');gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(0,0,128,128);return new T.CanvasTexture(c)})();
    const glowTex=(()=>{const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');const gr=g.createRadialGradient(64,64,0,64,64,64);gr.addColorStop(0,'rgba(255,214,150,1)');gr.addColorStop(.3,'rgba(255,170,80,.35)');gr.addColorStop(1,'rgba(255,150,60,0)');g.fillStyle=gr;g.fillRect(0,0,128,128);return new T.CanvasTexture(c)})();
    const pieces=[];const lamps=[];
    cfg.items.forEach((it,i)=>{const p=byId(it.id);const ar=cutWH(it.id);const w=cmW(it.id)/100,h=w*ar[1]/ar[0];const map=tex(cut(it.id));
      const mat=new T.MeshStandardMaterial({map,transparent:true,alphaTest:.45,side:T.DoubleSide,roughness:.85});
      const mesh=new T.Mesh(new T.PlaneGeometry(w,h),mat);mesh.castShadow=true;mesh.customDepthMaterial=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,map,alphaTest:.45});
      const restY=it.hang?H-h/2-.05:h/2;mesh.position.set(it.x,restY,it.z);mesh.userData={it,restY,i,w,h};scene.add(mesh);
      let shadow=null;if(!it.hang){shadow=new T.Mesh(new T.PlaneGeometry(w*1.05,Math.max(.5,(p.dimsCm?.d||w*80)/100)),new T.MeshBasicMaterial({map:blob,transparent:true,depthWrite:false,opacity:0}));shadow.rotation.x=-Math.PI/2;shadow.position.set(it.x,.008,it.z);scene.add(shadow)}
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
    const fp=[];cfg.items.forEach(it=>{const p=byId(it.id);const w=cmW(it.id)/100;if(it.hang){const r=w/2;for(let k=0;k<24;k++){const a=k/24*Math.PI*2,b=(k+1)/24*Math.PI*2;fp.push(new T.Vector3(it.x+Math.cos(a)*r,.012,it.z+Math.sin(a)*r),new T.Vector3(it.x+Math.cos(b)*r,.012,it.z+Math.sin(b)*r))}return}const d=(p.dimsCm?.d??w*100)/100||w;const x0=it.x-w/2,x1=it.x+w/2,z0=it.z-d/2,z1=it.z+d/2;[[x0,z0,x1,z0],[x1,z0,x1,z1],[x1,z1,x0,z1],[x0,z1,x0,z0]].forEach(([a,b,c,e])=>fp.push(new T.Vector3(a,.012,b),new T.Vector3(c,.012,e)))});
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
    const labels=[{v:new T.Vector3(0,.02,D/2+.45),t:`${W.toFixed(1)} m`},{v:new T.Vector3(W/2+.6,.02,0),t:`${D.toFixed(1)} m`},...cfg.items.map(it=>{const p=byId(it.id);return {v:new T.Vector3(it.x,.02,it.z),t:`${p.name} · ${cmW(it.id)} cm`,cog:1}})];
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
        <span className="mono">${P0.sku} · ${MAT[P0.mat]} · ≈ ${cmW(P0.id)} cm</span><h3>${P0.name}</h3><p>${P0.line}</p>
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

// Desktop plays its own cut of each room (f/<film>/desk.mp4, desk-poster.jpg): the plan, the
// clay model rising from it, colour spreading across that model in place, then the film's
// furnished room into night. Its chapter, hotspot and night times (TL) and hotspot positions
// (hot, same order as FILMS[].hot) are its own; film.mp4 stays the source of the phone cut.
const DESK={
  bar:{TL:{"total":9.5,"ch":[0,1.0,4.5,7.8,8.7],"hot":[[8.0,8.6],[8.7,9.5]],"dark":8.7},hot:[[0.734,0.747],[0.159,0.567],[0.772,0.471],[0.084,0.627]]},
  'cafe-paris':{TL:{"total":15.0,"ch":[0,2.4,6.8,9.15,11.25],"hot":[[9.35,11.15],[13.6,15.0]],"dark":12.19},hot:[[0.52,0.46],[0.485,0.555],[0.615,0.27]]},
  'cafe-provence':{TL:{"total":12.46,"ch":[0,1.0,5.0,7.7,9.64],"hot":[[7.9,9.54],[11.06,12.46]],"dark":10.35},hot:[[0.9,0.53],[0.79,0.6],[0.05,0.58],[0.27,0.17]]},
  'coffee-riviera':{TL:{"total":9.42,"ch":[0,2.3,3.5,5.82,7.92],"hot":[[6.02,7.82],[8.12,9.42]],"dark":8.28},hot:[[0.5,0.61],[0.26,0.8],[0.74,0.8],[0.88,0.62]]},
  'home-estate':{TL:{"total":11.83,"ch":[0,1.0,5.0,7.36,9.46],"hot":[[7.56,9.36],[10.43,11.83]],"dark":10.04},hot:[[0.58,0.62],[0.8,0.83],[0.3,0.47]]},
  'resto-orangerie':{TL:{"total":15.0,"ch":[0,2.4,5.0,8.56,10.66],"hot":[[8.76,10.56],[13.6,15.0]],"dark":11.73},hot:[[0.25,0.58],[0.33,0.75],[0.76,0.69]]},
  'work-library':{TL:{"total":15.0,"ch":[0,2.4,8.3,9.9,11.23],"hot":[[10.1,11.13],[13.6,15.0]],"dark":12.16},hot:[[0.2,0.7],[0.79,0.7],[0.31,0.45],[0.57,0.85]]},
  'work-loft':{TL:{"total":13.96,"ch":[0,2.4,7.5,9.81,11.91],"hot":[[10.01,11.81],[12.56,13.96]],"dark":12.33},hot:[[0.27,0.6],[0.45,0.73],[0.82,0.7]]},
};

const filmsFor=space=>Object.keys(FILMS).filter(k=>FILMS[k].space===space);

const FILM_AR=16/9;

// Phones (any screen narrower than 3:4) get the film playing straight through (PhoneFilm)
// instead of scrubbed by scroll: one screen, no scroll-jacking, nothing to keep in step
// with the finger. Desktop and tablets keep FilmStudy.
const PHONE_FRAMES='(max-aspect-ratio: 3/4)';

function useMedia(q){const [m,setM]=useState(()=>matchMedia(q).matches);useEffect(()=>{const mq=matchMedia(q);const f=()=>setM(mq.matches);mq.addEventListener('change',f);return()=>mq.removeEventListener('change',f)},[q]);return m}


function FilmStudy({ctx,fk,setFk}){
  const F=FILMS[fk],D=DESK[fk],TL=D?D.TL:F.TL;const siblings=filmsFor(ctx.space);
  const HOTS=D?F.hot.map((h,i)=>({...h,x:D.hot[i][0],y:D.hot[i][1]})):F.hot;
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
  return html`<section className="rh hf" ref=${secRef} style=${{height:`calc(${D?(1+TL.total/3.5).toFixed(2):7.5} * var(--app-h, 100svh))`}} aria-label=${F.name+' film'}>
    <div className=${'hf-stage'+(dark?' night':'')} ref=${stageRef} onClick=${()=>setPick(null)}>
      <img className="hf-video" src=${`f/${fk}/${D?'desk-poster':'poster'}.jpg`} alt="" fetchpriority="high" aria-hidden="true"/>
      <video ref=${vidRef} className=${'hf-video hf-fade'+(ready?' on':'')} src=${`f/${fk}/${D?'desk':'film'}.mp4`} muted playsInline preload="none" aria-hidden="true" onLoadedData=${()=>setReady(true)}></video>
      <div className="hf-scrim" aria-hidden="true"></div>
      ${hot>=0&&HOTS.map((h,i)=>{const x=ox+h.x*mw,y=oy+h.y*mh;if(x<12||x>box.w-12||y<90||y>box.h-12)return null;const p=byId(h.id);return html`<button key=${hot+'-'+i} className="fs-hot" style=${{left:x+'px',top:y+'px',animationDelay:i*90+'ms'}} aria-label=${'View '+p.name} onClick=${e=>{e.stopPropagation();setPick({id:h.id,x:x/box.w*100,y:y/box.h*100})}}><i></i><span>${p.name}</span></button>`})}
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
// Phones get the same one-screen hero as desktop, with an explicitly started
// video instead of following the scroll: f/<film>/phone.mp4, a shorter 3:4 cut
// (trade/phoneCut.mjs): blueprint, clay, one shot into the room as its furniture takes
// on colour, then night. The headline follows the chapters. Pause remains available,
// and completion returns to the opening frame awaiting replay. No background video download.
function PhoneFilm({ctx,fk,setFk}){
  const F=FILMS[fk],P=phoneCut(F.TL,{clayAt:F.phoneClayAt,darkRoom:F.darkRoom});const siblings=filmsFor(ctx.space);
  const secRef=useRef(),vidRef=useRef(),last=useRef({ch:-1,dark:null});
  const [chi,setChi]=useState(0);const [dark,setDark]=useState(false);const [shown,setShown]=useState(false);
  const [started,setStarted]=useState(false);const [onScreen,setOnScreen]=useState(true);
  const [paused,setPaused]=useState(true);const [fading,setFading]=useState(false);
  const pendingSeek=useRef(null),loopTimer=useRef();
  const [pageVisible,setPageVisible]=useState(()=>!document.hidden);
  // index.html already showed chapter one; don't replay its entrance when the app takes over.
  const [fromShell]=useState(()=>document.documentElement.dataset.shell==='trade');useEffect(()=>{delete document.documentElement.dataset.shell},[]);
  // A poster is usable immediately. Fetch video only after an explicit play/chapter action.
  useEffect(()=>{const f=()=>setPageVisible(!document.hidden);document.addEventListener('visibilitychange',f);return()=>{document.removeEventListener('visibilitychange',f);clearTimeout(loopTimer.current)}},[]);
  useEffect(()=>{const io=new IntersectionObserver(([e])=>setOnScreen(e.isIntersecting),{threshold:0});io.observe(secRef.current);return()=>io.disconnect()},[]);
  useEffect(()=>{const v=vidRef.current;if(!v)return;v.muted=true;
    if(onScreen&&pageVisible&&!paused){const p=v.play();if(p)p.catch(e=>{if(e&&e.name!=='AbortError')setPaused(true)})}else v.pause()},[started,onScreen,pageVisible,paused]);
  useEffect(()=>{setHeroInk('#211912','#FBF8F2');return()=>setHeroInk('#211912','#FBF8F2')},[fk]);
  // the headline and ink follow the film as it plays
  const tick=()=>{const v=vidRef.current;if(!v)return;const t=v.currentTime;let c=0;for(let i=0;i<P.ch.length;i++)if(t>=P.ch[i])c=i;
    const dk=t>=P.dark;const L=last.current;
    if(c!==L.ch){L.ch=c;setChi(c)}
    if(dk!==L.dark){L.dark=dk;setDark(dk);setHeroInk(dk?'#F4EADC':'#211912',dk?'#1A130E':'#FBF8F2')}};
  useEffect(()=>{if(!shown||paused||!onScreen||!pageVisible)return;let raf=0;const loop=()=>{tick();raf=requestAnimationFrame(loop)};loop();return()=>cancelAnimationFrame(raf)},[shown,paused,onScreen,pageVisible]);
  // End at the opening frame; replay stays under the visitor's control.
  const ended=()=>{setPaused(true);setFading(true);clearTimeout(loopTimer.current);loopTimer.current=setTimeout(()=>{const v=vidRef.current;if(!v)return;v.currentTime=0;tick();setFading(false)},700)};
  const seek=()=>{const v=vidRef.current;if(v&&v.readyState>=1&&pendingSeek.current!==null){v.currentTime=pendingSeek.current;pendingSeek.current=null;tick()}};
  const reloadFailed=()=>{const v=vidRef.current;if(v?.error){setShown(false);v.load()}};
  const toChap=i=>{clearTimeout(loopTimer.current);setFading(false);pendingSeek.current=P.ch[i]+0.05;setStarted(true);reloadFailed();setPaused(false);seek()};
  const togglePlay=()=>{clearTimeout(loopTimer.current);setFading(false);setStarted(true);reloadFailed();setPaused(value=>!value)};
  const toTop=()=>{const sec=secRef.current;if(sec&&sec.getBoundingClientRect().top<0)scrollTo({top:sec.getBoundingClientRect().top+scrollY,behavior:'smooth'})};
  const ch=F.ch[chi];const ids=[...new Set(F.hot.map(h=>h.id))];
  return html`<section className="rh hf pf" ref=${secRef} aria-label=${F.name+' film'}>
    <div className=${'hf-stage'+(dark?' night':'')}>
      <img className="hf-video" src=${`f/${fk}/phone.webp`} alt="" fetchpriority="high" aria-hidden="true"/>
      ${started&&html`<video ref=${vidRef} key=${fk} className=${'hf-video hf-fade'+(shown&&!fading?' on':'')} src=${`f/${fk}/phone.mp4`} muted playsInline preload="metadata" aria-hidden="true" onLoadedMetadata=${seek} onPlaying=${()=>setShown(true)} onEnded=${ended} onError=${()=>setPaused(true)}></video>`}
      <div className="hf-scrim" aria-hidden="true"></div>
      <div className=${'hf-copy'+(fromShell&&chi===0?' still':'')}>
        <h1 key=${'h'+fk+chi}>${ch[0]}</h1>
        <p key=${'p'+fk+chi}>${ch[1].replace(/\s*Tap any piece\.$/,'')}</p>
        ${chi>=3&&html`<div className="hf-cta"><button className="hf-btn solid" onClick=${()=>{ids.forEach(id=>ctx.addToTray(id,1,null,true));ctx.toast(ids.length+' pieces added to '+ctx.activeProject.name,{label:'Open tray',fn:()=>ctx.setTray(true)})}}>Shop the room</button><button className="hf-btn" onClick=${()=>ctx.toStudio(ids,F.name)}>Open in Studio</button></div>`}
      </div>
      <div className="hf-prog" role="group" aria-label="Chapters">${F.ch.map((c,i)=>html`<button key=${i} className=${i===chi?'on':i<chi?'done':''} aria-label=${'Go to: '+c[0]} onClick=${()=>toChap(i)}><i></i></button>`)}</div>
      <button className="pf-play" aria-label=${paused?'Play the film':'Pause the film'} onClick=${togglePlay}>${paused?I('play',{width:18}):html`<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><rect x="4" y="3" width="3" height="12"/><rect x="11" y="3" width="3" height="12"/></svg>`}</button>
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
  const ar=cutWH(id);
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
  const live=useMemo(()=>{const q=mood.trim();if(!ctx.catalogComplete||q.length<3)return [];return matchPrompt(q).slice(0,3)},[mood,catalogGeneration,ctx.catalogComplete]);
  const moodPieces=live.map(p=>p.id);
  const compose=()=>{ctx.requestCatalog();if(!ctx.catalogComplete){ctx.toast('The catalog is still loading. Your description is preserved.');return}ctx.setStudioSeed({prompt:mood||'cognac leather and rattan for a café'});ctx.go('studio')};
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
                <form className="door-mood" onSubmit=${e=>{e.preventDefault();compose()}} onClick=${e=>e.stopPropagation()}><input aria-label="Describe a feeling" onFocus=${ctx.requestCatalog} value=${mood} onInput=${e=>{ctx.requestCatalog();setMood(e.target.value)}} placeholder="Cognac leather, low light, brass"/><button disabled=${!ctx.catalogComplete} title=${!ctx.catalogComplete?"Available when the catalog finishes loading":undefined} aria-label="Compose in Studio">${I('arrow',{width:16})}</button></form></div>
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
  const list=useMemo(()=>{let l=[...PRODUCTS];l.sort((a,b)=>(sp.picks.includes(b.id)?2:sp.mats.includes(b.mat)?1:0)-(sp.picks.includes(a.id)?2:sp.mats.includes(a.mat)?1:0));if(cat!=='all')l=l.filter(p=>p.type===cat);return l.slice(0,8)},[ctx.space,cat,catalogGeneration]);
  const saved=id=>ctx.boards.some(b=>b.pins.some(x=>x.pid===id));
  return html`<section className="lx lx-coll" ref=${ref}>
    <div className="lx-in">
      <header className="lx-h row" data-r style=${{'--i':0}}><div><h2>The collection</h2><p>Commercial-grade pieces, chosen for ${sp.label.toLowerCase()}s.</p></div>
        <div className="lx-tabs glass light" role="tablist">${[['all','All'],...Object.entries(TYPE)].map(([k,l])=>html`<button key=${k} role="tab" aria-selected=${cat===k} className=${cat===k?'on':''} onClick=${()=>{ctx.requestCatalog();setCat(k)}}>${l}</button>`)}</div>
      </header>
      <div className="lx-grid" key=${cat} aria-busy=${cat!=='all'&&!ctx.catalogComplete}>
        ${list.map((p,i)=>html`<article key=${p.id} className="lx-piece" data-r style=${{'--i':i%4+1}}>
          <button className=${"lx-stage"+([8,12].includes(p.id)?" hang":"")} onClick=${()=>ctx.openPin(p.id)} aria-label=${'View '+p.name+' '+p.line}>
            <span className="lx-cut"><img src=${cut(p.id)} alt="" loading="lazy" style=${{aspectRatio:cutWH(p.id).join('/')}}/></span><i className="lx-floor"></i>
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
      ${cat!=='all'&&!ctx.catalogComplete&&html`<p role="status">Loading the full collection for this category…</p>`}
      <div className="lx-more" data-r style=${{'--i':5}}><button className="btn btn-line" onClick=${()=>{ctx.setQuery(cat==='all'?'':cat);ctx.setImgQ(null);ctx.go('discover')}}>See all ${cat==='all'?(ctx.catalogComplete?PRODUCTS.length+' pieces':'pieces'):TYPE[cat].toLowerCase()} ${I('arrow',{width:15})}</button></div>
    </div>
  </section>`;
}


// Trade: the client quote, shown as the thing a designer actually sends. The controls drive a live demo.
function QuoteShow({ctx}){
  const ref=useLux();
  const [show,setShow]=useState('markup');const [mk,setMk]=useState(40);
  const pick=(n,i)=>PRODUCTS.find(p=>p.name===n)||PRODUCTS[i];
  const lines=useMemo(()=>[[pick('Roscoe',0),2],[pick('Ansel',1),4],[pick('Elara',2),3]].filter(([p])=>p),[catalogGeneration]);
  const set={show,markup:mk};const cost=lines.reduce((s,[p,q])=>s+(p.trade??p.price)*q,0);
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
  const [name,setName]=useState('');const [flip,setFlip]=useState(false);
  // card-local tilt so the light follows the cursor across the metal
  const tilt=e=>{const el=cardRef.current;if(!el)return;const r=el.getBoundingClientRect();el.style.setProperty('--tx',((e.clientX-r.left)/r.width*2-1).toFixed(3));el.style.setProperty('--ty',((e.clientY-r.top)/r.height*2-1).toFixed(3))};
  const rest=()=>{const el=cardRef.current;if(el){el.style.setProperty('--tx',0);el.style.setProperty('--ty',0)}};
  const pc=partnerCopy(ctx.me.partnerTier);
  const shown=(name.trim()||'Your studio').slice(0,26);
  const money=v=>'$'+Math.round(v).toLocaleString('en-US');
  return html`<section className="lx tc" ref=${ref} aria-label="Built for the trade">
    <div className="tc-spot" aria-hidden="true"></div>
    <div className="lx-in tc-grid">
      <div className="tc-copy">
        <header data-r style=${{'--i':0}}><h2>Built for the trade.</h2><p>One verified account opens approved prices on eligible pieces, eligible project pricing, and sourcing on request. Join the partner program to earn commission when people order through your links.</p></header>
        <label className="tc-engrave" data-r style=${{'--i':1}}><span>Preview your trade pass</span><input value=${name} maxLength="26" onInput=${e=>setName(e.target.value)} placeholder="Your studio name"/></label>
        <div className="tc-lens" data-r style=${{'--i':2}}>
          <${DeliveryCalculatorDisclosure}/>
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
            <span className="tc-meta"><span>Verified trade</span><span className="num">Approved pricing</span></span>
          </span>
          <span className="tc-face tc-back">
            <span className="tc-sheen" aria-hidden="true"></span>
            <span className="tc-strip" aria-hidden="true"></span>
            <span className="tc-benefits">
              <span><b className="foil">Trade</b>product-specific approved savings</span>
              <span><b className="foil">Projects</b>additional pricing where eligible</span>
              <span><b className="foil">${pc.commissionHeadline}</b>${pc.cardCommission}</span>
              <span><b className="foil">${pc.referralHeadline}</b>${pc.cardReferral}</span>
            </span>
            <span className="tc-meta"><span>Sourcing on request</span><span>Tax-exempt with a resale certificate</span></span>
          </span>
        </button>
        <i className="tc-floor" aria-hidden="true"></i>
        <span className="tc-hint">${flip?`${pc.referralFootnote} Tap to turn back.`:'Your digital trade pass. It appears in your account the moment you are approved. Nothing to print or mail.'}</span>
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
  return html`<${ProgressiveSections} sections=${[
    {id:'start',render:()=>html`<${StartRoom} ctx=${ctx}/>`},
    {id:'rooms',render:()=>html`<${RoomsWeLove} ctx=${ctx}/>`},
    {id:'collection',render:()=>html`<${Collection} ctx=${ctx}/>`},
    {id:'quotes',render:()=>html`<${QuoteShow} ctx=${ctx}/>`},
    {id:'trade',render:()=>html`<${TradeBand} ctx=${ctx}/>`},
    {id:'footer',render:()=>html`<${Footer} ctx=${ctx}/>`}
  ]}/>`;
}


function Footer({ctx}){
  return html`<footer className="wrap">
    <div><span className="logo"><b>House of Louie Mae</b></span><p className="mute" style=${{marginTop:10,maxWidth:'36ch',fontSize:14}}>The trade and partner floor of Louie Mae. Furniture for cafés, restaurants, bars, workspaces and model homes.</p>
      <${TradeNewsletter}/></div>
    <div><h2>Shop</h2>${['discover','studio','room','quiz'].map(r=>html`<button key=${r} onClick=${()=>ctx.go(r)}>${MENU.find(m=>m[0]===r)[1]}</button>`)}</div>
    <div><h2>Trade</h2><button onClick=${()=>ctx.go('trade')}>Apply</button><button onClick=${()=>ctx.go('hub')}>Your quotes</button><button onClick=${()=>ctx.setTray(true)}>Project tray</button></div>
    <div><h2>You</h2><button onClick=${()=>ctx.go('profile')}>Profile</button><button onClick=${()=>ctx.go('account')}>Account</button><a href="/privacy">Privacy & performance preferences</a></div>
  </footer>`;
}


/* ================= DISCOVER / SEARCH ================= */
function Discover({ctx}){
  return html`<${DiscoverCatalog} products=${PRODUCTS} pricing=${ctx.mode} query=${ctx.query} imageQuery=${ctx.imgQ} types=${TYPE} materials=${MAT} trends=${TRENDS.map(t=>({id:t.id,name:t.name,image:byId(t.img).img}))} matchQuery=${matchPrompt} onQuery=${ctx.setQuery} onClearImage=${()=>ctx.setImgQ(null)} onImage=${ctx.imageSearch} onTrend=${id=>{ctx.setTrend(id);ctx.go('trend')}} onSourcing=${()=>ctx.go('sourcing')} renderProducts=${(items,searching)=>html`<${Wall} items=${items} ctx=${ctx} density="normal" mixBoards=${searching?null:COMMUNITY}/>`}/>`;
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
const approxH=id=>Math.round(byId(id).dimsCm?.h??cmW(id)/(byId(id).cutAR||1));

const inch=cm=>Math.round(cm/2.54);

const CARE={
  leather:['Dust weekly with a dry, soft cloth.','Blot spills straight away; never rub.','Condition every 6 to 12 months.','Keep out of direct sun to slow fading.'],
  velvet:['Vacuum with a soft brush attachment.','Brush the pile in one direction to refresh it.','Blot spills, then let air dry.','Rotate cushions for even wear.'],
  boucle:['Vacuum gently with a brush attachment.','Snip loose loops; never pull them.','Spot clean with a mild solution, testing first.','Rotate cushions for even wear.'],
  rattan:['Dust with a soft brush.','Wipe with a damp cloth and let it dry fully.','Keep away from heaters and high humidity.'],
  brass:['Wipe with a soft dry cloth.','Avoid abrasive cleaners.','Buff fingerprints with microfiber.'],
};

const CAT_OF={sofa:'Seating',sectional:'Seating',bench:'Seating',ottoman:'Seating',chair:'Seating',stool:'Seating',table:'Tables',lighting:'Décor'};

// Project pricing on a project's trade subtotal: extra 3% over $10,000, extra 5% over $25,000. The server also holds every piece above its margin floor.
// Legacy tray previews do not promise project discounts; the approved basket calculator resolves them.
const PROJECT_TIERS=[];

const tierOf=t=>({rate:0,next:null});

const pct=r=>Math.round(r*100)+'%';

const tierLine=()=> 'Project pricing is confirmed for eligible items in your quote.';

function pairsFor(p,n=3){
  const want=p.type==='lighting'?['sofa','sectional','bench','ottoman']:p.type==='ottoman'?['sofa','sectional','bench','lighting']:['ottoman','lighting','bench'];
  const picked=[];want.forEach(t=>{const c=PRODUCTS.filter(x=>x.type===t&&x.id!==p.id&&!picked.includes(x)).sort((a,b)=>(a.mat===p.mat?-40:0)+cdist(a.tone,p.tone)-((b.mat===p.mat?-40:0)+cdist(b.tone,p.tone)))[0];if(c&&picked.length<n)picked.push(c)});
  return picked;
}


/* ================= MENU v4: a quiet side panel ================= */
// One column, read top to bottom: search, the four places to shop, your own things, then
// the few settings that matter (which business you're furnishing, trade pricing) and account
// links. Shortcuts that live on the pages themselves (piece types, studio starters, boards)
// are left to those pages.
const IX_MAIN=[['home','The Floor'],['discover','Discover'],['studio','Studio'],['room','Space Planner']];

const IX_MORE=[['boards','Boards'],['inspo','My Inspo'],['hub','Your quotes'],['sourcing','Sourcing'],['quiz','Style Quiz']];

// The piece that floats beside the panel on wide screens: [room photo behind it, cut-out piece].
const IX_PIECE={home:[2,2],discover:[7,7],studio:[13,13],room:[5,5],boards:[12,12],inspo:[4,4],hub:[17,17],sourcing:[9,9],quiz:[21,21]};

const IX_LABEL=Object.fromEntries([...IX_MAIN,...IX_MORE]);

/** Present destination links in a modal menu with local arrow navigation and shared focus restoration. */
function IndexMenu({ctx}){
  const [q,setQ]=useState('');const [spaces,setSpaces]=useState(false);const panel=useRef();
  // Which link the floating piece is showing: the hovered or focused one, else the current page.
  const [hi,setHi]=useState(IX_PIECE[ctx.route]?ctx.route:'home');
  const [bg,piece]=IX_PIECE[hi];
  const show=r=>({onMouseEnter:()=>setHi(r),onFocus:()=>setHi(r)});
  const close=()=>ctx.setMenu(false);const run=fn=>{close();fn()};
  const menuKeys=e=>{
    if(e.key!=='ArrowDown'&&e.key!=='ArrowUp')return;
    const links=[...(panel.current?.querySelectorAll('.ix-main a,.ix-more a')||[])];const i=links.indexOf(document.activeElement);
    if(i<0)return;e.preventDefault();links[(i+(e.key==='ArrowDown'?1:-1)+links.length)%links.length].focus();
  };
  const on=r=>ctx.route===r?'on':'';
  const sp=SPACES[ctx.space];
  const P=ctx.activeProject;const {resolved:items,missing:missingProjectItems}=resolveProjectItems(P.items,ctx.projectCatalog.products);
  const seats=items.reduce((s,i)=>s+i.p.seats*i.qty,0);const tot=items.reduce((s,i)=>s+pr(i.p,ctx.mode)*i.qty,0);
  return html`<${Modal} open=${true} label="Menu" onClose=${close} initialFocus=".ix-main a"><div className="ix">
    <div className="ix-scrim" onClick=${close}>
      <div className="ix-stage" aria-hidden="true">
        <img key=${'bg'+bg} className="ix-bgimg" src=${byId(bg).img} alt=""/>
        <img key=${'c'+piece} className="ix-cut" src=${cut(piece)} alt=""/>
        <div className="ix-shadow"></div>
        <div className="ix-cap"><b>${IX_LABEL[hi]}</b><span>${byId(piece).name} · ${byId(piece).line}</span></div>
      </div>
    </div>
    <div className="ix-panel" ref=${panel} onKeyDown=${menuKeys}>
      <div className="ix-top"><span className="logo"><b>House of Louie Mae</b></span><button className="ib" onClick=${close} aria-label="Close menu">${I('x')}</button></div>
      <div className="ix-body">
        <form className="ix-search" role="search" onSubmit=${e=>{e.preventDefault();run(()=>{ctx.setQuery(q);ctx.setImgQ(null);ctx.go('discover')})}}>${I('search',{width:17})}<input aria-label="Search the House" placeholder="Search pieces, materials, rooms" value=${q} onInput=${e=>setQ(e.target.value)}/></form>
        <nav className="ix-main" aria-label="Shop">${IX_MAIN.map(([r,l])=>html`<a key=${r} href=${'#'+r} ...${show(r)} className=${on(r)} aria-current=${ctx.route===r?'page':undefined} onClick=${e=>navigatePlainLink(e,r,()=>run(()=>ctx.go(r)))}>${l}</a>`)}</nav>
        <nav className="ix-more" aria-label="Your work">${IX_MORE.map(([r,l])=>html`<a key=${r} href=${'#'+r} ...${show(r)} className=${on(r)} aria-current=${ctx.route===r?'page':undefined} onClick=${e=>navigatePlainLink(e,r,()=>run(()=>ctx.go(r)))}>${l}</a>`)}</nav>
        <button className="ix-proj" onClick=${()=>run(()=>ctx.setTray(true))}>
          <span className="ix-proj-h"><span>Active project</span><b>${P.name}</b></span>
          ${items.length>0&&html`<span className="ix-thumbs">${items.slice(0,5).map(i=>html`<span key=${projectItemKey(i)} style=${{backgroundImage:`url(${i.p.cutout||i.p.img})`}}></span>`)}</span>`}
          <span className="ix-meter"><i style=${{width:Math.min(100,seats/P.target*100)+'%'}}></i></span>
          <span className="ix-proj-f"><span>${seats} of ${P.target} seats</span><span className="num">${missingProjectItems.length?ctx.projectReview:fmt(tot)}</span></span>
        </button>
        <div className="ix-set">
          <button className="ix-row" aria-expanded=${spaces} onClick=${()=>setSpaces(!spaces)}><span>Furnishing</span><span className="ix-val"><i style=${{background:sp.accent}}></i>${sp.label} ${I('down',{width:14,style:{transform:spaces?'rotate(180deg)':''}})}</span></button>
          ${spaces&&html`<div className="ix-chips" role="group" aria-label="Furnishing">${SPACE_KEYS.map(k=>html`<button key=${k} className=${k===ctx.space?'on':''} aria-pressed=${k===ctx.space} onClick=${()=>{ctx.setSpace(k);setSpaces(false)}}>${SPACES[k].label}</button>`)}</div>`}
          ${ctx.me.verified
            ?html`<div className="ix-row"><button className="ix-acctlink" onClick=${()=>run(()=>ctx.go('trade'))}><b>Trade account</b><small>Verified · show prices as</small></button><div className="ix-seg" role="group" aria-label="Show prices as"><button className=${ctx.mode==='trade'?'on':''} onClick=${()=>ctx.setMode('trade')}>Trade</button><button className=${ctx.mode==='retail'?'on':''} onClick=${()=>ctx.setMode('retail')}>Retail</button></div></div>`
            :html`<button className="ix-row ix-trade" onClick=${()=>run(()=>ctx.go('trade'))}><span><b>${ctx.me.tradeStatus==='pending'?'Trade application in review':'Apply for trade pricing'}</b><small>25% off retail for verified businesses</small></span>${I('arrow',{width:14})}</button>`}
        </div>
        <a className="ix-retail" href="https://www.louiemae.com" title="Louie Mae, our retail site for your home">Shopping for your home? Louie Mae retail ${I('arrow',{width:13})}</a>
        ${ctx.recent.length>0&&html`<div className="ix-recent"><span>Recently viewed</span><div>${ctx.recent.slice(0,4).map(id=>html`<button key=${id} onClick=${()=>{close();ctx.openPin(id)}} title=${byId(id).name} aria-label=${byId(id).name}><img src=${cut(id)} alt=""/></button>`)}</div></div>`}
      </div>
      <div className="ix-foot">
        <span className="ix-acct">${ctx.me.signedIn
          ?html`<button onClick=${()=>run(()=>ctx.go('profile'))}>Profile</button><button onClick=${()=>run(()=>ctx.go('account'))}>Account</button><button onClick=${()=>run(ctx.signOut)}>Log out</button>`
          :html`<button onClick=${()=>run(()=>ctx.go('welcome'))}>Sign in</button><button onClick=${()=>run(()=>ctx.go('account'))}>Account</button>`}</span>
      </div>
    </div>
  </div><//>`;
}


/* ================= PRODUCT PAGE v3 ================= */
/** Keep product actions and image navigation inside the active modal; hidden sticky actions remain inert. */
function PinDetail({ctx}){
  const p=ctx.detailProduct;const idx=PRODUCTS.findIndex(x=>x.id===p.id);
  const [view,setView]=useState('studio');const [bd,setBd]=useState('#ECE3D5');const [scale,setScale]=useState(false);
  const [qty,setQty]=useState(p.minimum||1);const [proj,setProj]=useState(ctx.tray.active);const [zone,setZone]=useState('');
  const [save,setSave]=useState(null);const [open,setOpen]=useState('details');
  const [simF,setSimF]=useState('tone');const [bundle,setBundle]=useState([]);const [mini,setMini]=useState(false);const [loupe,setLoupe]=useState(null);const [tilt,setTilt]=useState([0,0]);
  
  const scRef=useRef(),addRef=useRef(),stageRef=useRef();
  const P=ctx.tray.projects.find(x=>x.id===proj)||ctx.tray.projects[0];const Z=zone||P.zones[0];
  const pairs=useMemo(()=>pairsFor(p,3),[p.id,catalogGeneration]);
  useEffect(()=>{setQty(p.minimum||1);setBundle(pairs.map(x=>x.id));setView('studio');setScale(false);scRef.current&&scRef.current.scrollTo(0,0)},[p.id]);
  const productKeys=e=>{if(idx<0||!PRODUCTS.length||['INPUT','TEXTAREA','SELECT'].includes(e.target?.tagName))return;if(e.key==='ArrowRight')ctx.openPin(PRODUCTS[(idx+1)%PRODUCTS.length].id);if(e.key==='ArrowLeft')ctx.openPin(PRODUCTS[(idx-1+PRODUCTS.length)%PRODUCTS.length].id)};
  useEffect(()=>{const el=addRef.current,root=scRef.current;if(!el||!root)return;const io=new IntersectionObserver(([e])=>setMini(!e.isIntersecting&&e.boundingClientRect.top<0),{root});io.observe(el);return()=>io.disconnect()},[p.id]);
  const liked=ctx.likes.includes(p.id);const unit=pr(p,ctx.mode);
  const sim=PRODUCTS.filter(x=>x.id!==p.id).filter(x=>simF==='mat'?x.mat===p.mat:simF==='type'?x.type===p.type:true).sort((a,b)=>simF==='tone'?cdist(a.tone,p.tone)-cdist(b.tone,p.tone):0).slice(0,8);
  const onBoards=[...ctx.boards.filter(b=>b.pins.some(x=>sameProjectSelection(x,{pid:p.id,lid:p.lid,vid:p.vid}))).map(b=>({t:b.title,by:'You'})),...COMMUNITY.filter(b=>b.items.includes(p.id)).map(b=>({t:b.title,by:b.by}))];
  const room=ROOMS[ctx.space];const F=texture(room.floor);const L=texture('lime');
  const cm=p.dimsCm?.w??p.widthCm??100,hcm=Math.round(p.dimsCm?.h??cm/(p.cutAR||1));
  const projectSelection=resolveProjectItems(P.items,ctx.projectCatalog.products);const projTrade=projectSelection.missing.length?NaN:projectSelection.resolved.reduce((s,i)=>s+tp(i.p)*i.qty,0);const after=projTrade+tp(p)*qty;
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
  return html`<${Modal} open=${true} label=${p.name+' '+p.line} onClose=${()=>ctx.openPin(null)}><div className="pp" ref=${scRef} onKeyDown=${productKeys}>
    <header className="pp-bar">
      <button className="pp-back" aria-label="Back to the floor" onClick=${()=>ctx.openPin(null)}>${I('back',{width:16})} <span className="hide-sm">Back to the floor</span></button>
      <span className="pp-crumb mono hide-sm">${CAT_OF[p.type]} / ${TYPE[p.type]} / ${p.name}</span>
      <span className="row" style=${{gap:4}}>
        <button className="ib" disabled=${idx<0||!PRODUCTS.length} aria-label="Previous piece" title="Previous (←)" onClick=${()=>ctx.openPin(PRODUCTS[(idx-1+PRODUCTS.length)%PRODUCTS.length].id)}>${I('back')}</button>
        <span className="mono ix-dim num">${idx<0?'Saved product':String(idx+1).padStart(2,'0')+' / '+PRODUCTS.length}</span>
        <button className="ib" disabled=${idx<0||!PRODUCTS.length} aria-label="Next piece" title="Next (→)" onClick=${()=>ctx.openPin(PRODUCTS[(idx+1)%PRODUCTS.length].id)}>${I('arrow')}</button>
        <button className="ib" aria-label="Close" onClick=${()=>ctx.openPin(null)}>${I('x')}</button>
      </span>
    </header>
    <div className="pp-grid">
      <section className="pp-stage" ref=${stageRef}>
        <div className="pp-views" role="group" aria-label="Product image view">${[['studio','Studio'],['room','In a '+SPACES[ctx.space].label.toLowerCase()],['photo','Photo & detail']].map(([k,l])=>html`<button key=${k} aria-pressed=${view===k} className=${view===k?'on':''} onClick=${()=>setView(k)}>${l}</button>`)}</div>
        ${view==='studio'&&html`<div className="pp-set" style=${{background:`radial-gradient(ellipse 80% 70% at 50% 42%, color-mix(in srgb, ${bd} 70%, #fff), ${bd})`}} onPointerMove=${onTilt} onPointerLeave=${()=>setTilt([0,0])}>
          <div className="pp-floorline" style=${{background:`linear-gradient(180deg, transparent, color-mix(in srgb, ${bd} 80%, #000) )`}}></div>
          <div className="pp-obj" style=${{width:p.type==='lighting'?'34%':['sofa','sectional'].includes(p.type)?'78%':'56%',transform:`perspective(1200px) translateX(${scale&&cm>=120?-10:0}%) rotateY(${tilt[0]}deg) rotateX(${tilt[1]}deg)`}}>
            <${SafeImage} className="pp-cut" src=${p.cutout||p.img} media=${p.imageMedia} sizes="(min-width: 768px) 50vw, 100vw" alt=${p.name+' '+p.line}/>
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
          <div className="pp-obj inroom" style=${{width:p.type==='lighting'?'26%':['sofa','sectional'].includes(p.type)?'64%':'40%',top:p.type==='lighting'?'0':'auto'}}><img className="pp-cut" src=${p.cutout||p.img} alt=${p.name}/>${p.type!=='lighting'&&html`<span className="pp-contact"></span>`}</div>
          <span className="pp-roomcap mono">${SPACES[ctx.space].label} set · change the space from the header</span>
        </div>`}
        ${view==='photo'&&html`<div className="pp-set photo" onPointerMove=${onLoupe} onPointerLeave=${()=>setLoupe(null)}>
          <${SafeImage} src=${p.img} media=${p.imageMedia} sizes="(min-width: 768px) 60vw, 100vw" alt=${p.name}/>
          ${loupe&&html`<span className="pp-loupe" style=${{left:loupe.x,top:loupe.y,backgroundImage:`url(${p.img})`,backgroundSize:`${loupe.w*2.6}px ${loupe.h*2.6}px`,backgroundPosition:`${-loupe.x*2.6+90}px ${-loupe.y*2.6+90}px`}}></span>`}
          <span className="pp-roomcap mono">Move over the photo to see the ${MAT[p.mat].toLowerCase()} up close</span>
        </div>`}
      </section>

      <aside className="pp-panel">
        <span className="mono ix-dim">${p.sku} · ${TYPE[p.type].replace(/s$/,'')} · ${MAT[p.mat]}</span>
        <h1>${p.name}</h1><p className="pp-line">${p.line}</p>
        <div className="pp-price">
          <b className="num">${fmt(unit,true)}</b>
          ${ctx.mode==='trade'?(Number.isFinite(p.price)?html`<span className="mono">MSRP ${fmt(p.price,true)}</span><span className="save-pill">Trade · save ${fmt(p.price-unit)}</span>`:html`<span className="mono">Retail comparison unavailable</span>`):html`<button className="lnk" onClick=${()=>ctx.go('trade')}>${ctx.me.tradeStatus==='pending'?'Trade pricing unlocks after approval':'Trade price after verification'}</button>`}
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
            <div className="qty"><button onClick=${()=>setQty(Math.max(p.minimum||1,qty-(p.increment||1)))} aria-label="Fewer">−</button><span>${qty}</span><button onClick=${()=>setQty(qty+(p.increment||1))} aria-label="More">+</button></div>
            ${[2,4,8,12].filter(n=>n>=(p.minimum||1)&&(n-(p.minimum||1))%(p.increment||1)===0).map(n=>html`<button key=${n} className=${'chip'+(qty===n?' on':'')} onClick=${()=>setQty(n)}>×${n}</button>`)}
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
          <div className="pp-tier"><div className="ix-meter"><i style=${{width:'0%'}}></i></div><span>${tierLine(after,P.name)}</span></div>
          <div className="row pp-acts">
            <span style=${{position:'relative'}}><button className="btn btn-line btn-sm" aria-haspopup="dialog" aria-expanded=${Boolean(save)} onClick=${event=>setSave(save?null:event.currentTarget)}>${I('pin',{width:15})} Save</button>${save&&html`<${SaveMenu} ctx=${ctx} pid=${p.id} product=${p} align="left" onDone=${()=>setSave(null)} returnFocus=${save}/>`}</span>
            <button className="btn btn-line btn-sm" disabled=${!has(p.id)} title=${!has(p.id)?"Studio is unavailable for this saved product":undefined} onClick=${()=>ctx.toStudio([{pid:p.id,lid:p.lid,vid:p.vid}])}>${I('brush',{width:15})} Studio</button>
            <button className="btn btn-line btn-sm" disabled=${!p.dimsCm} title=${!p.dimsCm?"Measurements are needed for 3D planning":undefined} onClick=${()=>{ctx.setRoomSeed([{pid:p.id,lid:p.lid,vid:p.vid}]);ctx.openPin(null);ctx.go('room')}}>${I('cube',{width:15})} 3D</button>
            <button className="ib" aria-pressed=${liked} aria-label="Like" onClick=${()=>ctx.toggleLike(p.id)} style=${{color:liked?'var(--cognac)':''}}>${I('heart',liked?{fill:'currentColor'}:{})}</button>
            <button className="ib" aria-label="Copy link" onClick=${()=>copyText(pieceShareUrl(shareOrigin(),p.id,ctx.me.refCode,'link'),ctx.toast)}>${I('share')}</button>
            <a className="ib" aria-label="Save to Pinterest" href=${pinItUrl(p.img,p.name+' '+p.line+' · Louie Mae',pieceShareUrl(shareOrigin(),p.id,ctx.me.refCode,'pin'))} target="_blank" rel="noopener">${I('pint')}</a>
          </div>
        </div>

        <div className="pp-block pp-zip">
          <span className="pp-lbl">Delivering to</span>
          ${ctx.me.verified?html`<${DeliveryBoundary} key=${p.id}><${ProductDeliveryEstimate} productId=${p.lid} variantId=${p.vid} selectedPacks=${qty} channel="trade" disabledMessage="Add this item to your project to request confirmed delivery pricing. Delivery depends on the items, destination and service."/></>`:html`<p className="help">Sign in with an approved trade account for project delivery estimates. Retail purchases are available on Louie Mae.</p>`}
        </div>

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
        <div className="pp-bundle-sum"><span className="mono ix-dim">${bundle.length} pairing${bundle.length===1?'':'s'} selected</span><b className="num">${fmt(bundleTot)}</b><button className="btn btn-ink" disabled=${!bundle.length} onClick=${()=>{bundle.forEach(id=>ctx.addToProject(id,1,P.id,Z,null,true));ctx.toast(`${bundle.length} pairings added to ${P.name}`,{label:'Open tray',fn:()=>{ctx.openPin(null);ctx.setTray(true)}})}}>Add pairings to ${P.name}</button><button className="lnk" onClick=${()=>ctx.toStudio([{pid:p.id,lid:p.lid,vid:p.vid},...bundle],p.name+' look')}>Arrange them in Studio</button></div>
      </div>
    </section>

    <section className="pp-sec">
      <div className="sec-h"><h2>More like <em>this</em></h2><div className="row">${[['tone','Similar tone'],['mat','Same material'],['type','Same type']].map(([k,l])=>html`<button key=${k} className=${'chip'+(simF===k?' on':'')} onClick=${()=>setSimF(k)}>${l}</button>`)}</div></div>
      <${Wall} items=${sim} ctx=${ctx}/>
    </section>

    <div className=${'pp-mini'+(mini?' show':'')} inert=${!mini} aria-hidden=${!mini}>
      <img src=${cut(p.id)} alt=""/><span><b>${p.name}</b><small className="mono">${fmt(unit*qty)} · ${qty} × ${ctx.mode}</small></span>
      <button className="btn btn-cog" onClick=${()=>add()}>${I('tray',{width:16})} Add to ${P.name}</button>
    </div>
  </div><//>`;
}


/* ================= TRAY v3 ================= */
// Client quotes: the designer prices a project privately and shares one link. The server
// stores the quote and the link carries only a random code; the client sees sell prices only.
const qDate=d=>new Date(d).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});

const qSellOf=(p,set)=>set.show==='cost'?tp(p):set.show==='retail'?p.price:Math.round(tp(p)*(1+set.markup/100)*100)/100;

// The home page sample, built locally from real pieces.
function sampleQuote(space){
  const pick=(n,i)=>PRODUCTS.find(p=>p.name===n)||PRODUCTS[i];
  const lines=[[pick('Roscoe',0),2],[pick('Ansel',1),4],[pick('Elara',2),3]].filter(([p])=>p).map(([p,q],i)=>({key:'s'+i,name:p.name,line:p.line,img:cut(p.id),tone:p.tone,mat:p.mat,z:'Main dining',q,u:Math.round((p.trade??p.price)*1.4)}));
  const d=Date.now();
  return {x:true,ref:'Q-1042',by:'Studio Ama',studio:true,c:'Ama Owusu',t:'Fernwood Café',n:'Warm cognac leather and rattan light, chosen to wear in beautifully with daily service.',sp:space,d,until:d+30*864e5,dl:2400,dep:50,lt:'8 to 10 weeks',lines,approved:null,changed:false};
}

function fromServer(q){
  const lines=q.lines.map((l,i)=>{const p=PRODUCTS.find(x=>x.full===l.name);return {key:'l'+i,name:p?p.name:l.name.split(' ')[0],line:p?p.line:l.name.split(' ').slice(1).join(' '),img:p?cut(p.id):l.image,tone:p?p.tone:'#B07A4A',mat:p?p.mat:null,z:l.zone,q:l.quantity,u:l.unitSellCents/100}});
  return {x:false,ref:q.number,by:q.studioName||'House of Louie Mae',studio:!!q.studioName,c:q.clientName,t:q.title,n:q.note,sp:q.space,d:q.createdAt,until:q.validUntil,dl:q.deliveryCents==null?-1:q.deliveryCents/100,dep:q.depositBps/100,lt:q.leadTime,lines,approved:q.approval,changed:!!q.changeRequest};
}


/** Render the approval gate or quote editor as the topmost dialog without dismissing its parent tray. */
function QuoteComposer({ctx,onClose}){
  const proj=ctx.activeProject;const me=ctx.me;
  const create=useMutation(api.holm.createClientQuote);
  const [set,setSet]=useState(()=>({show:'markup',markup:40,brand:'studio',studio:me.businessName||'',email:me.email||'',client:'',note:'',valid:30,delivery:'',lead:'8 to 10 weeks',...load('qset',{}),title:proj.name}));
  const [busy,setBusy]=useState(false);const [link,setLink]=useState('');const feedback=useFormValidation();const formId=useId();const pending=useRef(false);
  const up=o=>{setSet(s=>({...s,...o}));setLink('');Object.keys(o).forEach(k=>feedback.clear(k));feedback.clear('_form');if(o.brand==='hol')feedback.clear('studio')};
  useEffect(()=>{const {show,markup,brand,studio,email,valid,lead}=set;store('qset',{show,markup,brand,studio,email,valid,lead})},[set]);
  const {resolved:items,missing:missingQuoteItems}=resolveProjectItems(proj.items,ctx.projectCatalog.products);const quoteErrors=projectLines(proj.items,ctx.projectCatalog.products).errors;
  const cost=items.reduce((s,i)=>s+tp(i.p)*i.qty,0);const sell=items.reduce((s,i)=>s+qSellOf(i.p,set)*i.qty,0);const profit=sell-cost;
  const errs={client:!set.client.trim()&&'Add who this is for',email:!set.email.trim()?'Add the email where approvals should go':!/^\S+@\S+\.\S+$/.test(set.email)&&'Check this email address',studio:set.brand==='studio'&&!set.studio.trim()&&'Add your studio name'};
  const ok=!errs.client&&!errs.email&&!errs.studio&&items.length>0&&!missingQuoteItems.length&&!quoteErrors.length;
  const make=async()=>{if(pending.current)return null;if(!ok){feedback.report({...Object.fromEntries(Object.entries(errs).filter(([,message])=>message)),...(!items.length?{_form:'Add at least one piece to the project.'}:{}),...(quoteErrors.length?{_form:quoteErrors.join(' ')}:{})});return null}feedback.reset();if(link)return link;pending.current=true;setBusy(true);
    try{const merged=[];items.forEach(i=>{const ex=merged.find(m=>m.productId===i.p.lid&&m.variantId===i.p.vid);if(ex)ex.quantity+=i.qty;else merged.push({productId:i.p.lid,variantId:i.p.vid,quantity:i.qty,zone:i.zone})});
      const slug=await create({show:set.show,markupBps:Math.round(set.markup*100),studioName:set.brand==='studio'?set.studio:undefined,replyEmail:set.email,clientName:set.client,title:set.title||proj.name,note:set.note,space:ctx.space,deliveryCents:set.delivery?Math.round(+set.delivery*100):undefined,leadTime:set.lead,validDays:set.valid,items:merged});
      const url=location.origin+'/trade#q/'+slug;setLink(url);return url}
    catch(e){feedback.report({_form:customerMessage(e)});return null}finally{pending.current=false;setBusy(false)}};
  const share=async()=>{const url=await make();if(url)copyText(url,ctx.toast)};
  const preview=async()=>{const url=await make();if(url){onClose();ctx.setTray(false);location.hash=url.split('#')[1]}};
  const F=(k,label,ph,type='text')=>html`<div className="qc-f"><label htmlFor=${formId+'-'+k}>${label}</label><input id=${formId+'-'+k} type=${type} value=${set[k]} placeholder=${ph} onInput=${e=>up({[k]:e.target.value})} aria-invalid=${!!feedback.errors[k]} aria-describedby=${feedback.errors[k]?formId+'-'+k+'-error':undefined}/>${feedback.errors[k]&&html`<em id=${formId+'-'+k+'-error'}>${feedback.errors[k]}</em>`}</div>`;
  if(!me.verified)return html`<${Modal} open=${true} label="Client quotes" onClose=${onClose}><div className="qc-scrim" onClick=${e=>e.target===e.currentTarget&&onClose()}><div className="qc" style=${{gridTemplateColumns:'1fr',maxWidth:560}}><button className="qc-x" aria-label="Close" onClick=${onClose}>${I('x')}</button><div className="qc-set"><h2>Client quotes</h2><p className="qc-sub">Client quotes are part of a verified trade account. Price a project at trade, add your markup, and send your client one link.</p><button className="btn btn-ink btn-lg" style=${{justifySelf:'start'}} onClick=${()=>{onClose();ctx.setTray(false);ctx.go('trade')}}>${me.signedIn&&me.tradeStatus==='pending'?'View your application':'Apply for trade'}</button></div></div></div><//>`;
  return html`<${Modal} open=${true} label="Create a client quote" onClose=${onClose}><div className="qc-scrim" onClick=${e=>e.target===e.currentTarget&&onClose()}>
    <div className="qc">
      <button className="qc-x" aria-label="Close" onClick=${onClose}>${I('x')}</button>
      <fieldset className="qc-set" disabled=${busy} style=${{border:0,minWidth:0}}><legend className="sr">Client quote details</legend>
        <h2>Client quote</h2>
        <div className="delivery-ui"><${ValidationSummary} summaryRef=${feedback.summaryRef} entries=${[{label:'Prepared for',fieldId:formId+'-client',message:feedback.errors.client},{label:'Send approvals to',fieldId:formId+'-email',message:feedback.errors.email},{label:'Studio name',fieldId:formId+'-studio',message:feedback.errors.studio},{message:feedback.errors._form}]}/></div>
        <p className="qc-sub">${proj.name} · ${items.reduce((s,i)=>s+i.qty,0)} pieces</p>
        <div className="qc-g">${F('client','Prepared for','Client name or business')}${F('title','Project title',proj.name)}</div>
        <div className="qc-block">
          <span className="qc-l">What your client sees</span>
          <div className="qc-seg" role="group" aria-label="Client pricing display">${[['cost','Your cost'],['markup','Marked up'],['retail','Retail']].map(([k,t])=>html`<button key=${k} className=${set.show===k?'on':''} aria-pressed=${set.show===k} onClick=${()=>up({show:k})}>${t}</button>`)}</div>
          ${set.show==='markup'&&html`<div className="qc-mk"><input className="lux-range qc-range" type="range" min="0" max="80" step="5" value=${set.markup} style=${{'--p':set.markup/80*100+'%'}} onInput=${e=>up({markup:+e.target.value})} aria-label="Markup on your trade cost"/><b className="num">${set.markup}%</b></div>`}
          <p className="qc-hint">${{cost:'Your trade price, passed through. Best when you bill a separate design fee.',markup:'Your margin is added to every piece. Your client only sees the final price.',retail:'Standard retail prices. You keep the full trade discount.'}[set.show]}</p>
        </div>
        <div className="qc-block">
          <span className="qc-l">Presented by</span>
          <div className="qc-seg" role="group" aria-label="Presented by">${[['studio','Your studio'],['hol','House of Louie Mae']].map(([k,t])=>html`<button key=${k} className=${set.brand===k?'on':''} aria-pressed=${set.brand===k} onClick=${()=>up({brand:k})}>${t}</button>`)}</div>
          <div className="qc-g">${set.brand==='studio'&&F('studio','Studio name','Your studio')}${F('email','Send approvals to','you@studio.com','email')}</div>
        </div>
        <div className="qc-g3">
          <label className="qc-f"><span>Delivery and install</span><input inputMode="numeric" value=${set.delivery} placeholder="Quoted later" onInput=${e=>up({delivery:e.target.value.replace(/[^\d]/g,'')})}/></label>
          <div className="qc-f"><span>Payment</span><b style=${{fontWeight:500}}>In full before delivery</b></div>
          <label className="qc-f"><span>Valid for</span><select value=${set.valid} onChange=${e=>up({valid:+e.target.value})}>${[14,30,60].map(v=>html`<option key=${v} value=${v}>${v} days</option>`)}</select></label>
        </div>
        <label className="qc-f"><span>A note to your client</span><textarea rows="3" value=${set.note} placeholder="A few words on the direction, finishes, or next steps" onInput=${e=>up({note:e.target.value})}></textarea></label>
      </fieldset>
      <div className="qc-side">
        <div className="qc-private">
          <span className="qc-l">${I('lock',{width:14})} Only you see this</span>
          <div className="qc-row"><span>Your trade cost</span><b className="num">${fmt(cost)}</b></div>
          <div className="qc-row"><span>Client pays for furniture</span><b className="num">${fmt(sell)}</b></div>
          <div className="qc-row qc-profit"><span>Your profit</span><b className="num">${fmt(profit)}${sell>0&&html`<small>${Math.round(profit/sell*100)}% margin</small>`}</b></div>
        </div>
        <div className="qc-mini" aria-hidden="true">
          <div className="qc-mini-hero" style=${{backgroundImage:`url(${stillFor(ctx.space)})`}}><i>${set.brand==='studio'?(set.studio||'Your studio'):'House of Louie Mae'}</i><b>${set.title||proj.name}</b></div>
          ${items.slice(0,4).map(i=>html`<div key=${projectItemKey(i)} className="qc-mini-line"><img src=${(i.p.cutout||i.p.img)} alt=""/><span>${i.p.name}</span><b className="num">${fmt(qSellOf(i.p,set)*i.qty)}</b></div>`)}
          ${items.length>4&&html`<div className="qc-mini-more">and ${items.length-4} more</div>`}
          <div className="qc-mini-tot"><span>Total</span><b className="num">${fmt(sell+(+set.delivery||0))}</b></div>
        </div>
        <button className="btn btn-ink btn-lg qc-cta" disabled=${busy} onClick=${share}>${I('link',{width:16})} ${busy?'Creating link…':link?'Copy client link again':'Copy client link'}</button>
        <button className="btn btn-line" disabled=${busy} onClick=${preview}>Preview as your client</button>
        ${link&&html`<div className="linkbox"><code>${link}</code></div>`}
        <p className="qc-fine">Prices are confirmed on our server. Your trade cost never appears on the client's page.</p>
      </div>
    </div>
  </div><//>`;
}

function ClientQuote({ctx,code}){
  const sample=code==='sample';
  const data=useQuery(api.holm.clientQuote,sample?'skip':{slug:code});
  const markViewed=useMutation(api.holm.markViewed);const approveM=useMutation(api.holm.approveClientQuote);const changeM=useMutation(api.holm.requestClientChanges);
  const [mode,setMode]=useState(null);const [name,setName]=useState('');const [agree,setAgree]=useState(false);const [msg,setMsg]=useState('');const [err,setErr]=useState('');const [busy,setBusy]=useState(false);const [local,setLocal]=useState(null);
  useEffect(()=>{if(!sample&&data)markViewed({slug:code}).catch(()=>{})},[sample,code,!!data]);
  const q=useMemo(()=>sample?sampleQuote(ctx.space):data?fromServer(data):null,[data,sample,ctx.space,catalogGeneration]);
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

/** Present project drafts and delivery steps in a modal; authoritative quote/checkout requests remain server-owned. */
function Tray({ctx,open=true}){
  const {tray,setTrayState}=ctx;const proj=tray.projects.find(p=>p.id===tray.active);
  const [step,setStep]=useState(0);const [view,setView]=useState('staged');const [tab,setTab]=useState('tray');
  const [newP,setNewP]=useState(false);const [pn,setPn]=useState('');const [drag,setDrag]=useState(null);const [over,setOver]=useState(null);
  const [qc,setQc]=useState(false);
  const [del,setDel]=useState(()=>{const d=load('del',{});return {when:'asap',date:'',recv:['white','threshold','dock'].includes(d.recv)?d.recv:'white',notes:'',teamNote:'',name:'',email:ctx.me.email||'',phone:'',business:ctx.me.businessName||'',line1:'',city:'',state:'',postal:''}});
  const [ref,setRef]=useState('');const [busy,setBusy]=useState(false);const feedback=useFormValidation();const pending=useRef(false);const stepHeading=useRef(null);const lastStep=useRef(step);useLayoutEffect(()=>{if(lastStep.current!==step){stepHeading.current?.focus();lastStep.current=step}},[step]);const tokRef=useRef(null);const requestQuote=useMutation(api.holm.requestQuote);
  // Store credit: pre-set from the Hub setting, changeable for this request.
  const credit=useQuery(api.holmCredit.myCredit,ctx.me.signedIn?{}:'skip');const [useCredit,setUseCredit]=useState(false);useEffect(()=>{if(credit)setUseCredit(credit.autoApply)},[credit?.autoApply]);
  // Replace old saved contact/address data with a non-personal service preference only.
  useEffect(()=>{store('del',{recv:del.recv})},[del.recv]);
  useEffect(()=>{setStep(0);feedback.reset()},[tray.active,feedback.reset]);
  const upd=fn=>setTrayState(t=>({...t,projects:t.projects.map(p=>p.id===t.active?fn(p):p)}));
  const {missing, resolved:items}=resolveProjectItems(proj.items,ctx.projectCatalog.products);
  const {resolved:later,missing:missingLater}=resolveProjectItems(tray.later||[],ctx.projectCatalog.products);
  const project=projectLines(proj.items,ctx.projectCatalog.products);const v2=items.some(i=>i.p.checkoutMode==='v2');
  const retail=items.reduce((s,i)=>s+i.p.price*i.qty,0);const trade=items.reduce((s,i)=>s+tp(i.p)*i.qty,0);const tier=tierOf(trade);const tierOn=!v2&&ctx.mode==='trade'&&tier.rate>0;const tierSave=tierOn?trade*tier.rate:0;
  const sub=(ctx.mode==='trade'?trade:retail)-tierSave;const seats=items.reduce((s,i)=>s+i.p.seats*i.qty,0);
  const palette=[];items.forEach(i=>{const w=i.p.price*i.qty;const f=palette.find(x=>cdist(x.c,i.p.tone)<20);f?f.w+=w:palette.push({c:i.p.tone,w})});
  const line=(i,fn)=>upd(p=>({...p,items:p.items.map(x=>sameSavedRow(x,i)?fn(x):x).filter(Boolean)}));
  const remove=i=>{const projectId=proj.id;const saved={pid:i.pid,lid:i.lid,vid:i.vid,qty:i.qty,zone:i.zone};line(i,()=>null);ctx.toast(`${i.p.name} removed`,{label:'Undo',fn:()=>setTrayState(t=>({...t,projects:restoreProjectItem(t.projects,projectId,saved)}))})};
  const saveLater=i=>{line(i,()=>null);setTrayState(t=>({...t,later:mergeProjectItem(t.later||[],{pid:i.pid,lid:i.lid||i.p?.lid,vid:i.vid||i.p?.vid,qty:i.qty})}));ctx.toast(`${i.p.name} saved for later`)};
  const restore=x=>{setTrayState(t=>({...t,later:(t.later||[]).filter(y=>!sameSavedRow(y,x)),projects:t.projects.map(p=>p.id===t.active?{...p,items:mergeProjectItem(p.items,{pid:x.pid,lid:x.lid||x.p.lid,vid:x.vid||x.p.vid,qty:x.qty,zone:p.zones[0]})}:p)}))};
  const moveTo=(i,z)=>{if(i.zone===z)return;upd(p=>{const rest=p.items.filter(x=>!sameSavedRow(x,i));const ex=rest.find(x=>sameProjectSelection(x,i)&&x.zone===z);return {...p,items:ex?rest.map(x=>x===ex?{...x,qty:x.qty+i.qty}:x):[...rest,{pid:i.pid,lid:i.lid||i.p?.lid,vid:i.vid||i.p?.vid,qty:i.qty,zone:z}]}})};
  const suggest=z=>{const zi=items.filter(i=>i.zone===z);if(!zi.length)return null;const have=new Set(items.map(i=>i.pid));const anchor=zi[0].p;return pairsFor(anchor,4).find(x=>!have.has(x.id))};
  const csv=()=>['Zone,Item,SKU,Material,Approx width (cm),Qty,Unit trade,Line trade,Status',...items.map(i=>[i.zone,`${i.p.name} ${i.p.line}`,i.p.sku,MAT[i.p.mat],(i.p.dimsCm?.w??i.p.widthCm??100),i.qty,tp(i.p).toFixed(2),(tp(i.p)*i.qty).toFixed(2),i.p.oos?'Restock check':'Ready to quote'].map(v=>`"${v}"`).join(','))].join('\n');
  const STEPS=['Tray','Delivery','Review','Requested'];
  const contactErrors=()=>({...(!del.name.trim()?{name:'Add a contact name for delivery.'}:{}),...(!/^\S+@\S+\.\S+$/.test(del.email)?{email:'Add a valid email for the quote.'}:{}),...Object.fromEntries(['line1','city','postal'].filter(k=>!del[k].trim()).map(k=>[k,'Complete this delivery address field.']))});
  const submit=async()=>{if(pending.current)return;if(project.errors.length||v2){feedback.report({_form:'Review the project items and use the delivery checkout below.'});return}const errors=contactErrors();if(Object.keys(errors).length){setStep(1);feedback.report(errors);return}pending.current=true;setBusy(true);feedback.reset();
    try{tokRef.current=tokRef.current||Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>'abcdefghijklmnopqrstuvwxyz0123456789'[b%36]).join('');
      const merged=[];items.forEach(i=>{const ex=merged.find(x=>x.productId===i.p.lid&&x.variantId===i.p.vid);if(ex)ex.quantity+=i.qty;else merged.push({productId:i.p.lid,variantId:i.p.vid,quantity:i.qty,zone:i.zone})});
      const r=await requestQuote({token:tokRef.current,projectName:proj.name,name:del.name.trim(),email:del.email.trim(),phone:del.phone.trim(),business:del.business.trim(),address:{line1:del.line1.trim(),city:del.city.trim(),state:del.state.trim(),postalCode:del.postal.trim(),country:'US'},timing:del.when,date:del.date,receiving:del.recv,notes:(del.teamNote+(del.notes?'\nAccess: '+del.notes:'')).trim(),website:'',items:merged,refCode:activeRef()?.code,visitorId:visitorId(),...(!v2&&useCredit&&credit?.balanceCents>0?{useCredit:true}:{})});
      tokRef.current=null;setRef(r.reference);setStep(3)}
    catch(e){feedback.report({_form:customerMessage(e)})}finally{pending.current=false;setBusy(false)}};
  const fld=(k,label,ph,type='text',auto)=>html`<div><label className="lbl" htmlFor=${'tv-'+k}>${label}</label><input id=${'tv-'+k} className="field" type=${type} autoComplete=${auto} value=${del[k]} placeholder=${ph} aria-invalid=${!!feedback.errors[k]} aria-describedby=${feedback.errors[k]?'tv-'+k+'-error':undefined} onInput=${e=>{setDel({...del,[k]:e.target.value});feedback.clear(k);feedback.clear('_form')}}/>${feedback.errors[k]&&html`<p id=${'tv-'+k+'-error'} className="delivery-error">${feedback.errors[k]}</p>`}</div>`;
  const strip=items.flatMap(i=>Array.from({length:Math.min(i.qty,3)},(_,k)=>({...i,k})));const stripCm=strip.reduce((s,i)=>s+(i.p.dimsCm?.w??i.p.widthCm??100)+30,0);
  return html`<${Modal} open=${open} label="Project tray" onClose=${()=>ctx.setTray(false)}><div className="tray-scrim" onClick=${()=>ctx.setTray(false)}></div>
  ${qc&&html`<${QuoteComposer} ctx=${ctx} onClose=${()=>setQc(false)}/>`}
  <section className="tv">
    <header className="tv-head">
      <div className="row" style=${{justifyContent:'space-between'}}>
        <h2 ref=${stepHeading} tabIndex="-1">Project tray · ${STEPS[step]}</h2>
        <button className="ib" aria-label="Close tray" onClick=${()=>ctx.setTray(false)}>${I('x')}</button>
      </div>
      <div className="ptabs" role="group" aria-label="Projects">${tray.projects.map(p=>html`<button key=${p.id} disabled=${busy} aria-pressed=${p.id===tray.active} className=${p.id===tray.active?'on':''} onClick=${()=>setTrayState(t=>({...t,active:p.id}))}>${p.name} <span className="mono ix-dim">${p.items.reduce((s,i)=>s+i.qty,0)}</span></button>`)}
        ${newP?html`<form className="row" onSubmit=${e=>{e.preventDefault();if(busy||!pn.trim())return;const id=uid();setTrayState(t=>({...t,active:id,projects:[...t.projects,{id,name:pn.trim(),target:20,zones:['Main room'],items:[]}]}));setPn('');setNewP(false)}}><input disabled=${busy} className="field" style=${{height:36,width:170}} autoFocus placeholder="Project name" aria-label="New project name" value=${pn} onInput=${e=>setPn(e.target.value)}/><button disabled=${busy} className="btn btn-ink btn-sm">Add</button></form>`:html`<button disabled=${busy} onClick=${()=>setNewP(true)}>+ New project</button>`}</div>
      <ol className="tv-steps">${STEPS.map((s,i)=>html`<li key=${s} className=${i===step?'on':i<step?'done':''}><button aria-current=${i===step?'step':undefined} disabled=${busy||i>step||step===3} onClick=${()=>setStep(i)}><i>${i<step?I('check',{width:12}):i+1}</i>${s}</button></li>`)}</ol>
    </header>

    <fieldset className="tv-body" disabled=${busy} style=${{border:0,padding:0,margin:0,minWidth:0}}><legend className="sr">Project contents and delivery request</legend>
      <div className="tv-main"><div className="delivery-ui"><${ValidationSummary} summaryRef=${feedback.summaryRef} entries=${Object.entries(feedback.errors).map(([key,message])=>({message,fieldId:key==='_form'?undefined:'tv-'+key,label:{name:'Site contact',email:'Email for the quote',line1:'Delivery address',city:'City',postal:'ZIP'}[key]}))}/></div>
      ${step===0&&html`
        <div className="tv-tools">
          <div className="seg"><button className=${tab==='tray'?'on':''} onClick=${()=>setTab('tray')}>In tray · ${items.reduce((s,i)=>s+i.qty,0)}</button><button className=${tab==='later'?'on':''} onClick=${()=>setTab('later')}>Saved for later · ${later.length+missingLater.length}</button></div>
          ${tab==='tray'&&html`<div className="seg"><button className=${view==='staged'?'on':''} onClick=${()=>setView('staged')}>Staged</button><button className=${view==='schedule'?'on':''} onClick=${()=>setView('schedule')}>Schedule</button></div>`}
        </div>
        ${tab==='later'&&(later.length? later.map(x=>html`<div key=${projectItemKey(x)} className="tv-line"><span className="tv-th" style=${{backgroundImage:`url(${(x.p.cutout||x.p.img)})`}}></span><div><b>${x.p.name}</b> <span className="mute">${x.p.line}</span><div className="meta">${x.qty} × · ${fmt(pr(x.p,ctx.mode))} each</div></div><button className="btn btn-line btn-sm" onClick=${()=>restore(x)}>Move to ${proj.name}</button></div>`):!missingLater.length&&html`<div className="empty"><h3>Nothing saved for later</h3><p>Use "Save for later" on any line to park it here without losing it.</p></div>`)}
        ${tab==='later'&&missingLater.map(i=>html`<div key=${i.pid+':'+(i.vid||'')} role="status"><p>${projectResolutionMessage(i,ctx.projectCatalog.states)}</p><button className="btn btn-line" onClick=${()=>setTrayState(t=>({...t,later:(t.later||[]).filter(x=>x!==i)}))}>Remove saved item</button></div>`)}
        ${tab==='tray'&&missing.map(i=>html`<div key=${projectItemKey(i)} role="alert"><p>${projectResolutionMessage(i,ctx.projectCatalog.states)}</p><button className="btn btn-line" onClick=${()=>line(i,()=>null)}>Remove saved item</button></div>`)}
        ${tab==='tray'&&!proj.items.length&&html`<div className="empty"><h3>This project is empty</h3><p>Add pieces from the floor, a product page, or a whole Studio collage at once.</p><button className="btn btn-ink" onClick=${()=>{ctx.setTray(false);ctx.go('discover')}}>Browse pieces</button></div>`}
        ${tab==='tray'&&items.length>0&&view==='staged'&&html`
          <div className="tv-stage" aria-label="Your tray, staged">
            <div className="tv-stage-in" style=${{width:`max(100%, ${stripCm*1.15}px)`}}>
              ${strip.map((i,n)=>html`<button key=${projectItemKey(i)+':'+i.k} className="tv-piece" style=${{width:(i.p.dimsCm?.w??i.p.widthCm??100)*1.15+'px',alignSelf:i.p.type==='lighting'?'flex-start':'flex-end'}} title=${i.p.name+' · '+i.zone} onClick=${()=>document.getElementById('ln-'+i.pid+i.zone.replace(/\W/g,''))?.scrollIntoView({behavior:'smooth',block:'center'})}><img src=${(i.p.cutout||i.p.img)} alt=${i.p.name}/>${i.p.type!=='lighting'&&html`<span></span>`}</button>`)}
            </div>
            <span className="tv-stage-cap mono">Your tray, staged · ${items.reduce((s,i)=>s+i.qty,0)} pieces · scroll sideways</span>
          </div>
          ${proj.zones.map(z=>{const zi=items.filter(i=>i.zone===z);const sg=suggest(z);return html`<div key=${z} className=${'tv-zone'+(over===z?' over':'')} onDragOver=${e=>{e.preventDefault();setOver(z)}} onDragLeave=${()=>setOver(null)} onDrop=${()=>{if(drag)moveTo(drag,z);setDrag(null);setOver(null)}}>
            <div className="zone-h"><h3>${z}</h3><span className="mono mute">${zi.length} pieces · ${zi.reduce((s,i)=>s+i.p.seats*i.qty,0)} seats${zi.length?'':' · drop pieces here'}</span></div>
            ${zi.map(i=>html`<div key=${projectItemKey(i)} id=${'ln-'+i.pid+z.replace(/\W/g,'')} className="tv-line" draggable="true" onDragStart=${()=>setDrag(i)} onDragEnd=${()=>setDrag(null)}>
              <button className="tv-th" style=${{backgroundImage:`url(${(i.p.cutout||i.p.img)})`}} aria-label=${'Open '+i.p.name} onClick=${()=>ctx.openPin(i.pid,{pid:i.pid,lid:i.p.lid,vid:i.p.vid})}></button>
              <div style=${{minWidth:0}}><b>${i.p.name}</b> <span className="mute">${i.p.line}</span>
                <div className="meta"><span className="row" style=${{gap:5}}><span className="dot" style=${{background:i.p.tone}}></span>${MAT[i.p.mat]}</span><span className="mono">${i.p.sku}</span>${i.p.oos?html`<span className="tv-status warn">Restock check</span>`:html`<span className="tv-status">Ready to quote</span>`}</div>
                <div className="meta"><button className="lnk" onClick=${()=>saveLater(i)}>Save for later</button><button className="lnk" onClick=${()=>remove(i)}>Remove</button><span className="mute hide-sm">Drag to another area</span></div></div>
              <div className="qty sm"><button aria-label="Fewer" onClick=${()=>line(i,x=>({...x,qty:Math.max(i.p.minimum,x.qty-i.p.increment)}))}>−</button><span>${i.qty}</span><button aria-label="More" onClick=${()=>line(i,x=>({...x,qty:x.qty+i.p.increment}))}>+</button></div>
              <div className="tot">${ctx.mode==='trade'?html`${fmt(tp(i.p)*i.qty)}<s>${fmt(i.p.price*i.qty)}</s>`:fmt(i.p.price*i.qty)}</div>
            </div>`)}
            ${sg&&html`<button className="tv-suggest" onClick=${()=>ctx.addToProject(sg.id,1,proj.id,z,null,true)}><img src=${cut(sg.id)} alt=""/><span><b>Complete the ${z.toLowerCase()}</b><small>Add ${sg.name} ${sg.line.toLowerCase()} · ${fmt(pr(sg,ctx.mode))}</small></span>${I('plus',{width:18})}</button>`}
          </div>`})}
          <button className="btn btn-line btn-sm" style=${{marginTop:16}} onClick=${()=>{const n='Area '+(proj.zones.length+1);upd(p=>({...p,zones:[...p.zones,n]}));ctx.toast(n+' added. Drag pieces into it.')}}>${I('plus',{width:15})} Add an area</button>`}
        ${tab==='tray'&&items.length>0&&view==='schedule'&&html`<div className="tv-sched" role="region" aria-label="Project schedule" tabIndex="0"><table className="t"><thead><tr><th>Item</th><th>Area</th><th>Material</th><th className="r">≈ W</th><th className="r">Qty</th><th className="r">Unit</th><th className="r">Line</th><th>Status</th></tr></thead><tbody>
            ${items.map(i=>html`<tr key=${projectItemKey(i)}><td><span className="row" style=${{gap:10}}><span className="tv-th sm" style=${{backgroundImage:`url(${(i.p.cutout||i.p.img)})`}}></span><span><b style=${{fontWeight:500}}>${i.p.name}</b><br/><span className="mono mute">${i.p.sku}</span></span></span></td><td>${i.zone}</td><td><span className="row" style=${{gap:6}}><span className="dot" style=${{background:i.p.tone}}></span>${MAT[i.p.mat]}</span></td><td className="r num">${(i.p.dimsCm?.w??i.p.widthCm??100)} cm</td><td className="r num">${i.qty}</td><td className="r num">${fmt(pr(i.p,ctx.mode))}</td><td className="r num">${fmt(pr(i.p,ctx.mode)*i.qty)}</td><td><span className=${'tv-status'+(i.p.oos?' warn':'')}>${i.p.oos?'Restock check':'Ready to quote'}</span></td></tr>`)}
          </tbody></table><div className="row" style=${{marginTop:12,flexWrap:'wrap'}}><button className="btn btn-line btn-sm" onClick=${()=>copyText(csv(),ctx.toast)}>${I('copy',{width:15})} Copy schedule as CSV</button><span className="help" style=${{margin:0}}>Paste into a spreadsheet or your procurement tool. Widths are planning estimates.</span></div></div>`}
      `}
      ${step===1&&html`<div className="tv-form">
        <h3 className="tv-h">Where it's going</h3>
        <div className="tv-card" style=${{display:'grid',gap:12}}><div className="g2f">${fld('name','Site contact','Full name','text','name')}${fld('phone','Phone','For delivery scheduling','tel','tel')}</div><div className="g2f">${fld('email','Email for the quote','you@business.com','email','email')}${fld('business','Business','Business name','text','organization')}</div>${fld('line1','Delivery address','Street address','text','street-address')}<div className="g3f" style=${{display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:10}}>${fld('city','City','','text','address-level2')}${fld('state','State','','text','address-level1')}${fld('postal','ZIP','','text','postal-code')}</div></div>
        <h3 className="tv-h">When</h3>
        <div className="tv-opts">${[['asap','As soon as ready','Ships when every piece is confirmed'],['date','Schedule a date','Hold delivery until opening week'],['split','Ship as available','Pieces arrive as each is ready']].map(([k,t,d])=>html`<button key=${k} aria-pressed=${del.when===k} className=${'modecard'+(del.when===k?' on':'')} onClick=${()=>setDel({...del,when:k})}><b>${t}</b><p>${d}</p></button>`)}</div>
        ${del.when==='date'&&html`<div style=${{maxWidth:260}}><label className="lbl" htmlFor="tv-date">Target delivery date</label><input id="tv-date" type="date" className="field" value=${del.date} onInput=${e=>setDel({...del,date:e.target.value})}/></div>`}
        <h3 className="tv-h">Requested delivery service</h3>
        <p className="help">Service availability, access requirements, charges and dates are confirmed in your final quote. Your selection is a request, not a booking.</p>
        <div className="tv-opts">${[['white','White glove','Placed in the room, packaging removed'],['threshold','Threshold','Delivered inside the first door'],['dock','Commercial dock','Booked to your receiving hours']].map(([k,t,d])=>html`<button key=${k} aria-pressed=${del.recv===k} className=${'modecard'+(del.recv===k?' on':'')} onClick=${()=>setDel({...del,recv:k})}><b>${t}</b><p>${d}</p></button>`)}</div>
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
        <ol className="tv-time">${[['Received','Just now'],['Availability check','Supplier stock and lead times'],['Final quote','After stock and delivery review'],['Approve & pay','Only after you approve'],['Delivery scheduled','Date confirmed with the carrier']].map(([t,d],i)=>html`<li key=${t} className=${i===0?'on':''}><i></i><b>${t}</b><span>${d}</span></li>`)}</ol>
        <p className="help">${SPLIT_MAY}</p>
        <div className="row" style=${{flexWrap:'wrap',justifyContent:'center'}}><button className="btn btn-ink" onClick=${()=>setQc(true)}>${I('link',{width:15})} Create client quote</button><button className="btn btn-line" onClick=${()=>{ctx.setTray(false);ctx.go('home')}}>Back to the floor</button></div>
      </div>`}
      </div>

      <aside className="tv-sum">
        <div><div className="row" style=${{justifyContent:'space-between'}}><span className="st-h">Seats covered</span><span className="mono num">${seats} / <input className="num" aria-label="Seat target" value=${proj.target} onInput=${e=>upd(p=>({...p,target:Math.max(1,+e.target.value||1)}))} style=${{width:42,border:0,borderBottom:'1px solid var(--line2)',background:'none',textAlign:'center'}}/></span></div>
          <div className="meter" style=${{marginTop:8}}><i style=${{width:Math.min(100,seats/proj.target*100)+'%'}}></i></div>
          <p className="help">${seats>=proj.target?'Every planned seat has a piece.':`${proj.target-seats} seats to go.`}</p></div>
        ${palette.length>0&&html`<div><span className="st-h">Material palette</span><div className="palette" style=${{marginTop:8}}>${palette.map(x=>html`<i key=${x.c} style=${{background:x.c,flex:x.w}}></i>`)}</div></div>`}
        ${!v2&&ctx.mode==='trade'&&html`<div className="tv-tier ${tierOn?'on':''}"><span className="st-h">Project pricing</span><div className="ix-meter"><i style=${{width:'0%'}}></i></div><p>${tierLine(trade)}</p></div>`}
        <div>
          <div className="sumrow"><span>Retail subtotal</span><span>${fmt(retail,true)}</span></div>
          ${ctx.mode==='trade'&&html`<div className="sumrow" style=${{color:'var(--ok)'}}><span>Trade savings</span><span>−${fmt(retail-trade,true)}</span></div>`}
          ${tierOn&&html`<div className="sumrow" style=${{color:'var(--ok)'}}><span>Project pricing · ${pct(tier.rate)}</span><span>−${fmt(tierSave,true)}</span></div>`}
          <div className="sumrow"><span>Delivery</span><span>On final quote</span></div>
          <div className="sumrow"><span>Sales tax</span><span>${tray.taxExempt?'Exempt':'On final quote'}</span></div>
          ${!v2&&credit?.balanceCents>0&&html`<label className="sumrow" style=${{cursor:'pointer'}}><span><input type="checkbox" checked=${useCredit} onChange=${e=>setUseCredit(e.target.checked)} style=${{marginRight:8}}/>Use my ${fmt(credit.balanceCents/100,true)} credit</span><span>${useCredit?'−'+fmt(Math.min(credit.balanceCents/100,sub),true):''}</span></label>`}
          <div className="sumrow total"><span>Merchandise estimate</span><span>${missing.length?ctx.projectReview:fmt(sub-(!v2&&useCredit&&credit?Math.min(credit.balanceCents/100,sub):0),true)}</span></div>
          <p className="help" style=${{marginTop:8}}>Excludes delivery and tax. We confirm your complete total before payment. ${SPLIT_MAY}</p>
        </div>
        ${!v2&&step<2&&html`<button className="btn btn-ink btn-lg" disabled=${!items.length||project.errors.length>0} onClick=${()=>{if(step===1){const errors=contactErrors();if(Object.keys(errors).length){feedback.report(errors);return}}feedback.reset();setStep(step+1)}}>${step===0?'Continue to delivery':'Review request'} ${I('arrow',{width:17})}</button>`}
        ${!v2&&step===2&&html`<button className="btn btn-cog btn-lg" disabled=${busy||project.errors.length>0} onClick=${submit}>${busy?'Sending…':'Request final quote'} ${I('arrow',{width:17})}</button>`}
        ${project.errors.map(message=>html`<p key=${message} role="alert" className="help">${message}</p>`)}
        ${v2&&project.errors.length===0&&html`<${DeliveryBoundary}><${ProjectDeliveryPanel} key=${JSON.stringify(project.lines)} lines=${project.lines} automatic=${items.every(i=>i.p.checkoutMode==='v2')} approved=${ctx.me.verified}/></>`}
        ${step>0&&step<3&&html`<button className="lnk" onClick=${()=>setStep(step-1)}>Back</button>`}
        ${!v2&&project.errors.length===0&&items.length>0&&html`<button className="tv-quote" onClick=${()=>setQc(true)}>${I('link',{width:17})}<span><b>Create a client quote</b><small>One link, your branding, your pricing</small></span>${I('arrow',{width:16})}</button>`}
        <div className="note">${I('pin',{width:18})}<span>We confirm availability, lead time and your final price before any payment.</span></div>
      </aside>
    </fieldset>
  </section><//>`;
}

const {hasCutout,cutoutAspect:cutAR,elementAspect:elAR,lockedWidth:lockW,width:wOf}=studioGeometry(BY_ID);

const nameOf=e=>e.kind==='img'?byId(e.pid).name:e.kind==='inspo'?'Inspo · '+e.title:e.kind==='text'?e.text:'Swatch';

// A saved board of pins has no layout of its own; exports lay its pieces out as cutouts in a grid.
const pinsDoc=(title,pids)=>({id:'pins',title,page:'portrait',shape:'rect',edge:'none',mode:'collage',bg:{color:'#EFE6D8'},els:[...pids.slice(0,6).map((pid,i)=>mkImg(pid,i,'collage',LAYOUTS[1],'cutout')),mkText(title,6,88,5.2)]});

async function uploadBlob(getUrl,blob){const url=await getUrl();const r=await fetch(url,{method:'POST',headers:{'Content-Type':blob.type||'application/octet-stream'},body:blob});if(!r.ok)throw new Error('The file did not upload. Try again.');return (await r.json()).storageId}

// A board someone shared by link: the board on top, then every piece with live prices.
function SharedBoard({ctx,slug}){
  const b=useQuery(api.holmSync.sharedBoard,{slug});const opened=useMutation(api.holmSync.boardOpened);const seen=useRef(false);
  const identities=(b?.items||b?.productIds?.map(productId=>({productId,qty:1}))||[]).map(i=>({pid:holmLegacyId(i.productId),lid:i.productId,vid:i.variantId||undefined,qty:i.qty||1}));
  const savedCatalog=useProjectCatalog([...identities,...(b?.doc?.els||[]).filter(e=>e.kind==='img')],BY_ID);
  const resolved=resolveProjectItems(identities,savedCatalog.products);
  const channel=new URLSearchParams(location.search).get('c')||'link';
  useEffect(()=>{if(!b||seen.current)return;seen.current=true;if(b.refCode)rememberRef(b.refCode,channel);opened({slug,channel,visitorId:visitorId()}).catch(()=>{})},[b]);
  if(b===undefined)return html`<main className="wrap"><p className="help" style=${{padding:'80px 0'}}>Opening the board…</p></main>`;
  if(!b)return html`<main className="wrap"><div className="empty" style=${{padding:'80px 0'}}><h3>This board link isn't complete</h3><p>Ask for the link again.</p><button className="btn btn-line" onClick=${()=>ctx.go('home')}>Visit House of Louie Mae</button></div></main>`;
  const shop=b.mode==='shop';const trade=ctx.mode==='trade';
  const lines=resolved.resolved.map(row=>({...row,requestedQty:row.qty,qty:editorOrderQuantity(row.qty,row.p)}));
  const buyable=lines.filter(l=>!l.p.oos);const total=buyable.reduce((s,l)=>s+pr(l.p,ctx.mode)*l.qty,0);
  const similar=p=>PRODUCTS.find(x=>x.type===p.type&&x.id!==p.id&&!x.oos);
  const addAll=()=>{buyable.forEach(l=>ctx.addToTray(l.p.id,l.qty,null,true,l.p));ctx.toast(`${buyable.reduce((s,l)=>s+l.qty,0)} pieces added to ${ctx.activeProject.name}`,{label:'Open tray',fn:()=>ctx.setTray(true)})};
  return html`<main className="wrap bundle" style=${{paddingBottom:60}}>
    <div className="bundle-head">
      <div className="bundle-board">${b.coverUrl?html`<img src=${b.coverUrl} alt=${b.title}/>`:b.doc?html`<${BoardPreview} els=${b.doc.els||[]} bg=${b.doc.bg||{color:'#EFE6D8'}} page=${b.doc.page} shape=${b.doc.shape} poly=${b.doc.poly} products=${savedCatalog.products}/>`:null}</div>
      <div className="bundle-sum"><span className="eyebrow">Shared by ${b.by}</span><h1>${b.title}</h1><p className="mute">${identities.length} piece${identities.length===1?'':'s'}</p>
        ${shop&&html`<div className="sumrow total"><span>${trade?'Trade':'Retail'} total</span><span className="num">${resolved.missing.length?'Checking saved items':fmt(total)}</span></div>
          <button className="btn btn-ink btn-lg" disabled=${!buyable.length||!!resolved.missing.length} onClick=${addAll}>${I('tray',{width:17})} ${trade?'Add to project':'Add all to cart'}</button>
          <p className="help">Prices are live. Delivery and tax are confirmed with your quote.</p>`}</div>
    </div>
    ${resolved.missing.map(item=>html`<p key=${projectItemKey(item)} role="status">${projectResolutionMessage(item,savedCatalog.states)}</p>`)}
    <div className="bundle-list">${lines.map(({p,qty,requestedQty})=>{const alt=p.oos&&similar(p);return html`<article key=${projectItemKey({pid:p.id,lid:p.lid,vid:p.vid})} className=${'bundle-row'+(p.oos?' oos':'')}>
      <button className="bundle-th" onClick=${()=>ctx.openPin(p.id,{pid:p.id,lid:p.lid,vid:p.vid})} aria-label=${'View '+p.name}><img src=${p.cutout||p.img} alt="" loading="lazy"/></button>
      <div className="bundle-t"><b>${p.name}</b><span>${p.line}${qty!==requestedQty?` · ${requestedQty} planned; supplier minimum/increment requires ${qty}`:""}</span>${dimsText(p)&&html`<small className="mute">${dimsText(p)}</small>`}
        ${p.oos&&html`<small className="bundle-oos">Sold out${alt?html` · try <button className="lnk" onClick=${()=>ctx.openPin(alt.id)}>${alt.name}</button>`:''}</small>`}</div>
      ${shop&&html`<span className="mono">× ${qty}</span><span className="num bundle-p">${fmt(pr(p,ctx.mode)*qty)}</span>
        <button className="ib" disabled=${p.oos} aria-label=${'Add '+p.name} onClick=${e=>ctx.addToTray(p.id,qty,e.currentTarget.closest('.bundle-row').querySelector('img'),false,p)}>${I('plus',{width:16})}</button>`}
    </article>`})}</div>
  </main>`;
}


/* ================= MY INSPO ================= */
/** Open uploaded inspiration through native controls while retaining separate Studio actions. */
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
    <button type="button" className=${'drop'+(drag?' on':'')} style=${{marginBottom:22}} onClick=${()=>fileRef.current.click()}>${I('upload',{width:22})}<span><b style=${{color:'var(--ink)',fontWeight:500}}>${busy?'Adding…':drag?'Drop to add':'Drop images anywhere on this page'}</b>, paste a screenshot, or click to choose files</span></button>
    ${list.length?html`<div className="wall">${list.map(x=>html`<div key=${x.id} className="pin"><div className="pin-img"><button className="pin-open" aria-label=${'View '+x.title} onClick=${()=>setOpen(x.id)}><img src=${x.src} alt=${x.title} style=${{aspectRatio:x.ar||1}}/></button>
        <div className="pin-ov"><div className="r1"><span className="pin-board"><span>${x.source==='pinterest'?'Pinterest':'Upload'}</span></span></div>
          <div className="r2"><span className="row" style=${{gap:4}}>${x.pal.slice(0,4).map(c=>html`<span key=${c} className="dot" style=${{width:16,height:16,background:c,boxShadow:'0 0 0 2px #fff'}}></span>`)}</span><button className="pin-act" aria-label="Mix in Studio" title="Mix in Studio" onClick=${e=>{e.stopPropagation();ctx.inspoToStudio(x)}}>${I('brush')}</button></div></div></div>
        <div className="pin-meta"><b>${x.title}</b></div></div>`)}</div>`
      :html`<div className="empty"><h2>Nothing here yet</h2><p>Upload a few photos or paste a screenshot to start.</p></div>`}
    ${O&&html`<${InspoDetail} ctx=${ctx} x=${O} onClose=${()=>setOpen(null)}/>`}
  </main>`;
}


/** Present the selected reference and matching pieces with modal containment and return focus. */
function InspoDetail({ctx,x,onClose}){
  const [t,setT]=useState(x.title);
  const sim=[...PRODUCTS].sort((a,b)=>Math.min(...x.pal.map(c=>cdist(c,a.tone)))-Math.min(...x.pal.map(c=>cdist(c,b.tone)))).slice(0,8);
  return html`<${Modal} open label=${x.title} onClose=${onClose}><div className="scrim" onClick=${e=>e.target===e.currentTarget&&onClose()}><div className="sheet">
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
  </div></div><//>`;
}

const { widthCm:plCm, dimensions:plDims, ready:plReady, extents:plExt, clamp:plClamp, collides:plHit, place:plPlace, reflow:plReflow }=plannerGeometry(BY_ID);



/* ================= BOARDS ================= */
/** Manage local board drafts and open board creation in a named, focus-contained dialog. */
function Boards({ctx}){
  const [tab,setTab]=useState('boards');const [sort,setSort]=useState('recent');const [mk,setMk]=useState(false);const [n,setN]=useState('');const [sec,setSec]=useState(false);
  let bs=[...ctx.boards];if(sort==='az')bs.sort((a,b)=>a.title.localeCompare(b.title));else bs.sort((a,b)=>b.t-a.t);
  const savedCatalog=useSavedBoardShelf(ctx.boards,ctx.collages,BY_ID);
  const {productFor,allPins,reviewCount}=savedCatalog;
  ctx={...ctx,savedProducts:savedCatalog.products};
  return html`<main className="wrap">
    <div className="ph-head"><div><span className="eyebrow">Your saved ideas</span><h1>Boards & <em>collages</em></h1></div>
      <div className="row" style=${{flexWrap:'wrap'}}><button className="btn btn-line" onClick=${()=>ctx.go('inspo')}>${I('img',{width:16})} My Inspo</button><button className="btn btn-line" onClick=${()=>ctx.go('profile')}>View profile</button><button className="btn btn-ink" onClick=${()=>setMk(true)}>${I('plus',{width:16})} Create</button></div></div>
    <div className="row" style=${{justifyContent:'space-between',flexWrap:'wrap',borderBottom:'1px solid var(--line)',marginBottom:24}}>
      <div className="tabs left" style=${{margin:0}}>${[['pins','Pins'],['boards','Boards'],['collages','Collages']].map(([k,l])=>html`<button key=${k} className=${tab===k?'on':''} onClick=${()=>setTab(k)}>${l}</button>`)}</div>
      ${tab==='boards'&&html`<label className="row" style=${{fontSize:13}}>Sort by <select className="field" style=${{height:34,width:'auto',borderRadius:999}} value=${sort} onChange=${e=>setSort(e.target.value)}><option value="recent">Last saved to</option><option value="az">A to Z</option></select></label>`}
    </div>
    ${tab==='boards'&&html`<div className="boards">
      ${bs.map(b=>html`<button key=${b.id} className="bcard" onClick=${()=>{ctx.setBoard(b.id);ctx.go('board')}}>
        <div className="cov">${[0,1,2].map(i=>html`<div key=${i} style=${{backgroundImage:b.pins[i]&&productFor(b.pins[i])?`url(${productFor(b.pins[i]).img})`:'none'}}></div>`)}</div>
        <h2>${b.title}</h2><p>${b.pins.length} pins${b.sections.length?` · ${b.sections.length} sections`:''}${b.secret?' · Secret':''}${b.collab?` · ${b.collab} collaborator${b.collab>1?'s':''}`:''}</p></button>`)}
      <button className="newboard" onClick=${()=>setMk(true)}><span>${I('plus',{width:22})}<br/>New board</span></button>
    </div>`}
    ${reviewCount>0&&html`<p role="status">${savedCatalog.pending?'Checking saved products…':savedCatalog.failed?'Some saved products could not be checked. Reload to try again.':'Some saved products need review.'} Your boards and collages are preserved.</p>`}
    ${tab==='pins'&&html`<${Wall} items=${allPins} ctx=${ctx}/>`}
    ${tab==='collages'&&html`<div className="boards">${ctx.collages.map((c,i)=>html`<button key=${i} className="bcard" onClick=${()=>{ctx.setStudioSeed({collage:c});ctx.go('studio')}}>
        <div className="cov" style=${{background:'var(--plaster)'}}>${c.els.filter(e=>e.kind==='img').slice(0,3).map((e,j)=>html`<div key=${j} style=${{backgroundImage:productFor(e)?`url(${productFor(e).img})`:'none'}}></div>`)}</div><h2>${c.title}</h2><p>${c.els.filter(e=>e.kind==='img').length} pieces · Open in Studio</p></button>`)}
      <button className="newboard" onClick=${()=>ctx.go('studio')}><span>${I('brush',{width:22})}<br/>New collage</span></button></div>`}
    ${mk&&html`<${Modal} open label="Create board" onClose=${()=>setMk(false)} initialFocus="#bn"><div className="scrim" onClick=${e=>e.target===e.currentTarget&&setMk(false)}><form className="sheet share" onSubmit=${e=>{e.preventDefault();if(!n.trim())return;const id=ctx.createBoard(n.trim(),null,sec);setMk(false);setN('');ctx.setBoard(id);ctx.go('board')}}>
      <h2 style=${{fontSize:38}}>Create a board</h2>
      <div><label className="lbl" htmlFor="bn">Name</label><input id="bn" className="field" autoFocus placeholder="e.g. Harbor Street lobby" value=${n} onInput=${e=>setN(e.target.value)}/></div>
      <button type="button" className="toggle" onClick=${()=>setSec(!sec)}><span>Keep this board secret<br/><small className="mute">Only you and collaborators can see it.</small></span><span className=${'sw'+(sec?' on':'')}></span></button>
      <div className="row" style=${{justifyContent:'flex-end'}}><button type="button" className="btn btn-line" onClick=${()=>setMk(false)}>Cancel</button><button className="btn btn-ink">Create</button></div></form></div><//>`}
  </main>`;
}

function BoardDetail({ctx}){
  const b=ctx.boards.find(x=>x.id===ctx.board)||ctx.boards[0];
  const savedCatalog=useProjectCatalog(b?.pins||[],BY_ID);
  const productFor=identity=>resolveProjectProduct(identity,savedCatalog.products)||displayProduct(new Map(),identity.pid);
  ctx={...ctx,savedProducts:savedCatalog.products};
  const [tab,setTab]=useState('pins');const [secF,setSecF]=useState('all');const [org,setOrg]=useState(false);const [picked,setPicked]=useState([]);const [ns,setNs]=useState('');const [adding,setAdding]=useState(false);const [mat,setMat]=useState('all');const [share,setShare]=useState(false);
  if(!b)return html`<main className="wrap"><h1>Board unavailable</h1><p>This board no longer exists.</p><button className="btn btn-line" onClick=${()=>ctx.go('boards')}>Back to boards</button></main>`;
  const pins=b.pins.filter(p=>secF==='all'||p.sec===secF).map(identity=>({identity,key:projectItemKey(identity),p:productFor(identity)})).filter(row=>mat==='all'||row.p.mat===mat);
  const unavailable=b.pins.some(identity=>!productFor(identity).lid);
  return html`<main className="wrap">
    <div className="ph-head" style=${{alignItems:'flex-start'}}><div><button className="btn btn-line btn-sm" onClick=${()=>ctx.go('boards')}>${I('back',{width:15})} Boards</button>
      <h1 style=${{marginTop:18}}>${b.title}</h1><p className="mute" style=${{marginTop:8}}>${b.pins.length} pins · ${b.sections.length} sections${b.secret?' · Secret board':''}</p></div>
      <div className="row" style=${{flexWrap:'wrap'}}><button className="btn btn-line" onClick=${()=>ctx.toStudio(b.pins.slice(0,6).map(x=>({pid:x.pid,lid:x.lid,vid:x.vid})),b.title)}>${I('brush',{width:16})} Open in Studio</button><button className="btn btn-cog" onClick=${()=>setShare(true)}>${I('share',{width:16})} Share</button></div></div>
    ${[...savedCatalog.states.values()].some(row=>row.status!=='resolved')&&html`<div role="status" className="note">${savedCatalog.pending?'Checking saved products.':savedCatalog.preparing?'Saved products need verification.':savedCatalog.failed?'Saved products could not be checked. Reload to try again.':'Some saved products are unavailable or have conflicting identities.'} Your pins are preserved; unavailable pieces cannot be added to a project.</div>`}
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
      ${b.sections.map(s=>html`<button key=${s} className="btn btn-line btn-sm" disabled=${!picked.length} onClick=${()=>{ctx.updateBoard(b.id,x=>({...x,pins:x.pins.map(p=>picked.includes(projectItemKey(p))?{...p,sec:s}:p)}));ctx.toast(`Moved ${picked.length} to ${s}`);setPicked([])}}>Move to ${s}</button>`)}
      <button className="btn btn-line btn-sm" style=${{color:'var(--bad)'}} disabled=${!picked.length} onClick=${()=>{ctx.updateBoard(b.id,x=>({...x,pins:x.pins.filter(p=>!picked.includes(projectItemKey(p)))}));setPicked([])}}>Remove</button></div>`}
    ${tab==='shop'?html`<div className="g2" style=${{marginTop:22}}>
      <div>${b.pins.map(x=>{const p=productFor(x);return html`<div key=${projectItemKey(x)} className="line" style=${{gridTemplateColumns:'88px minmax(0,1fr) auto'}}><button className="th" style=${{backgroundImage:`url(${p.img})`}} onClick=${()=>ctx.openPin(p.id,{pid:x.pid,lid:x.lid,vid:x.vid})} aria-label=${'View '+p.name}></button><div><b>${p.name} <span className="mute" style=${{fontWeight:400}}>${p.line}</span></b><div className="meta">${x.sec||'No section'} · <span className="mono">${p.sku}</span></div></div><div className="row"><span className="mono">${fmt(pr(p,ctx.mode)*p.minimum)}${p.minimum>1?` / ${p.minimum} units`:""}</span><button className="ib" disabled=${!p.lid} aria-label=${'Add '+p.name+' to tray'} onClick=${e=>ctx.addToTray(p.id,p.minimum,e.currentTarget.closest('.line').querySelector('.th'),false,p)}>${I('plus')}</button></div></div>`})}</div>
      <div className="panel" style=${{alignSelf:'start',display:'grid',gap:12}}><h3>Shop the board</h3><div className="sumrow"><span>${b.pins.length} pieces</span><span>${unavailable?'Review saved items':fmt(b.pins.reduce((s,x)=>{const p=productFor(x);return s+pr(p,ctx.mode)*p.minimum},0))}</span></div><button className="btn btn-ink" disabled=${unavailable} onClick=${()=>{if(unavailable)return;b.pins.forEach(x=>{const p=productFor(x);ctx.addToTray(x.pid,p.minimum,null,true,p)});ctx.toast(`${b.pins.length} pieces added to ${ctx.activeProject.name}`,{label:'Open tray',fn:()=>ctx.setTray(true)})}}>Add all to tray</button><p className="help">Shared in shoppable mode, this tab is what your client sees, with your partner link attached.</p></div>
    </div>`:html`<div className=${org?'wall organize':'wall'}>${pins.map(({p,key})=>org?html`<button key=${key} className="pin" onClick=${()=>setPicked(picked.includes(key)?picked.filter(x=>x!==key):[...picked,key])} aria-pressed=${picked.includes(key)}><div className="pin-img" style=${{outline:picked.includes(key)?'3px solid var(--cognac)':'none',outlineOffset:2}}><img src=${p.img} alt=${p.name} style=${{aspectRatio:p.ar,opacity:picked.includes(key)?.75:1}}/>${picked.includes(key)&&html`<span className="oos" style=${{left:'auto',right:10,top:10,bottom:'auto',background:'var(--cognac)',color:'#fff'}}>Selected</span>`}</div><div className="pin-meta"><b>${p.name}</b></div></button>`:html`<${PinCard} key=${key} p=${p} ctx=${ctx}/>`)}</div>`}
    ${share&&html`<${ShareSheet} ctx=${ctx} title=${b.title} doc=${pinsDoc(b.title,b.pins)} selections=${b.pins} ids=${b.pins.map(x=>x.pid)} boardKey=${'pins-'+b.id} onClose=${()=>setShare(false)}/>`}
  </main>`;
}


/* ================= PROFILE ================= */
function Profile({ctx}){
  const me=ctx.me;const [tab,setTab]=useState('saved');
  const {productFor}=useSavedBoardShelf(ctx.boards,ctx.collages,BY_ID);
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
      ${tab==='saved'&&(ctx.boards.length?html`<div className="boards">${ctx.boards.map(b=>html`<button key=${b.id} className="bcard" onClick=${()=>{ctx.setBoard(b.id);ctx.go('board')}}><div className="cov">${[0,1,2].map(i=>html`<div key=${i} style=${{backgroundImage:b.pins[i]&&productFor(b.pins[i])?`url(${productFor(b.pins[i]).img})`:'none'}}></div>`)}</div><h2>${b.title}</h2><p>${b.pins.length} pins</p></button>`)}</div>`:html`<div className="empty"><h2>No boards yet</h2><p>Save pieces from the floor to start a board.</p></div>`)}
      ${tab==='collages'&&(ctx.collages.length?html`<div className="boards">${ctx.collages.map((c,i)=>html`<button key=${i} className="bcard" onClick=${()=>{ctx.setStudioSeed({collage:c});ctx.go('studio')}}><div className="cov">${c.els.filter(e=>e.kind==='img').slice(0,3).map((e,j)=>html`<div key=${j} style=${{backgroundImage:productFor(e)?`url(${productFor(e).img})`:'none'}}></div>`)}</div><h2>${c.title}</h2></button>`)}</div>`:html`<div className="empty"><h2>No collages yet</h2><p>Compose one in Studio and save it here.</p><button className="btn btn-line" onClick=${()=>ctx.go('studio')}>Open Studio</button></div>`)}
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
        <span className="tc-name foil">${name}</span><span className="tc-meta"><span>Verified ${since}</span><span className="num">Approved pricing</span></span></span>
    </div></div>`;
}

// Partner program panel on the "Your quotes" page.
const CHANNEL_NAMES=[['story','Instagram Story'],['pin','Pinterest'],['post','Social post'],['pdf','PDF'],['link','Link'],['share','Shared from a phone or email'],['qr','QR code']];

function PartnerPanel({ctx}){
  const ph=useQuery(api.holmPartners.hub,ctx.me.signedIn?{}:'skip');const join=useMutation(api.holmPartners.join);const w9Url=useMutation(api.holmPartners.w9UploadUrl);const submitW9=useMutation(api.holmPartners.submitW9);
  const [agree,setAgree]=useState(false);const [busy,setBusy]=useState(false);const [ch,setCh]=useState('link');const bs=useQuery(api.holmPartners.boardStats,ctx.me.signedIn?{}:'skip');const [target,setTarget]=useState('home');const w9Ref=useRef();
  if(!ctx.me.signedIn||ph===undefined)return null;
  if(!ph)return html`<section className="panel" style=${{marginBottom:24,display:'grid',gap:12}}><h3>Partner program</h3>
    <p className="help" style=${{margin:0}}>Share pieces and boards and earn commission on retail-priced orders placed through your links. ${partnerCopy().ratesLine}, rising with your sales. Trade-priced orders don't earn commission. You also earn ${partnerCopy().referralHeadline} in store ${partnerCopy().referralLine}.</p>
    <label className="cq-check"><input type="checkbox" checked=${agree} onChange=${e=>setAgree(e.target.checked)}/><span>I agree to the <a href="#partner-terms" target="_blank" rel="noopener">partner terms</a>, and I'll label posts that include my link, for example "#ad" or "I earn a commission".</span></label>
    <button className="btn btn-ink" style=${{justifySelf:'start'}} disabled=${!agree||busy} onClick=${async()=>{setBusy(true);try{await join({acceptTerms:true});ctx.toast('Welcome to the partner program')}catch(e){ctx.toast(errText(e))}finally{setBusy(false)}}}>Join the partner program</button></section>`;
  const base=location.origin+'/trade';const hash=target==='home'?'':target.startsWith('p:')?'#p/'+target.slice(2):'#'+target;
  const link=`${base}?ref=${ph.refCode}&ch=${ch}${hash}`;
  const money=c=>fmt(c/100,true);
  const status={signed_up:'Signed up',verified:'Verified, awaiting first order',credited:'Credit earned'};
  return html`<section style=${{display:'grid',gap:18,marginBottom:24}}>
    <div className="ph-head" style=${{margin:0}}><div><h2 style=${{fontSize:38}}>Partner Hub</h2><p className="mute">${partnerCopy(ph.tier).ratesLine}${ph.tierProgress?` · ${ph.tierProgress}`:''}</p><p className="help" style=${{margin:'4px 0 0'}}>Commission on each piece is capped at ${partnerCopy().profitCap} of our profit on it. ${partnerCopy().typesNote}</p></div></div>
    <div className="kpis">${[['Link visits · 30 days',ph.clicks30],['Quote requests',ph.quotes],['Orders',ph.orders],['Pending',money(ph.pendingCents)],['Cleared, ready to pay',money(ph.clearedCents)],['Paid',money(ph.paidCents)]].map(([l,v])=>html`<div key=${l} className="kpi"><span className="mono mute">${l}</span><div className="v">${v}</div></div>`)}</div>
    <div className="g2">
      <div className="panel" style=${{display:'grid',gap:10,alignContent:'start'}}><h3>Your link</h3>
        <div className="g2f" style=${{gap:8}}><select className="field" aria-label="Link to" value=${target} onChange=${e=>setTarget(e.target.value)}><option value="home">House of Louie Mae home</option><option value="discover">Discover</option><optgroup label="Pieces">${PRODUCTS.slice(0,60).map(p=>html`<option key=${p.id} value=${'p:'+p.id}>${p.name} ${p.line}</option>`)}</optgroup></select>
          <select className="field" aria-label="Channel" value=${ch} onChange=${e=>setCh(e.target.value)}>${CHANNEL_NAMES.map(([k,l])=>html`<option key=${k} value=${k}>${l}</option>`)}</select></div>
        <div className="linkbox"><code>${link}</code><button className="btn btn-ink btn-sm" onClick=${()=>copyText(link,ctx.toast)}>Copy</button></div>
        <div className="kv"><span className="mono mute">Code</span><b style=${{fontWeight:500}}>${ph.refCode}</b><span className="mono mute">Window</span><span>${partnerCopy().attributionDays} days from a visit through your link</span><span className="mono mute">Clearing</span><span>${partnerCopy().clearingDays} days after payment</span><span className="mono mute">Tax form</span><span>${ph.w9Status==='approved'?'W-9 approved':ph.w9Status==='pending'?'W-9 in review':html`<button className="lnk" onClick=${()=>w9Ref.current.click()}>Upload your W-9</button>`}</span></div>
        <input ref=${w9Ref} type="file" accept=".pdf,image/*" hidden onChange=${async e=>{const x=e.target.files[0];if(!x)return;try{const id=await uploadBlob(w9Url,x);await submitW9({fileId:id});ctx.toast('W-9 received')}catch(err){ctx.toast(errText(err))}}}/>
        <p className="help" style=${{margin:0}}>Add "I earn a commission" or #ad when you post. Orders you place yourself don't earn commission; your trade account is always the better price.</p></div>
      <div className="panel" style=${{display:'grid',gap:8,alignContent:'start'}}><h3>Referrals and credit</h3>
        ${ph.referrals.length?ph.referrals.map((r,i)=>html`<div key=${i} className="sumrow" style=${{borderBottom:'1px solid var(--line)',padding:'8px 0'}}><span>${r.name}<br/><small className="mute">${status[r.status]}</small></span><span>${r.creditCents?money(r.creditCents):''}</span></div>`):html`<p className="help" style=${{margin:0}}>Businesses who sign up through your link appear here.</p>`}
        <div className="sumrow total"><span>Store credit</span><span>${money(ph.creditCents)}</span></div>
        <${CreditToggle} ctx=${ctx}/>
        <${PayoutSetup} ctx=${ctx} ph=${ph}/>
        ${ph.payouts.length>0&&html`<h3 style=${{marginTop:10}}>Payouts</h3>${ph.payouts.map((x,i)=>html`<div key=${i} className="sumrow"><span>${new Date(x.paidAt).toLocaleDateString()}<br/><small className="mute">${x.reference}</small></span><span>${money(x.amountCents)}</span></div>`)}`}
      </div>
    </div>
    <div className="panel" style=${{display:'grid',gap:10}}><h3>Orders through your links</h3>
      ${ph.commissions.length?html`<div className="pstats" role="table" aria-label="Orders through your links"><div className="pstats-r head" role="row"><span>Order</span><span>From</span><span>Order total</span><span>Commission</span><span>Status</span></div>
        ${ph.commissions.map((c,i)=>html`<div key=${i} className="pstats-r" role="row"><span><b>${new Date(c.createdAt).toLocaleDateString()}</b><small className="mute">${c.lines.length?c.lines.map(l=>`${l.type==='decor'?'Décor':l.type[0].toUpperCase()+l.type.slice(1)} ${l.rateBps/100}%${l.capped?' (capped)':''}`).join(' · '):c.note||''}</small></span>
          <span>${c.source==='storefront_order'?'louiemae.com':c.source==='adjustment'?'Adjustment':'House quote'}${c.channel?html`<small className="mute">${(CHANNEL_NAMES.find(x=>x[0]===c.channel)||[c.channel,c.channel])[1]}${c.board?' · board':''}</small>`:''}</span>
          <span className="num">${c.baseCents?money(c.baseCents):''}</span><span className="num">${money(c.amountCents)}</span>
          <span>${{pending:`Pending · clears ${new Date(c.clearsAt).toLocaleDateString()}`,cleared:'Cleared',paid:'Paid',void:'Void'}[c.status]}</span></div>`)}</div>`
        :html`<p className="help" style=${{margin:0}}>Orders people place through your links show up here, with what you earned on each.</p>`}</div>
    ${bs&&bs.length>0&&html`<div className="panel" style=${{display:'grid',gap:10}}><h3>Your shared boards</h3>
      <div className="pstats" role="table" aria-label="Shared board stats"><div className="pstats-r head" role="row"><span>Board</span><span>Views</span><span>Visits by channel</span><span>Orders</span><span>Commission</span></div>
        ${bs.map(x=>html`<div key=${x.slug} className="pstats-r" role="row"><span><b>${x.title}</b><small className="mute">${x.mode==='shop'?'Shoppable':'Presentation'} · <button className="lnk" onClick=${()=>copyText(bundleUrl(x.slug,'link'),ctx.toast)}>Copy link</button></small></span>
          <span className="num">${x.views}</span><span>${Object.keys(x.byChannel).length?Object.entries(x.byChannel).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${(CHANNEL_NAMES.find(c=>c[0]===k)||[k,k])[1]} ${n}`).join(' · '):html`<span className="mute">None yet</span>`}</span>
          <span className="num">${x.orders}</span><span className="num">${money(x.commissionCents)}</span></div>`)}</div></div>`}
    <p className="help" style=${{margin:0}}><a href="#partner-terms">Partner terms</a> · Share any louiemae.com page from the <a href="/#creators">Creator Hub</a>.</p>
  </section>`;
}

/** Present trade account and quote states under a primary page heading. */
export function Hub({ctx}){
  const me=ctx.me;
  const args=me.signedIn?{}:'skip';
  const quotesQuery=useRecoverableQuery(api.holm.myQuoteRequests,args), clientQuery=useRecoverableQuery(api.holm.myClientQuotes,args), applicationQuery=useRecoverableQuery(api.holm.myApplication,args), flagsQuery=useRecoverableQuery(api.v2Admin.publicFlags,args);
  const reads=[quotesQuery,clientQuery,applicationQuery,flagsQuery];
  const quotes=quotesQuery.data||[],cqs=clientQuery.data||[],app=applicationQuery.data,v2=flagsQuery.data;
  if(!me.signedIn)return html`<main className="wrap"><div className="empty" style=${{padding:'80px 0'}}><h1>Sign in to see your quotes</h1><p>Quote requests, client quote links and your trade pass live here.</p><button className="btn btn-ink" onClick=${()=>ctx.go('welcome')}>Sign in</button></div></main>`;
  if(reads.some(q=>q.status==='unavailable'))return html`<main className="wrap"><h1>Trade Hub</h1><section role="alert"><p>Your quotes and membership details are temporarily unavailable. Your saved records are unchanged.</p><button className="btn btn-line" onClick=${()=>reads.forEach(q=>q.retry())}>Try Hub again</button></section></main>`;
  if(reads.some(q=>q.status!=='ready'))return html`<main className="wrap" aria-busy="true"><h1>Trade Hub</h1><p role="status">Loading your quotes and membership…</p></main>`;
  const status={requested:'Requested',quoted:'Quote ready',accepted:'Accepted',invoiced:'Invoiced',paid:'Paid',fulfilled:'Delivered',cancelled:'Cancelled'};
  const cqStatus={sent:'Sent',viewed:'Viewed',approved:'Approved',changes_requested:'Changes requested'};
  return html`<main className="wrap"><h1 className="sr">Trade Hub</h1>
    ${me.verified?html`<section className="tp-row"><${TradePass} name=${me.businessName||me.displayName} since="trade"/><div className="tp-copy"><h2>Your trade pass</h2><p>Created automatically when your trade account was approved. Approved prices and eligible project savings are shown before ordering. Product eligibility, minimum prices and supplier restrictions apply.</p></div></section>`
    :html`<section className="panel" style=${{margin:'40px 0 18px',display:'grid',gap:10}}><h2 style=${{fontSize:34}}>${app?.status==='pending'?'Your trade application is in review':app?.status==='needs_info'?'We need a little more information':'Trade pricing for businesses'}</h2><p className="mute">${app?.status==='pending'?`We're checking ${app.businessName}. Most applications are reviewed within one business day, and trade prices appear here as soon as you're approved.`:app?.status==='needs_info'?(app.reviewNote||'Check your email for what we need.'):'Verified trade accounts see approved prices on eligible pieces, qualifying project savings and client quotes.'}</p>${app?.status!=='pending'&&html`<button className="btn btn-ink" style=${{justifySelf:'start'}} onClick=${()=>ctx.go('trade')}>Apply for trade</button>`}</section>`}
    <div className="g2" style=${{margin:'18px 0 60px'}}>
      <div className="panel"><h3>Quote requests</h3>
        ${quotes.length?html`<table className="t" style=${{marginTop:8}}><thead><tr><th>Reference</th><th>Project</th><th className="r">Subtotal</th><th>Status</th></tr></thead><tbody>${quotes.map(r=>html`<tr key=${r.reference}><td className="mono">${r.reference}</td><td>${r.projectName}</td><td className="r num">${fmt(r.subtotal/100)}</td><td>${r.invoiceUrl?html`<a href=${r.invoiceUrl} target="_blank" rel="noopener">${status[r.status]||r.status}</a>`:(status[r.status]||r.status)}</td></tr>`)}</tbody></table>`
        :html`<p className="help">No quote requests yet. Fill a project in your tray and request a final quote.</p>`}</div>
      <div className="panel"><h3>Client quotes</h3>
        ${cqs.length?html`<div style=${{display:'grid',gap:2,marginTop:8}}>${cqs.map(q=>html`<div key=${q.slug} className="sumrow" style=${{borderBottom:'1px solid var(--line)',padding:'10px 0'}}><span>${q.title}<br/><small className="mute">${q.number} · ${q.clientName} · ${cqStatus[q.status]}${q.approval?` by ${q.approval.name}`:''}</small></span><span className="row" style=${{gap:6}}><button className="btn btn-line btn-sm" onClick=${()=>copyText(location.origin+'/trade#q/'+q.slug,ctx.toast)}>Copy link</button><button className="btn btn-line btn-sm" onClick=${()=>{location.hash='q/'+q.slug}}>Open</button></span></div>`)}</div>`
        :html`<p className="help">${me.verified?'Create one from your tray: price a project, add your markup, send one link.':'Client quotes open with a verified trade account.'}</p>`}</div>
    </div>
    ${v2?.creatorEnrollment?html`<section style=${{display:'grid',gap:18,marginBottom:24}}><h2 style=${{fontSize:38}}>Referrals & earnings</h2><${ProgramHubV2} site="trade"/><${TeamPanel}/></section>`:html`<${PartnerPanel} ctx=${ctx}/>`}
    <div style=${{height:40}}></div>
  </main>`;
}

// Payouts: monthly on the 15th through Stripe once set up; by hand until automatic payouts are on.
function PayoutSetup({ctx,ph}){
  const start=useAction(api.holmConnect.startPayoutSetup);const refresh=useAction(api.holmConnect.refreshPayoutStatus);const [busy,setBusy]=useState(false);
  const s=ph.payoutSetup;const min=fmt(ph.payoutMinCents/100,true);
  useEffect(()=>{if(s.enabled&&s.connected&&!s.ready)refresh().catch(()=>{})},[s.enabled,s.connected,s.ready]);
  const go=async()=>{setBusy(true);try{location.href=await start({returnTo:'trade'})}catch(e){ctx.toast(errText(e));setBusy(false)}};
  return html`<div style=${{marginTop:12,display:'grid',gap:6}}><h3>Payouts</h3>
    ${!s.enabled?html`<p className="help" style=${{margin:0}}>Commission is paid monthly once your cleared balance is ${min} or more. Until automatic payouts open, we pay by hand after your W-9 is approved.</p>`
    :s.ready?html`<p className="help" style=${{margin:0}}>Payouts ready. Paid on the 15th to your bank through Stripe when your cleared balance is ${min} or more; smaller balances carry over.</p>`
    :html`<p className="help" style=${{margin:0}}>${s.connected?(s.due?'Stripe needs a few more details before it can pay you.':'Finishing setup with Stripe.'):'Connect a bank account through Stripe to be paid automatically on the 15th. Stripe collects your tax details; we never see your bank information.'}</p>
      <button className="btn btn-ink btn-sm" style=${{justifySelf:'start'}} disabled=${busy} onClick=${go}>${s.connected?'Continue with Stripe':'Set up payouts'}</button>`}</div>`;
}

// The store-credit setting: apply it to the next order automatically, or save it up.
function CreditToggle({ctx}){
  const c=useQuery(api.holmCredit.myCredit);const set=useMutation(api.holmCredit.setCreditAutoApply);
  if(!c)return null;
  return html`<label className="toggle" style=${{marginTop:6}}><span>${c.autoApply?'Apply to my next order':'Save it for later'}<br/><small className="mute">Credit comes off merchandise only, never delivery or tax, and is never paid out as cash.</small></span>
    <input type="checkbox" className="sr" checked=${c.autoApply} onChange=${e=>set({on:e.target.checked}).catch(x=>ctx.toast(errText(x)))}/><span className=${'sw'+(c.autoApply?' on':'')}></span></label>`;
}

/* ================= PARTNER TERMS ================= */
// Written from the program rules (lib/holmPartners), so the terms can't promise what the code doesn't do.
function PartnerTerms(){
  // v2 (S37): once v2 enrollment is on and every policy the terms describe is approved, the terms
  // are generated from that configuration; until then the current terms stay up.
  const v2=useQuery(api.v2Admin.publicFlags);const v2t=useQuery(api.v2Admin.programTermsView,v2?.creatorEnrollment?{}:'skip');
  if(v2?.creatorEnrollment&&v2t?.ready)return html`<main className="wrap" style=${{maxWidth:820,marginInline:'auto',paddingTop:48,paddingBottom:80}}>
    <h1 style=${{fontSize:'clamp(40px,5vw,64px)'}}>Partner terms</h1>
    <p className="mute" style=${{marginTop:10}}>Creator Program and House of Louie Mae Trade Program: shared retail-referral terms.</p>
    ${v2t.sections.map(s=>html`<section key=${s.title} style=${{margin:'30px 0'}}><h3 style=${{fontSize:24}}>${s.title}</h3><ul style=${{margin:'8px 0 0',paddingLeft:20,display:'grid',gap:6}}>${s.items.map((t,i)=>html`<li key=${i}>${t}</li>`)}</ul></section>`)}
  </main>`;
  const rows=rateRows();
  return html`<main className="wrap" style=${{maxWidth:820,marginInline:'auto',paddingTop:48,paddingBottom:80}}>
    <h1 style=${{fontSize:'clamp(40px,5vw,64px)'}}>Partner terms</h1>
    <p className="mute" style=${{marginTop:10}}>For creators and trade partners who share Louie Mae and House of Louie Mae through their own links.</p>
    <table className="t" style=${{margin:'28px 0'}}><caption className="sr">Rates by tier and product type</caption><thead><tr><th>Tier · 12-month sales</th>${rows[0].rates.map(r=>html`<th key=${r.type} className="r">${r.label}</th>`)}</tr></thead>
      <tbody>${rows.map(r=>html`<tr key=${r.tier}><td><b style=${{fontWeight:500}}>${r.name}</b> <span className="mute">${r.sales}</span></td>${r.rates.map(x=>html`<td key=${x.type} className="r num">${x.rate}</td>`)}</tr>`)}</tbody></table>
    ${partnerTerms().map(s=>html`<section key=${s.title} style=${{margin:'30px 0'}}><h3 style=${{fontSize:24}}>${s.title}</h3><ul style=${{margin:'8px 0 0',paddingLeft:20,display:'grid',gap:6}}>${s.items.map((t,i)=>html`<li key=${i}>${t}</li>`)}</ul></section>`)}
    <p className="help">Questions: <a href="mailto:withlove@louiemae.com">withlove@louiemae.com</a>.</p>
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
/** Adapt legacy navigation to the typed, validated application flow. */
function Trade({ctx}) { return html`<${TradeApplication} me=${ctx.me} onNavigate=${ctx.go} onSignIn=${ctx.signInThen}/>`; }

// A turntable: one model, lit, turning slowly, with its W × D × H beneath.
export function Turntable({url,dims,height=260}){
  const cv=useRef();const [three,failed]=useThree();const [err,setErr]=useState('');
  useEffect(()=>{if(!three||!url)return;const T=three;const c=cv.current;const r=new T.WebGLRenderer({canvas:c,antialias:true,alpha:true});r.setPixelRatio(Math.min(devicePixelRatio||1,2));r.outputColorSpace=T.SRGBColorSpace;r.toneMapping=T.ACESFilmicToneMapping;r.shadowMap.enabled=true;
    const scene=new T.Scene();const cam=new T.PerspectiveCamera(30,1,.01,100);scene.add(new T.HemisphereLight('#FFF6EA','#B8A58C',1.2*LX));const sun=new T.DirectionalLight('#FFF4E5',2.4*LX);sun.position.set(2,4,3);sun.castShadow=true;scene.add(sun);
    const ground=new T.Mesh(new T.CircleGeometry(4,48),new T.ShadowMaterial({opacity:.18}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
    let raf=0,live=true;const g=new T.Group();scene.add(g);
    loadGLB(url,r).then(obj=>{if(!live)return;fitToDims(T,obj,dims||{w:100,d:100,h:100});g.add(obj);const s=new T.Box3().setFromObject(g).getSize(new T.Vector3());const R=Math.max(s.x,s.y,s.z)*1.9;
      const tick=t=>{if(!live)return;const w=c.clientWidth,h=c.clientHeight;if(c.width!==w*r.getPixelRatio()){r.setSize(w,h,false);cam.aspect=w/h;cam.updateProjectionMatrix()}g.rotation.y=t/3000;cam.position.set(R*.9,R*.45,R*.9);cam.lookAt(0,s.y*.45,0);r.render(scene,cam);raf=requestAnimationFrame(tick)};raf=requestAnimationFrame(tick)},()=>live&&setErr('This model could not be read.'));
    return()=>{live=false;cancelAnimationFrame(raf);r.dispose()}},[three,url]);
  return html`<div className="tt" style=${{height}}>${failed||err?html`<p className="sx-note">${err||'3D could not load.'}</p>`:html`<canvas ref=${cv}></canvas>`}${dims&&html`<span className="tt-dims mono">${dims.w} × ${dims.d} × ${dims.h} cm</span>`}</div>`;
}

/* ================= ACCOUNT ================= */
function Account({ctx}) { return html`<${TradeAccount} me=${ctx.me} onNavigate=${ctx.go} onSignOut=${ctx.signOut}/>`; }

/* ================= WELCOME / LOGIN ================= */
/** Adapt the legacy catalog artwork and route context to the typed trade sign-in screen. */
function Welcome({ctx}) {
  const artwork = [[1,7,12,17,4,20],[2,8,13,19,9,22],[3,10,14,21,5,11]].map(column => column.map(id => byId(id)?.img).filter(Boolean));
  return html`<${TradeWelcome} signedIn=${ctx.me.signedIn} afterSignIn=${ctx.afterSignIn || 'home'} onNavigate=${ctx.go} artwork=${artwork}/>`;
}


/* ================= APP ================= */
export function App({catalogComplete=true,onCatalogIntent=()=>{},suspended=false}={}){
  useCatalogRevision();
  const me0=useQuery(api.holm.me);const me=me0||{signedIn:false,verified:false,admin:false,tradeStatus:'none'};
  const {signOut:authSignOut}=useAuthActions();const ensureProfile=useMutation(api.holm.ensureProfile);
  const linkVisit=useMutation(api.holmPartners.linkVisit);
  useEffect(()=>{if(!me.signedIn)return;ensureProfile({ref:activeRef()?.code}).then(()=>{const r=activeRef();if(r)return linkVisit({visitorId:visitorId(),refCode:r.code})}).catch(()=>{})},[me.signedIn]);
  // back from Google sign-in: continue to the page that asked for it
  useEffect(()=>{if(!me.signedIn)return;let r=null;try{r=sessionStorage.getItem('hol:after');sessionStorage.removeItem('hol:after')}catch(x){}if(r&&r!=='welcome')location.hash=r},[me.signedIn]);
  const [afterSignIn,setAfterSignIn]=useState(null);
  // The route is the hash up to any '?': partner links may add ?ref=…&ch=… after it (#p/7?ref=…).
  const getRoute=()=>(location.hash.replace('#','').split('?')[0]||'home');
  const [route,setRoute]=useState(getRoute());
  const [space,setSpace]=useState(()=>load('space','bar'));
  const [modePref,setModePref]=useState(()=>load('mode','trade'));const mode=me.verified?modePref:'retail';const setMode=m=>{if(me.verified)setModePref(m)};
  const [boards,setBoards]=useState(()=>load('boards',BOARD_SEED));
  const [tray,setTrayState]=useState(()=>{const t=load('tray',TRAY_SEED);const projects=(t.projects||[]).map(p=>({...p,items:(p.items||[])}));return projects.length?{...t,taxExempt:false,later:(t.later||[]),projects,active:projects.some(p=>p.id===t.active)?t.active:projects[0].id}:TRAY_SEED});
  // Collages saved before they carried ids get one as they load, so autosave updates them in place.
  const withIds=cs=>cs.map(c=>c.id?c:{...c,id:uid()});
  const [collages,setCollages]=useState(()=>withIds(load('collages',[])));
  const [likes,setLikes]=useState([]);const [recent,setRecent]=useState([]);
  const [inspo,setInspo]=useState(()=>load('inspo',INSPO_SEED));const [roomWall,setRoomWall]=useState(null);
  useEffect(()=>store('inspo',inspo),[inspo]);
  const [pin,setPin]=useState(null);const [pinIdentity,setPinIdentity]=useState(null);const [pinReturnsToTray,setPinReturnsToTray]=useState(false);const [trayOpen,setTray]=useState(false);
  usePrivateIndexing(!!me.signedIn || trayOpen);
  const [menu,setMenu]=useState(false);const [toastS,setToastS]=useState(null);
  const [query,setQuery]=useState('');const [imgQ,setImgQ]=useState(null);
  const [studioSeed,setStudioSeed]=usePendingStudioSeed();const [nonce,setNonce]=useState(0);const [roomSeed,setRoomSeed]=useState(null);const [board,setBoard]=useState('b1');const [trend,setTrend]=useState('t1');
  useEffect(()=>{const h=()=>{const r=getRoute();setPinReturnsToTray(false);if(r.startsWith('p/')){const id=+r.slice(2);if(Number.isSafeInteger(id)&&id>0){setPinIdentity({pid:id});setPin(id);return}}setRoute(r);setPin(null);scrollTo(0,0)};h();addEventListener('hashchange',h);return()=>removeEventListener('hashchange',h)},[]);
  // a visit through a partner link (?ref=CODE&ch=channel)
  const recordClick=useMutation(api.holmPartners.recordClick);
  useEffect(()=>{if(!/^#?admin/.test(location.hash))captureRefFromUrl(recordClick,getRoute())},[]);
  // projects, boards, collages and inspiration follow the account
  const remote=useQuery(api.holmSync.load,me.signedIn?{}:'skip');const saveState=useMutation(api.holmSync.save);const synced=useRef(false);
  useEffect(()=>{if(!me.signedIn)synced.current=false},[me.signedIn]);
  useEffect(()=>{if(!me.signedIn||!remote||synced.current)return;synced.current=true;
    const push=(key,value)=>saveState({key,value}).catch(()=>{});
    // the account wins on matching ids; work from this device that the account doesn't have is kept
    const localProjects=tray.projects.filter(p=>p.items.length&&!(remote.tray?.projects||[]).some(r=>r.id===p.id));
    if(remote.tray?.projects?.length){const projects=[...remote.tray.projects.map(p=>({...p,items:(p.items||[])})),...localProjects];const merged={...remote.tray,taxExempt:false,later:(remote.tray.later||[]),projects,active:projects.some(p=>p.id===remote.tray.active)?remote.tray.active:projects[0].id};setTrayState(merged);if(localProjects.length)push('tray',merged)}
    else if(tray.projects.some(p=>p.items.length))push('tray',tray);
    const remoteBoards=Array.isArray(remote.boards)?remote.boards:[];
    const localBoards=boards.filter(b=>b.pins.length&&!remoteBoards.some(r=>r.id===b.id));
    if(remoteBoards.length){const merged=[...remoteBoards,...localBoards];setBoards(merged);if(localBoards.length)push('boards',merged)}
    else if(localBoards.length)push('boards',boards);
    if(Array.isArray(remote.collages))setCollages(withIds(remote.collages));
    if(Array.isArray(remote.inspo))setInspo(l=>[...remote.inspo,...l.filter(x=>!/^https?:/.test(x.src)&&!remote.inspo.some(y=>y.id===x.id))]);
    if(!Array.isArray(remote.collages)&&collages.length)push('collages',collages.map(c=>({...c,bg:c.bg?.img?.startsWith('data:')?{color:'#EFE6D8'}:c.bg,els:c.els.filter(e=>!String(e.src||'').startsWith('data:'))})));
  },[me.signedIn,remote]);
  const syncSave=(key,value)=>{if(!me.signedIn||!synced.current)return;const t=setTimeout(()=>saveState({key,value}).catch(()=>{}),1500);return()=>clearTimeout(t)};
  useEffect(()=>store('space',space),[space]);useEffect(()=>syncSave('tray',tray),[tray,me.signedIn]);useEffect(()=>syncSave('boards',boards),[boards,me.signedIn]);useEffect(()=>syncSave('collages',collages.map(c=>({...c,bg:c.bg?.img?.startsWith('data:')?{color:'#EFE6D8'}:c.bg,els:c.els.filter(e=>!String(e.src||'').startsWith('data:'))}))),[collages,me.signedIn]);useEffect(()=>syncSave('inspo',inspo.filter(x=>/^https?:/.test(x.src))),[inspo,me.signedIn]);useEffect(()=>store('mode',modePref),[modePref]);useEffect(()=>store('boards',boards),[boards]);useEffect(()=>store('tray',tray),[tray]);useEffect(()=>store('collages',collages),[collages]);
  const go=r=>{setPinReturnsToTray(false);if(getRoute()===r){scrollTo({top:0,behavior:'smooth'});setPin(null)}else location.hash=r};
  const toast=(msg,action)=>setToastS({msg,action,k:Date.now()});
  const activeProject=tray.projects.find(p=>p.id===tray.active);
  const projectCatalog=useProjectCatalog([...(activeProject?.items||[]),...(tray.later||[])],BY_ID);
  const detailIdentity=pinIdentity?.pid===pin?pinIdentity:{pid:pin};
  const detailCatalog=useProjectCatalog(pin?[detailIdentity]:[],BY_ID);
  const detailProduct=pin?resolveProjectProduct(detailIdentity,detailCatalog.products):null;
  const projectReview=projectCatalog.pending?'Checking saved items':projectCatalog.preparing?'Verification required':projectCatalog.failed?'Unable to verify items':'Review unavailable items';
  const trayCount=activeProject.items.reduce((s,i)=>s+i.qty,0);
  const fly=(fromEl)=>{try{const btn=document.getElementById('trayBtn');if(!fromEl||!btn)return;const a=fromEl.getBoundingClientRect(),b=btn.getBoundingClientRect();const im=document.createElement('img');im.src=fromEl.src||fromEl.style.backgroundImage.slice(5,-2);im.className='fly';const sz=Math.min(140,a.width);Object.assign(im.style,{left:a.left+a.width/2-sz/2+'px',top:a.top+a.height/2-sz/2+'px',width:sz+'px',height:sz+'px'});document.body.appendChild(im);
    im.animate([{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${b.left+b.width/2-(a.left+a.width/2)}px,${b.top+b.height/2-(a.top+a.height/2)}px) scale(.12)`,opacity:.6}],{duration:700,easing:'cubic-bezier(.5,0,.2,1)'}).onfinish=()=>im.remove()}catch(e){}};
  const addToTray=(pid,qty=1,fromEl,quiet,verifiedProduct)=>{const selected=verifiedProduct?.id===pid?verifiedProduct:BY_ID.get(pid);if(!selected)return;qty=editorOrderQuantity(qty,selected);setTrayState(t=>({...t,projects:t.projects.map(p=>{if(p.id!==t.active)return p;const z=p.zones[0];const ex=p.items.find(i=>sameProjectSelection(i,{pid,lid:selected.lid,vid:selected.vid})&&i.zone===z);return {...p,items:ex?p.items.map(i=>i===ex?{...i,qty:i.qty+qty}:i):[...p.items,{pid,lid:selected.lid,vid:selected.vid,qty,zone:z}]}})}));
    fly(fromEl);if(!quiet)toast(`${selected.name} added to ${activeProject.name}`,{label:'Open tray',fn:()=>setTray(true)})};
  const saveTo=(pid,bid,quiet,verifiedProduct)=>{const selected=verifiedProduct?.id===pid?verifiedProduct:detailProduct?.id===pid?detailProduct:BY_ID.get(pid);if(!selected?.lid||!selected?.vid){toast('This product needs review before it can be saved.');return}setBoards(bs=>bs.map(b=>b.id===bid?{...b,t:Date.now(),pins:b.pins.some(x=>sameProjectSelection(x,{pid,lid:selected.lid,vid:selected.vid}))?b.pins:[{pid,lid:selected.lid,vid:selected.vid,sec:b.sections[0]||''},...b.pins]}:b).sort((a,b)=>b.t-a.t));if(!quiet){const b=boards.find(x=>x.id===bid);toast(`Saved to ${b?b.title:'board'}`,{label:'View',fn:()=>{setBoard(bid);go('board')}})}};
  const createBoard=(title,pid,secret=false,verifiedProduct)=>{const selected=pid?(verifiedProduct?.id===pid?verifiedProduct:detailProduct?.id===pid?detailProduct:BY_ID.get(pid)):null;if(pid&&(!selected?.lid||!selected?.vid)){toast('This product needs review before it can be saved.');return null}const id='b'+uid();setBoards(bs=>[{id,title,secret,collab:0,sections:[],pins:pid?[{pid,lid:selected.lid,vid:selected.vid,sec:''}]:[],t:Date.now()},...bs]);if(pid)toast('Saved to '+title);return id};
  const updateBoard=(id,fn)=>setBoards(bs=>bs.map(b=>b.id===id?fn(b):b));
  const imageSearch=f=>{const r=new FileReader();r.onload=()=>{const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=c.height=48;const g=c.getContext('2d');g.drawImage(img,0,0,48,48);const d=g.getImageData(0,0,48,48).data;const buckets={};for(let i=0;i<d.length;i+=4){const k=[d[i]>>5,d[i+1]>>5,d[i+2]>>5].join();(buckets[k]=buckets[k]||{n:0,r:0,g:0,b:0});const B=buckets[k];B.n++;B.r+=d[i];B.g+=d[i+1];B.b+=d[i+2]}
    const pal=Object.values(buckets).sort((a,b)=>b.n-a.n).slice(0,5).map(B=>rgb2hex(B.r/B.n,B.g/B.n,B.b/B.n));setImgQ({src:r.result,pal});setQuery('');go('discover')};img.src=r.result};r.readAsDataURL(f)};
  const toStudio=(ids,title)=>{setStudioSeed({ids,title:title||'New collage'});setNonce(n=>n+1);setPin(null);go('studio')};
  const openPin=(id,identity)=>{if(id&&trayOpen){setPinReturnsToTray(true);setTray(false)}else if(!id&&pinReturnsToTray){setTray(true);setPinReturnsToTray(false)}const p=BY_ID.get(id);setPinIdentity(id?(identity||(p?{pid:id,lid:p.lid,vid:p.vid}:{pid:id})):null);setPin(id);if(id)setRecent(r=>[id,...r.filter(x=>x!==id)].slice(0,8))};
  const addToProject=(pid,qty,projId,zone,fromEl,quiet,resolved)=>{const selected=resolved||(detailProduct?.id===pid?detailProduct:BY_ID.get(pid));if(!selected)return;qty=editorOrderQuantity(qty,selected);setTrayState(t=>({...t,projects:t.projects.map(p=>{if(p.id!==projId)return p;const z=zone||p.zones[0];const ex=p.items.find(i=>sameProjectSelection(i,{pid,lid:selected.lid,vid:selected.vid})&&i.zone===z);return {...p,items:ex?p.items.map(i=>i===ex?{...i,qty:i.qty+qty}:i):[...p.items,{pid,lid:selected.lid,vid:selected.vid,qty,zone:z}]}})}));fly(fromEl);if(!quiet){const pn=(tray.projects.find(p=>p.id===projId)||{}).name||'project';toast(selected.name+' added to '+pn+(zone?' · '+zone:''),{label:'Open tray',fn:()=>{setPin(null);setTray(true)}})}};
  const createProject=name=>{const id=uid();setTrayState(t=>({...t,projects:[...t.projects,{id,name,target:20,zones:['Main room'],items:[]}]}));toast(`Project "${name}" created`);return id};
  const addZone=(pid,z)=>setTrayState(t=>({...t,projects:t.projects.map(p=>p.id===pid&&!p.zones.includes(z)?{...p,zones:[...p.zones,z]}:p)}));
  const inspoCtx={inspo,addInspo:items=>setInspo(l=>[...items,...l]),removeInspo:id=>setInspo(l=>l.filter(x=>x.id!==id)),updateInspo:(id,o)=>setInspo(l=>l.map(x=>x.id===id?{...x,...o}:x)),roomWall,setRoomWall,inspoToStudio:(x,ids=[])=>{setStudioSeed({inspo:x,ids,title:x.title});setNonce(n=>n+1);go('studio')}};
  const signInThen=r=>{setAfterSignIn(r);try{sessionStorage.setItem('hol:after',r)}catch{}go('welcome')};const signOut=async()=>{await authSignOut();synced.current=false;['tray','boards','collages','inspo'].forEach(k=>{try{localStorage.removeItem('hol:'+k)}catch(e){}});setTrayState(TRAY_SEED);setBoards(BOARD_SEED);setCollages([]);setInspo(INSPO_SEED);toast('Signed out');go('home')};
  const ctx={...inspoCtx,catalogComplete,requestCatalog:onCatalogIntent,detailProduct,projectCatalog,projectReview,me,afterSignIn,signInThen,signOut,route,go,space,setSpace,mode,setMode,boards,saveTo,createBoard,updateBoard,tray,setTrayState,activeProject,trayCount,addToTray,setTray,setMenu,pin,openPin,recent,createProject,addZone,addToProject,toggleLike:id=>setLikes(l=>l.includes(id)?l.filter(x=>x!==id):[...l,id]),likes,toast,query,setQuery,imgQ,setImgQ,imageSearch,studioSeed,setStudioSeed,roomSeed,setRoomSeed,toStudio,board,setBoard,trend,setTrend,collages,saveCollage:(c,quiet)=>{setCollages(cs=>[c,...cs.filter(x=>c.id?x.id!==c.id:x.title!==c.title)]);if(!quiet)toast('Collage saved',{label:'View',fn:()=>go('boards')})},setTarget:n=>{setTrayState(t=>({...t,projects:t.projects.map(p=>p.id===t.active?{...p,target:n}:p)}));toast(`Seat target for ${activeProject.name} set to ${n}`,{label:'Open tray',fn:()=>setTray(true)})}};
  const pages={inspo:Inspo,home:Home,discover:Discover,trend:Trend,studio:Studio,room:Room,boards:Boards,board:BoardDetail,profile:Profile,hub:Hub,trade:Trade,quiz:Quiz,account:Account,welcome:Welcome,admin:AdminPage,sourcing:Sourcing,'partner-terms':PartnerTerms};
  const Page=pages[route]||Home;
  // Keep persistence hooks alive while entry screens own the UI. Studio cleanup
  // can save its last document into this still-mounted owner.
  if(suspended)return null;
  if(route.startsWith('q/'))return html`<${React.Fragment}><${ClientQuote} ctx=${ctx} code=${route.slice(2)}/><${Toast} t=${toastS} onClose=${()=>setToastS(null)}/><//>`;
  return html`<${React.Fragment}>
    <${Header} ctx=${ctx}/>
    <${DeliveryQuoteAccess}/>
    ${!catalogComplete&&route!=='home'&&html`<p role="status" className="wrap help">Loading the full catalog. More pieces will appear; your saved projects remain available.</p>`}
    ${!catalogComplete&&(['discover','quiz'].includes(route)||(route==='studio'&&studioSeed?.prompt))?html`<main className="wrap" aria-busy="true"><h1>Loading the catalog</h1><p>Search, filters and recommendations will be available when all current products are checked.</p></main>`:route.startsWith('b/')?html`<${SharedBoard} key=${route} ctx=${ctx} slug=${route.slice(2)}/>`:html`<${Page} key=${route+(route==='studio'?nonce:'')} ctx=${ctx}/>`}
    ${route!=='studio'&&route!=='room'&&html`<${TabBar} ctx=${ctx}/>`}
    ${pin&&(detailProduct?html`<${PinDetail} key=${detailProduct.lid+':'+detailProduct.vid} ctx=${ctx}/>`:html`<${Modal} open=${true} label=${detailCatalog.pending||detailCatalog.preparing||detailCatalog.failed?"Product availability":"Product unavailable"} onClose=${()=>openPin(null)}><p role="status">${projectResolutionMessage(detailIdentity,detailCatalog.states)}</p><button className="btn btn-line" onClick=${()=>openPin(null)}>Close</button><//>`)}
    ${(trayOpen||pinReturnsToTray)&&html`<${Tray} ctx=${ctx} open=${trayOpen}/>`}
    ${menu&&html`<${IndexMenu} ctx=${ctx}/>`}
    <${Toast} t=${toastS} onClose=${()=>setToastS(null)}/>
  <//>`;
}


function AdminPage({ctx}) { return html`<${HouseStaffGate} admin=${ctx.me.admin} toast=${ctx.toast} Turntable=${Turntable}/>`; }
