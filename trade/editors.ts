/* eslint-disable */
// @ts-nocheck
import { EditorNumberField } from './EditorNumberField';
import { shareableBoard } from './shareableBoard';
import { calibrationScale, renderPlannerLabels, renderAtRevision, usingDisposable, withRestoredVisibility } from './editorSafety';
import { HouseStaffGate } from './admin/HouseStaffGate';
import { TradeAccount, TradeWelcome, TradeApplication, ProjectDeliveryPanel, ProductDeliveryEstimate, ProgramHubV2, TeamPanel } from './deferredFeatures';
import { DeliveryCalculatorDisclosure } from './DeliveryCalculatorDisclosure';
import { TradeNewsletter } from './TradeNewsletter';
import { ProgressiveSections } from './ProgressiveSections';
import { DiscoverCatalog } from './DiscoverCatalog';
import { SaveBoardMenu } from './SaveBoardMenu';
import { CatalogProductCard } from './CatalogProductCard';
import { ProductPrice as Price } from './ProductPrice';
import { formatHolmPrice as fmt } from './formatHolmPrice';
import { products as PRODUCTS, productsById as BY_ID, catalogGeneration, useCatalogRevision } from './catalogStore';
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
import { validRoomPolygon, area as polyArea, inside as inPoly, centroid as polyCentre, bounds as polyBounds, setWallLength } from '../lib/holmPlan';
import { html, MAT, TYPE, byId, has, tp, pr, cut, pinItUrl, threeP, loadThree, LX, useThree, SPACES, SPACE_KEYS, COMMUNITY, load, store, hex2rgb, cdist, uid, copyText, COLOR_WORDS, matchPrompt, ICONS, I, useOutside, SaveMenu, PinCard, BoardPin, Wall, GLOW_AT, ROOMS, TEX, rnd, texture, STUDY, FLOOR_TILE, PAGES, pageOf, borderOf, POLY0, BW, boardH, boardPath, maskOf, LAYOUTS, SLOTS, mkImg, mkText, toneF, cropStyle, ElView, blends, elStyle, bgStyle, BoardPreview, errText, dataUrlBlob, dimsText, bundleUrl, gltfP, gltfLoader, glbCache, loadGLB, fitToDims } from './editorShared';

const editorIdentity=reference=>typeof reference==='number'?{pid:reference,...(has(reference)?{lid:byId(reference).lid,vid:byId(reference).vid}:{})}:{pid:reference.pid,lid:reference.lid,vid:reference.vid};

const STUDIO_TABS=[['pieces','Pieces'],['inspo','Inspo'],['boards','Boards'],['ideas','Ideas']];
const VIEWS=[['collage','Collage'],['room','Room'],['3d','3D']];

const TITLE_MAX=32;

function SxTop({ctx,title,setTitle,view,onView,saved,onShare,children}){
  return html`<div className="sx-top">
    <input className="sx-title" aria-label="Title" maxLength=${TITLE_MAX} size=${Math.max(10,title.length+1)} value=${title} onInput=${e=>setTitle(e.target.value)} onKeyDown=${e=>{if(e.key==='Enter')e.currentTarget.blur()}}/>
    <div className="seg sx-views" role="group" aria-label="View">${VIEWS.map(([k,l])=>html`<button key=${k} className=${view===k?'on':''} aria-pressed=${view===k} onClick=${()=>view!==k&&onView(k)}>${l}</button>`)}</div>
    <span className="sx-saved" role="status">${saved}</span>
    <button className="btn btn-cog btn-sm" onClick=${onShare}>${I('share',{width:15})} Share</button>
    ${children}
  </div>`;
}

// The ⋯ menu: history, page size, export and the trade/retail price toggle, plus anything page-specific.
function SxMenu({ctx,hist,children}){
  const [open,setOpen]=useState(false);const ref=useRef();useOutside(ref,()=>setOpen(false));
  return html`<div className="sx-more" ref=${ref}>
    <button className="ib" aria-label="More" aria-expanded=${open} onClick=${()=>setOpen(!open)}>${I('dots')}</button>
    ${open&&html`<div className="pop sx-pop" onClick=${e=>{if(e.target.closest('[data-close]'))setOpen(false)}}>
      <div className="sx-pop-sec"><span className="sx-lbl">History</span>
        <div className="row" style=${{gap:6}}><button className="btn btn-line btn-sm" disabled=${!hist.canUndo} onClick=${hist.undo}>${I('undo',{width:15})} Undo</button><button className="btn btn-line btn-sm" disabled=${!hist.canRedo} onClick=${hist.redo}>${I('redo',{width:15})} Redo</button></div>
        <span className="sx-note">${hist.steps?`${hist.steps} change${hist.steps===1?'':'s'} this session · Ctrl+Z`:'No changes yet'}</span></div>
      ${children}
      <div className="sx-pop-sec"><span className="sx-lbl">Prices</span>
        ${ctx.me.verified?html`<div className="seg" role="group" aria-label="Prices">${[['trade','Trade'],['retail','Retail']].map(([k,l])=>html`<button key=${k} className=${ctx.mode===k?'on':''} onClick=${()=>ctx.setMode(k)}>${l}</button>`)}</div>`
          :html`<span className="sx-note">Retail prices. <button className="lnk" data-close onClick=${()=>ctx.go('trade')}>Apply for trade pricing</button></span>`}</div>
    </div>`}
  </div>`;
}

function SxRail({items,open,onPick}){
  return html`<nav className="sx-rail" aria-label="Tools">${items.map(([k,l,ic])=>html`<button key=${k} className=${open===k?'on':''} aria-pressed=${open===k} aria-label=${l} onClick=${()=>onPick(k)}>${I(ic)}<span className="sx-tip">${l}</span></button>`)}</nav>`;
}

function SxDrawer({title,onClose,children}){
  return html`<aside className="sx-drawer" aria-label=${title}>
    <div className="sx-drawer-h"><b>${title}</b><button className="ib" aria-label=${'Close '+title} onClick=${onClose}>${I('x')}</button></div>
    <div className="sx-drawer-b">${children}</div></aside>`;
}

/** Name the piece-list action from its visible quantity, price and channel text. */
function SxPill({ctx,count,total,onOpen}){
  return html`<button className="sx-pill" onClick=${onOpen}><span className="sr">Open the piece list: </span><span>${count} piece${count===1?'':'s'}</span><span className="sx-dot"></span><b className="num">${fmt(total)}</b><span>${ctx.mode==='trade'?'trade':'retail'}</span></button>`;
}

// Every piece on the canvas with its quantity; hidden pieces show struck through so the total's rule is visible.
/** Show canvas quantities in a keyboard-scrollable modal before copying items to a local project draft. */
function SxTray({ctx,rows,onClose}){
  const [proj,setProj]=useState(ctx.tray.active);const live=rows.filter(r=>!r.hidden);
  const productFor=r=>resolveProjectProduct(r,ctx.savedProducts||BY_ID)||displayProduct(new Map(),r.pid);
  const unavailable=live.some(r=>!productFor(r).lid);
  const orderQty=r=>editorOrderQuantity(r.qty,productFor(r));
  const total=live.reduce((s,r)=>s+pr(productFor(r),ctx.mode)*orderQty(r),0);
  return html`<${Modal} open label="Pieces" onClose=${onClose}><div className="scrim sx-scrim" onClick=${e=>e.target===e.currentTarget&&onClose()}>
    <div className="sx-sheet">
      <div className="sx-drawer-h"><b>Pieces</b><button className="ib" aria-label="Close" onClick=${onClose}>${I('x')}</button></div>
      <div className="sx-rows" tabIndex="0" role="region" aria-label="Piece quantities and prices">${rows.length?rows.map(r=>{const p=productFor(r);return html`<div key=${r.key||projectItemKey(r)+(r.hidden?'h':'')} className=${'sx-row'+(r.hidden?' off':'')}>
        <span className="sx-th"><img src=${p.cutout||p.img} alt=""/></span><span className="sx-row-t"><b>${p.name}</b><span>${p.line}${r.hidden?' · hidden, not counted':orderQty(r)!==r.qty?` · ${r.qty} planned; supplier minimum/increment requires ${orderQty(r)}`:''}</span></span>
        <span className="mono">× ${orderQty(r)}</span><span className="num sx-price">${fmt(pr(p,ctx.mode)*orderQty(r))}</span></div>`}):html`<p className="sx-note">No pieces yet. Add some from the rail.</p>`}</div>
      <div className="sx-sheet-f">
        <span><span className="sx-note">${live.reduce((s,r)=>s+orderQty(r),0)} pieces · ${ctx.mode==='trade'?'trade':'retail'}</span><br/><b className="num sx-total">${fmt(total)}</b></span>
        <span className="row" style=${{gap:8,flexWrap:'wrap'}}>
          <select className="field" style=${{height:38,width:'auto'}} value=${proj} onChange=${e=>setProj(e.target.value)} aria-label="Project">${ctx.tray.projects.map(p=>html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}</select>
          <button className="btn btn-cog btn-sm" disabled=${!live.length||unavailable||!ctx.tray.projects.some(p=>p.id===proj)} onClick=${()=>{const P=ctx.tray.projects.find(p=>p.id===proj);live.forEach(r=>ctx.addToProject(r.pid,orderQty(r),proj,P.zones[0],null,true,productFor(r)));ctx.toast(`${live.reduce((s,r)=>s+orderQty(r),0)} pieces added to ${P.name}`,{label:'Open tray',fn:()=>ctx.setTray(true)});onClose()}}>${I('tray',{width:15})} Add all to project</button>
        </span></div>
    </div></div><//>`;
}

/** Share native modal focus, dismissal and scroll ownership across Studio tool dialogs. */
function SxDialog({title,onClose,wide,children}){
  return html`<${Modal} open label=${title} onClose=${onClose}><div className="scrim sx-scrim" onClick=${e=>e.target===e.currentTarget&&onClose()}>
    <div className=${'sx-dialog'+(wide?' wide':'')}><div className="sx-drawer-h"><b>${title}</b><button className="ib" aria-label="Close" onClick=${onClose}>${I('x')}</button></div>${children}</div></div><//>`;
}

/* ================= STUDIO ================= */
const BGS=[['Plaster','#EFE6D8'],['Sand','#E1D2BB'],['Limewash','#F4EFE6'],['Olive','#6C6948'],['Cognac','#9A5A2E'],['Espresso','#2B211A']];

const SHAPES=[['rect','Square'],['arch','Arch'],['circle','Circle'],['pill','Pill'],['rounded','Rounded'],['oval','Oval']];

// Every piece picks one of four looks. Switching keeps its place, size and layer.
const LOOKS=[['cutout','Seamless cutout','The piece on the board with a soft contact shadow'],['framed','Framed photo','The product photo in a shape, with an optional border'],['3d','3D cutout','A lit model you can turn to any angle'],['room','In the room','On your room photo at true scale']];

const BOARD_SHAPES=[['rect','Rectangle'],['rounded','Rounded'],['arch','Arch'],['circle','Circle'],['oval','Oval'],['scallop','Scalloped'],['torn','Torn paper'],['poly','Free shape']];

const EDGES=[['none','None'],['hairline','Hairline'],['thick','Thick border'],['deckle','Deckled paper'],['shadow','Drop shadow']];

const EDGE_COLORS=['#FBF8F2','#2B211A','#A65F2C','#6C6948','#AE884C','#E1D2BB'];

// The edge sits over the board, unmasked: a hairline on the outline, or a border or deckled paper clipped inside it.
function BoardEdge({doc}){
  const id=useMemo(()=>'be'+uid(),[]);const W=BW,H=boardH(doc.page);const d=boardPath(doc.shape,W,H,doc.poly);const e=doc.edge;
  if(!e||e==='none'||e==='shadow')return null;
  return html`<svg className="sx-edge" viewBox=${`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
    <defs><clipPath id=${id+'c'}><path d=${d}/></clipPath>${e==='deckle'&&html`<filter id=${id+'f'}><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="3" seed="3"/><feDisplacementMap in="SourceGraphic" scale="14"/></filter>`}</defs>
    ${e==='hairline'&&html`<path d=${d} fill="none" stroke="#2B211A" strokeWidth="2.5"/>`}
    ${e==='thick'&&html`<path d=${d} fill="none" stroke=${doc.edgeColor||'#FBF8F2'} strokeWidth="44" clipPath=${`url(#${id}c)`}/>`}
    ${e==='deckle'&&html`<g clipPath=${`url(#${id}c)`}><path d=${d} fill="none" stroke="#FBF8F2" strokeWidth="56" filter=${`url(#${id}f)`}/></g>`}
  </svg>`;
}

function mkInspo(x){return {id:uid(),kind:'inspo',src:x.src,ar:x.ar||1,title:x.title,x:6,y:6,w:48,rot:-2,shape:'rect',border:'white',motion:false,tone:'none',locked:false,hidden:false}}

function compose(prompt,mode,v=0){
  const ps=matchPrompt(prompt).slice(0,5+(v>1?1:0));const base=ps.length?ps:SPACES.cafe.picks.map(byId);
  const use=v===1?[...base].reverse():v===2?[...base.slice(1),base[0]]:base;
  const els=use.map((p,i)=>mkImg(p.id,i,mode,LAYOUTS[v%LAYOUTS.length],mode==='room'?'room':v===1?'cutout':'framed'));
  const tones=[...new Set(use.map(p=>p.tone))].slice(0,4);
  tones.forEach((c,i)=>els.push({id:uid(),kind:'swatch',color:c,x:70+i*6.5,y:90,w:5.5,rot:0,locked:false,hidden:false}));
  els.push(mkText(prompt.charAt(0).toUpperCase()+prompt.slice(1),6,88,5.2));
  return els;
}

const SAMPLE=()=>[mkImg(2,0),mkImg(12,1),mkImg(9,2),mkImg(13,3),mkText('A corner for slow mornings',6,86,4.6)];

const SNAP=.8;

// Smart guides: snap the moving box's edges and centre to the board's centre and to every other item, and
// to equal spacing between its neighbours. Boxes are {x,y,w,h} in percent of the board.
function snapBox(b,others){
  const out={x:b.x,y:b.y,gx:[],gy:[]};
  const axis=(pos,size,lines,key)=>{let best=null;[0,.5,1].forEach(f=>lines.forEach(l=>{const d=l-(pos+size*f);if(Math.abs(d)<SNAP&&(!best||Math.abs(d)<Math.abs(best.d)))best={d,l}}));return best};
  const xs=[50,...others.flatMap(o=>[o.x,o.x+o.w/2,o.x+o.w])],ys=[50,...others.flatMap(o=>[o.y,o.y+o.h/2,o.y+o.h])];
  const bx=axis(b.x,b.w,xs),by=axis(b.y,b.h,ys);
  if(bx){out.x+=bx.d;out.gx.push(bx.l)}if(by){out.y+=by.d;out.gy.push(by.l)}
  if(!bx){const row=others.filter(o=>o.y<b.y+b.h&&o.y+o.h>b.y);const L=row.filter(o=>o.x+o.w<=b.x+SNAP).sort((p,q)=>q.x+q.w-(p.x+p.w))[0],R=row.filter(o=>o.x>=b.x+b.w-SNAP).sort((p,q)=>p.x-q.x)[0];
    if(L&&R){const gap=(R.x-(L.x+L.w)-b.w)/2;const nx=L.x+L.w+gap;if(gap>0&&Math.abs(nx-b.x)<SNAP){out.x=nx;out.gap={kind:'x',a:L.x+L.w,b:nx,c:nx+b.w,d:R.x,at:b.y+b.h/2}}}}
  if(!by){const col=others.filter(o=>o.x<b.x+b.w&&o.x+o.w>b.x);const T=col.filter(o=>o.y+o.h<=b.y+SNAP).sort((p,q)=>q.y+q.h-(p.y+p.h))[0],B=col.filter(o=>o.y>=b.y+b.h-SNAP).sort((p,q)=>p.y-q.y)[0];
    if(T&&B){const gap=(B.y-(T.y+T.h)-b.h)/2;const ny=T.y+T.h+gap;if(gap>0&&Math.abs(ny-b.y)<SNAP){out.y=ny;out.gap={kind:'y',a:T.y+T.h,b:ny,c:ny+b.h,d:B.y,at:b.x+b.w/2}}}}
  return out;
}

const ZMIN=.25,ZMAX=4;

/** Edit the local collage draft; modal tools own keyboard events while the canvas stays inert. */
function Studio({ctx}){
  const seed=ctx.studioSeed;
  const [doc,setDoc]=useState(()=>{
    const base={id:uid(),title:seed?.title||'New collage',mode:seed?.mode||'collage',page:'portrait',shape:'rect',edge:'shadow',bg:seed?.bg?{img:seed.bg}:{color:'#EFE6D8',grid:true}};
    if(seed?.collage)return {page:'portrait',mode:'collage',shape:'rect',edge:'shadow',bg:{color:'#EFE6D8',grid:true},...seed.collage,id:seed.collage.id||uid()};
    if(seed?.prompt)return {...base,els:compose(seed.prompt,seed?.mode)};
    if(seed?.inspo)return {...base,els:[mkInspo(seed.inspo),...(seed.ids||[]).map((id,i)=>mkImg(id,i+1))]};
    if(seed?.ids)return {...base,els:seed.ids.map((id,i)=>mkImg(id,i,seed.mode))};
    const last=ctx.collages.find(c=>c.id&&c.id===load('collage',null));
    const d=last?{page:'portrait',mode:'collage',shape:'rect',edge:'shadow',...last,...(seed?.view?{mode:seed.view}:{})}:{...base,...(seed?.view?{mode:seed.view}:{}),els:SAMPLE()};
    return d;
  });
  const {els,bg,mode,page,title}=doc;
  const addTabsId=useId();
  const [tab,setTab]=useState('pieces');const [pq,setPq]=useState('');const [pf,setPf]=useState('all');
  const syncRef=useRef(seed?.sync?.map(editorIdentity)||null);
  const savedCatalog=useProjectCatalog([...els.filter(e=>e.kind==='img'),...(syncRef.current||[]),...(tab==='boards'?ctx.boards.flatMap(b=>b.pins):[])],BY_ID);
  const geometry=studioGeometry(savedCatalog.products);
  const productFor=reference=>geometry.product(reference);
  const {elementAspect:elAR,lockedWidth:lockW,width:wOf}=geometry;
  const pieceImage=reference=>{const p=productFor(reference);return p.cutout||p.img};
  const nameOf=e=>e.kind==='img'?productFor(e).name:e.kind==='inspo'?'Inspo · '+e.title:e.kind==='text'?e.text:'Swatch';
  // Several items can be selected (Shift-click); the last one picked leads.
  const [sels,setSels]=useState([]);const sel=sels[sels.length-1]||null;const setSel=id=>setSels(id?[id]:[]);const [drawer,setDrawer]=useState(null);const [pop,setPop]=useState(null);
  const [share,setShare]=useState(false);const [traySheet,setTraySheet]=useState(false);const [composeOpen,setComposeOpen]=useState(false);const [idea,setIdea]=useState(null);
  const [dragL,setDragL]=useState(null);const [overL,setOverL]=useState(null);
  const [polyEdit,setPolyEdit]=useState(false);const [zoom,setZoom]=useState(1);const [fitW,setFitW]=useState(480);const [guides,setGuides]=useState(null);const [box,setBox]=useState(null);
  const [saved,setSaved]=useState('Saved');
  const hist=useRef({past:[],future:[]});const [steps,setSteps]=useState(0);const docRef=useRef(doc);docRef.current=doc;
  const canvasRef=useRef();const stageRef=useRef();const wrapRef=useRef();const bgRef=useRef();const dirty=useRef(!!seed?.sync);
  useEffect(()=>{if(seed)ctx.setStudioSeed(null)},[]);
  const record=prev=>{hist.current.past.push(prev);if(hist.current.past.length>80)hist.current.past.shift();hist.current.future=[];dirty.current=true;setSteps(s=>s+1)};
  const commitDoc=next=>{record(docRef.current);setDoc(next)};
  const commit=nextEls=>{const current=docRef.current.els;if(nextEls.length===current.length&&nextEls.every((item,i)=>item===current[i]))return;commitDoc({...docRef.current,els:nextEls})};
  useEffect(()=>{const requested=syncRef.current;if(!requested)return;const currentDoc=docRef.current;const imgs=currentDoc.els.filter(e=>e.kind==='img'&&productFor(e).lid);if(requested.some(item=>!productFor(item).lid))return;const verified=item=>{const p=productFor(item);return {pid:item.pid,lid:p.lid,vid:p.vid}};const {keep,add}=reconcileEditorSelections(imgs.map(verified),requested.map(verified));const drop=new Set(imgs.filter((_,i)=>!keep.has(i)).map(e=>e.id));syncRef.current=null;const st=currentDoc.mode==='room'?'room':'cutout';commitDoc({...currentDoc,els:[...currentDoc.els.filter(e=>!drop.has(e.id)),...add.map((identity,i)=>({...mkImg(identity,0,currentDoc.mode,SLOTS,st),x:6+(i%4)*23,y:60+Math.floor(i/4)*14,w:20}))]})});
  const undo=()=>{const h=hist.current;if(!h.past.length)return;h.future.push(docRef.current);dirty.current=true;setDoc(h.past.pop());setSteps(s=>s+1)};
  const redo=()=>{const h=hist.current;if(!h.future.length)return;h.past.push(docRef.current);dirty.current=true;setDoc(h.future.pop());setSteps(s=>s+1)};
  const setTitle=t=>{dirty.current=true;setDoc(d=>({...d,title:t.slice(0,TITLE_MAX)}))};
  const setBg=b=>commitDoc({...docRef.current,bg:b});
  const S=sels.length===1?els.find(e=>e.id===sel):null;const multi=sels.length>1;
  useEffect(()=>setPop(null),[sels.join()]);
  const patch=(id,o)=>commit(els.map(e=>e.id===id&&!(e.locked&&['x','y','w','size','rot','crop','shape'].some(k=>k in o))?{...e,...o}:e));
  const patchMany=(ids,f)=>commit(els.map(e=>ids.includes(e.id)?{...e,...f(e)}:e));
  const groupOf=id=>{const e=els.find(x=>x.id===id);return e?.g?els.filter(x=>x.g===e.g).map(x=>x.id):[id]};
  const pick=(id,shift)=>{const g=groupOf(id);if(shift){setSels(s=>s.includes(id)?s.filter(x=>!g.includes(x)):[...s.filter(x=>!g.includes(x)),...g.filter(x=>x!==id),id]);return}
    if(!(sels.includes(id)&&sels.length>1))setSels([...g.filter(x=>x!==id),id])};
  const live=(id,o)=>{const current=docRef.current.els.find(e=>e.id===id);if(current?.locked&&['x','y','w','size','rot','crop','shape'].some(k=>k in o))return;dirty.current=true;setDoc(d=>({...d,els:d.els.map(e=>e.id===id?{...e,...o}:e)}))};
  const rangeKeys=e=>{if(!e.repeat&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key))record(docRef.current)};
  // Autosave every change to the account (or this device when signed out).
  useEffect(()=>{store('collage',doc.id);if(!dirty.current)return;setSaved('Saving…');const t=setTimeout(()=>{ctx.saveCollage(docRef.current,true);dirty.current=false;setSaved('Saved')},600);return()=>clearTimeout(t)},[doc]);
  // Leaving the Studio (for the 3D view, say) saves anything still waiting.
  useEffect(()=>()=>{if(dirty.current)ctx.saveCollage(docRef.current,true)},[]);
  // The board fits the stage at 100%; zoom scales from there.
  const P=pageOf(page);
  useEffect(()=>{const st=stageRef.current;if(!st)return;const fit=()=>{const r=st.getBoundingClientRect();const pad=innerWidth<761?24:64,padB=innerWidth<761?84:96;setFitW(Math.max(160,Math.min(r.width-pad,(r.height-padB)*P[2]/P[3])))};const ro=new ResizeObserver(fit);ro.observe(st);fit();return()=>ro.disconnect()},[page]);
  const zoomTo=z=>setZoom(Math.max(ZMIN,Math.min(ZMAX,Math.round(z*100)/100)));
  // Pinch to zoom on touch, and Ctrl/⌘ + wheel on a trackpad or mouse.
  useEffect(()=>{const st=stageRef.current;if(!st)return;const pts=new Map();let pinch=null;
    const down=e=>{if(e.pointerType!=='touch')return;pts.set(e.pointerId,[e.clientX,e.clientY]);if(pts.size===2){const [a,b]=[...pts.values()];pinch={d:Math.hypot(a[0]-b[0],a[1]-b[1]),z:zoomRef.current};drag.current?.cancel?.()}};
    const move=e=>{if(!pts.has(e.pointerId))return;pts.set(e.pointerId,[e.clientX,e.clientY]);if(pinch&&pts.size===2){const [a,b]=[...pts.values()];zoomTo(pinch.z*Math.hypot(a[0]-b[0],a[1]-b[1])/pinch.d)}};
    const up=e=>{pts.delete(e.pointerId);if(pts.size<2)pinch=null};
    const wheel=e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();zoomTo(zoomRef.current*(e.deltaY>0?.92:1.08))};
    st.addEventListener('pointerdown',down,true);addEventListener('pointermove',move);addEventListener('pointerup',up);addEventListener('pointercancel',up);st.addEventListener('wheel',wheel,{passive:false});
    return()=>{st.removeEventListener('pointerdown',down,true);removeEventListener('pointermove',move);removeEventListener('pointerup',up);removeEventListener('pointercancel',up);st.removeEventListener('wheel',wheel)}},[]);
  const zoomRef=useRef(zoom);zoomRef.current=zoom;
  const drag=useRef(null);
  const boxOf=n=>{const c=canvasRef.current;return {x:n.offsetLeft/c.offsetWidth*100,y:n.offsetTop/c.offsetHeight*100,w:n.offsetWidth/c.offsetWidth*100,h:n.offsetHeight/c.offsetHeight*100}};
  const onDown=(e,el,kind='move')=>{e.stopPropagation();setPop(null);if(e.shiftKey&&kind==='move'){pick(el.id,true);return}pick(el.id,false);if(el.locked||e.button>0)return;
    const ids=kind==='move'?(sels.includes(el.id)&&sels.length>1?sels:groupOf(el.id)):[el.id];
    const r=canvasRef.current.getBoundingClientRect();const node=e.currentTarget.closest('.el');const nr=node.getBoundingClientRect();
    const others=[...canvasRef.current.querySelectorAll('.el')].filter(n=>!ids.includes(n.dataset.id)).map(boxOf);const me=boxOf(node);
    const orig=Object.fromEntries(docRef.current.els.filter(x=>ids.includes(x.id)&&!x.locked).map(x=>[x.id,[x.x,x.y]]));
    const d={kind,id:el.id,ids,orig,sx:e.clientX,sy:e.clientY,o:{...el},me,r,cx:nr.left+nr.width/2,cy:nr.top+nr.height/2,snap:docRef.current,moved:false};
    d.move=ev=>{const dx=(ev.clientX-d.sx)/d.r.width*100,dy=(ev.clientY-d.sy)/d.r.height*100;if(!d.moved&&Math.hypot(ev.clientX-d.sx,ev.clientY-d.sy)<3)return;d.moved=true;
      if(d.kind==='move'){let x=d.me.x+dx,y=d.me.y+dy;if(!ev.altKey){const s=snapBox({x,y,w:d.me.w,h:d.me.h},others);x=s.x;y=s.y;setGuides(s.gx.length||s.gy.length||s.gap?s:null)}else setGuides(null);
        const ddx=x-d.me.x,ddy=y-d.me.y;setDoc(dd=>({...dd,els:dd.els.map(q=>d.orig[q.id]?{...q,x:d.orig[q.id][0]+ddx,y:d.orig[q.id][1]+ddy}:q)}));return}
      if(d.kind==='rs'){if(d.o.kind==='text')live(d.id,{size:Math.max(2,d.o.size*(1+dx/40))});else if(!lockW(d.o,docRef.current.bg))live(d.id,{w:Math.max(5,d.o.w+dx)});return}
      if(d.kind==='rot'){const a=Math.atan2(ev.clientY-d.cy,ev.clientX-d.cx)*180/Math.PI+90;live(d.id,{rot:ev.altKey?Math.round(a):Math.round(a/15)*15})}};
    d.up=()=>{removeEventListener('pointermove',d.move);setGuides(null);if(d.moved)record(d.snap);drag.current=null};
    d.cancel=()=>{removeEventListener('pointermove',d.move);setGuides(null);setDoc(d.snap);drag.current=null};
    drag.current=d;addEventListener('pointermove',d.move);addEventListener('pointerup',d.up,{once:true})};
  // Keep the selection bar beside the selected item as it moves, zooms or scrolls.
  useLayoutEffect(()=>{const ns=sels.map(id=>canvasRef.current?.querySelector(`[data-id="${id}"]`)).filter(Boolean);const w=wrapRef.current;if(!ns.length||!w){setBox(null);return}
    const rs=ns.map(n=>n.getBoundingClientRect());const a={left:Math.min(...rs.map(r=>r.left)),top:Math.min(...rs.map(r=>r.top))};a.width=Math.max(...rs.map(r=>r.right))-a.left;a.height=Math.max(...rs.map(r=>r.bottom))-a.top;
    const b=w.getBoundingClientRect();const nb={l:a.left-b.left,t:a.top-b.top,w:a.width,h:a.height,W:b.width};
    setBox(o=>o&&o.l===nb.l&&o.t===nb.t&&o.w===nb.w&&o.h===nb.h&&o.W===nb.W?o:nb)});
  const [,bump]=useState(0);useEffect(()=>{const st=stageRef.current;if(!st)return;const f=()=>bump(n=>n+1);st.addEventListener('scroll',f);addEventListener('resize',f);return()=>{st.removeEventListener('scroll',f);removeEventListener('resize',f)}},[]);
  const centreOf=()=>({x:50,y:42});
  const addEl=n=>{commit([...els,n]);setSel(n.id)};
  const addProduct=(pid,at)=>{const n=mkImg(pid,els.filter(e=>e.kind==='img').length,mode,SLOTS,mode==='room'?'room':'cutout');n.w=Math.min(n.w,38);const c=at||centreOf();n.x=Math.max(0,Math.min(100-n.w,c.x-n.w/2));n.y=Math.max(0,Math.min(92,c.y-n.w*.4));if(!at)n.rot=0;addEl(n)};
  const dropOnCanvas=e=>{e.preventDefault();const pid=+e.dataTransfer.getData('text/pid');if(!pid||!has(pid))return;const r=canvasRef.current.getBoundingClientRect();addProduct(pid,{x:(e.clientX-r.left)/r.width*100,y:(e.clientY-r.top)/r.height*100})};
  const layers=[...els].map((e,i)=>({e,i})).reverse();
  const arrange=(id,to)=>{const a=[...els];const i=a.findIndex(e=>e.id===id);const [m]=a.splice(i,1);const j=to==='front'?a.length:to==='back'?0:Math.max(0,Math.min(a.length,i+(to==='fwd'?1:-1)));a.splice(j,0,m);commit(a)};
  const dropLayer=(fromId,toId)=>{if(!fromId||fromId===toId)return;const a=[...els];const f=a.findIndex(e=>e.id===fromId);const [m]=a.splice(f,1);const t=a.findIndex(e=>e.id===toId);a.splice(t+1,0,m);commit(a)};
  const dup=()=>{if(!sels.length)return;const gs={};const copies=els.filter(e=>sels.includes(e.id)).map(e=>({...e,id:uid(),x:e.x+4,y:e.y+4,g:e.g?(gs[e.g]||=uid()):undefined}));commit([...els,...copies]);setSels(copies.map(c=>c.id))};
  const del=()=>{if(!sels.length)return;commit(els.filter(x=>!sels.includes(x.id)));setSels([])};
  const group=()=>{const g=uid();patchMany(sels,()=>({g}))};const ungroup=()=>patchMany(sels,()=>({g:undefined}));
  const grouped=multi&&els.filter(e=>sels.includes(e.id)).every((e,_,a)=>e.g&&e.g===a[0].g);
  // Align and distribute measure each item's laid-out box, so text and rotated pieces line up as they look.
  const boxesOf=ids=>ids.map(id=>{const n=canvasRef.current?.querySelector(`[data-id="${id}"]`);return n?{id,...boxOf(n)}:null}).filter(Boolean);
  const align=k=>{const bs=boxesOf(sels);if(bs.length<2)return;const L=Math.min(...bs.map(b=>b.x)),T=Math.min(...bs.map(b=>b.y)),Rr=Math.max(...bs.map(b=>b.x+b.w)),B=Math.max(...bs.map(b=>b.y+b.h));
    const at=Object.fromEntries(bs.map(b=>[b.id,k==='left'?{x:L}:k==='centre'?{x:(L+Rr)/2-b.w/2}:k==='right'?{x:Rr-b.w}:k==='top'?{y:T}:k==='middle'?{y:(T+B)/2-b.h/2}:{y:B-b.h}]));
    commit(els.map(e=>at[e.id]&&!e.locked?{...e,...at[e.id]}:e))};
  const distribute=axis=>{const bs=boxesOf(sels);if(bs.length<3)return;const X=axis==='x';bs.sort((a,b)=>X?a.x-b.x:a.y-b.y);const first=bs[0],last=bs[bs.length-1];
    const span=X?last.x+last.w-first.x:last.y+last.h-first.y;const sum=bs.reduce((s,b)=>s+(X?b.w:b.h),0);const gap=(span-sum)/(bs.length-1);let p=X?first.x:first.y;const at={};
    bs.forEach(b=>{at[b.id]=X?{x:p}:{y:p};p+=(X?b.w:b.h)+gap});commit(els.map(e=>at[e.id]&&!e.locked?{...e,...at[e.id]}:e))};
  // Switch a piece's look, keeping its centre where it was.
  const restyle=(e,st)=>{if(e.locked)return e;const k=pageOf(docRef.current.page);const ratio=k[2]/k[3];const n={...e,style:st,shadow:st==='room'?'floor':e.shadow==='floor'?'soft':e.shadow};if(st!=='framed')n.rot=0;
    const w0=wOf(e,bg),w1=wOf(n,bg);n.x=e.x+(w0-w1)/2;n.y=e.y+(w0*ratio/elAR(e)-w1*ratio/elAR(n))/2;return n};
  useEffect(()=>{const k=e=>{if(editorShortcutsBlocked(e))return;
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return}
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='d'){e.preventDefault();dup();return}
    if(e.key==='Escape'){if(pop)setPop(null);else if(sels.length)setSels([]);else setDrawer(null);return}
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='a'){e.preventDefault();setSels(els.filter(x=>!x.hidden).map(x=>x.id));return}
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='g'){e.preventDefault();if(e.shiftKey)ungroup();else if(multi)group();return}
    if(e.key==='0'&&!e.metaKey&&!e.ctrlKey){zoomTo(1);return}
    if((e.key==='+'||e.key==='=')&&!e.metaKey&&!e.ctrlKey){zoomTo(zoomRef.current*1.25);return}
    if(e.key==='-'&&!e.metaKey&&!e.ctrlKey){zoomTo(zoomRef.current/1.25);return}
    if(!sels.length)return;
    if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();del();return}
    const st=e.shiftKey?2:.5;const mv={ArrowLeft:[-st,0],ArrowRight:[st,0],ArrowUp:[0,-st],ArrowDown:[0,st]}[e.key];if(mv){e.preventDefault();commit(els.map(x=>sels.includes(x.id)&&!x.locked?{...x,x:x.x+mv[0],y:x.y+mv[1]}:x))}};
    addEventListener('keydown',k);return()=>removeEventListener('keydown',k)});
  const pieces=els.filter(e=>e.kind==='img'&&!e.hidden).map(e=>productFor(e));
  const total=pieces.reduce((s,p)=>s+pr(p,ctx.mode),0);
  const rows=editorSelections(els.filter(e=>e.kind==='img'),savedCatalog.products);
  const openNew=(next,msg)=>{const prev=docRef.current;hist.current={past:[],future:[]};setSteps(0);dirty.current=true;setDoc({id:uid(),page:prev.page,mode:prev.mode,bg:prev.bg,...next});setSel(null);ctx.toast(msg,{label:'Back to '+prev.title,fn:()=>{dirty.current=false;setDoc(prev)}})};
  // Room view puts every piece on the room photo at true scale; Collage brings room pieces back as cutouts.
  const onView=k=>{if(k==='3d'){ctx.setRoomSeed({ids:els.filter(e=>e.kind==='img'&&!e.hidden).map(editorIdentity),sync:true});ctx.go('room');return}
    commitDoc({...doc,mode:k,els:els.map(x=>x.kind!=='img'?x:k==='room'?(styleOf(x)==='room'?x:restyle(x,'room')):(styleOf(x)==='room'?restyle(x,'cutout'):x))});
    if(k==='room'&&!bg.img){setDrawer('bg');ctx.toast('Add a photo of your space to see the pieces in it')}};
  const pickRail=k=>{setPop(null);if(k==='compose'){setComposeOpen(true);return}setDrawer(d=>d===k?null:k)};
  const W0=BW,H0=boardH(page);
  const dragPoint=(e,i)=>{e.stopPropagation();e.preventDefault();const r=canvasRef.current.getBoundingClientRect();const snap=docRef.current;const pts=[...(snap.poly||POLY0)];let moved=false;
    const mv=ev=>{if(!moved){record(snap);moved=true}dirty.current=true;pts[i]=[Math.max(0,Math.min(1,(ev.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(ev.clientY-r.top)/r.height))];setDoc(d=>({...d,shape:'poly',poly:[...pts]}))};
    const up=()=>{removeEventListener('pointermove',mv)};addEventListener('pointermove',mv);addEventListener('pointerup',up,{once:true})};
  const addPoint=()=>{const p=[...(doc.poly||POLY0)];let best=0,bl=0;p.forEach((a,i)=>{const b=p[(i+1)%p.length];const l=Math.hypot((b[0]-a[0])*W0,(b[1]-a[1])*H0);if(l>bl){bl=l;best=i}});const a=p[best],b=p[(best+1)%p.length];p.splice(best+1,0,[(a[0]+b[0])/2,(a[1]+b[1])/2]);commitDoc({...doc,shape:'poly',poly:p})};
  const setCorner=(i,axis,value)=>{const p=docRef.current.poly||POLY0;commitDoc({...docRef.current,shape:'poly',poly:p.map((point,k)=>k===i?point.map((v,a)=>a===axis?Math.max(0,Math.min(1,value)):v):point)})};
  const removeCorner=(i,canvasFocus=false)=>{const p=docRef.current.poly||POLY0;if(p.length<=3)return;commitDoc({...docRef.current,poly:p.filter((_,k)=>k!==i)});requestAnimationFrame(()=>{const next=Math.min(i,p.length-2);(canvasFocus?document.getElementById(addTabsId+'-corner-'+next):document.getElementById(addTabsId+'-corner-row-'+next)?.querySelector(p.length===4?'input':'button'))?.focus()})};
  const cornerKeys=(e,i)=>{const step=e.shiftKey?.05:.01;const move={ArrowLeft:[0,-step],ArrowRight:[0,step],ArrowUp:[1,-step],ArrowDown:[1,step]}[e.key];if(move){e.preventDefault();e.stopPropagation();const p=docRef.current.poly||POLY0;setCorner(i,move[0],Math.round((p[i][move[0]]+move[1])*10000)/10000)}else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();e.stopPropagation();removeCorner(i,true)}};
  const MATS={...MAT,wood:'Wood'};const types=[...new Set(PRODUCTS.map(p=>p.type))];const mats=[...new Set(PRODUCTS.map(p=>p.mat))];
  const filters=[['all','All'],...types.map(t=>['t:'+t,TYPE[t]||t[0].toUpperCase()+t.slice(1)+'s']),...mats.map(m=>['m:'+m,MATS[m]||m])];
  // The Studio offers pieces that have dimensions and a seamless cutout; the rest are still being prepared.
  const ready=PRODUCTS.filter(p=>p.dimsCm&&p.cutout);const preparing=PRODUCTS.length-ready.length;
  const prods=ready.filter(p=>(pf==='all'||pf==='t:'+p.type||pf==='m:'+p.mat)&&(p.name+' '+p.line+' '+p.mat+' '+p.type).toLowerCase().includes(pq.toLowerCase()));
  const kindName=multi?`${sels.length} items`:S?(S.kind==='img'?'piece':S.kind==='inspo'?'image':S.kind):'';
  const framedSel=S&&(S.kind==='inspo'||(S.kind==='img'&&styleOf(S)==='framed'));
  const selItems=multi?[['align','Align'],...(sels.length>2?[['distribute','Distribute']]:[])]:!S?[]:[
    ...(S.kind==='img'?[['style','Style']]:[]),...(framedSel?[['shape','Shape'],['crop','Crop']]:[]),...(S.kind==='img'||S.kind==='inspo'?[['tone','Tone']]:[]),
    ...(S.kind==='text'?[['text','Text'],['font','Type'],['color','Colour']]:[]),
    ...(S.kind==='swatch'?[['color','Colour']]:[]),
    ['arrange','Arrange']];
  const barStyle=box?(()=>{const above=box.t>64;const x=Math.max(8,Math.min(box.W-8,box.l+box.w/2));return {left:x,top:above?box.t-12:box.t+box.h+12,transform:`translate(-50%,${above?'-100%':'0'})`}})():null;
  return html`<main className="sx studio2"><h1 className="sr">Collage Studio</h1>
    <${SxTop} ctx=${ctx} title=${title} setTitle=${setTitle} view=${mode} onView=${onView} saved=${ctx.me.signedIn?saved:saved==='Saved'?'Saved on this device':saved} onShare=${()=>setShare(true)}>
      <${SxMenu} ctx=${ctx} hist=${{undo,redo,canUndo:hist.current.past.length>0,canRedo:hist.current.future.length>0,steps:hist.current.past.length}}>
        <div className="sx-pop-sec"><span className="sx-lbl">Page size</span>
          <div className="sx-chips">${PAGES.map(([k,l])=>html`<button key=${k} className=${'chip'+(page===k?' on':'')} onClick=${()=>commitDoc({...doc,page:k})}>${l}</button>`)}</div></div>
        <div className="sx-pop-sec"><span className="sx-lbl">This collage</span>
          <button className="pop-item" data-close onClick=${()=>{const copy={...docRef.current,id:uid(),title:(title+' copy').slice(0,TITLE_MAX)};ctx.saveCollage(copy,true);dirty.current=false;setDoc(copy);ctx.toast('Saved as '+copy.title)}}>${I('copy',{width:16})} Save as a copy</button>
          <button className="pop-item" data-close onClick=${()=>setShare(true)}>${I('download',{width:16})} Export and share</button>
          <button className="pop-item" data-close onClick=${()=>openNew({title:'New collage',els:[],mode:'collage',bg:{color:'#EFE6D8',grid:true}},'New collage started')}>${I('plus',{width:16})} New collage</button></div>
      <//>
    <//>
    <${SxRail} items=${[['add','Add','plus'],['layers','Layers','layers'],['board','Board','board'],['bg','Background','img'],['compose','Compose','wand']]} open=${drawer} onPick=${pickRail}/>
    ${drawer==='add'&&html`<${SxDrawer} title="Add" onClose=${()=>setDrawer(null)}>
      <div className="row" style=${{gap:6}}>
        <button className="btn btn-line btn-sm" onClick=${()=>addEl(mkText('Add a title',10,10,7))}>${I('text',{width:15})} Text</button>
        <button className="btn btn-line btn-sm" onClick=${()=>addEl({id:uid(),kind:'swatch',color:'#A65F2C',x:80,y:8,w:8,rot:0,locked:false,hidden:false})}>${I('frame',{width:15})} Swatch</button></div>
      <div className="sx-tabs" role="tablist" aria-label="Add to collage">${STUDIO_TABS.map(([k,l],i)=>html`<button key=${k} id=${addTabsId+'-'+k} role="tab" aria-controls=${addTabsId+'-'+k+'-panel'} aria-selected=${tab===k} tabIndex=${tab===k?0:-1} className=${tab===k?'on':''} onClick=${()=>setTab(k)} onKeyDown=${e=>{const next={ArrowRight:(i+1)%4,ArrowLeft:(i+3)%4,Home:0,End:3}[e.key];if(next===undefined)return;e.preventDefault();setTab(STUDIO_TABS[next][0]);e.currentTarget.parentElement.querySelectorAll('[role=tab]')[next].focus()}}>${l}</button>`)}</div>
      <div role="tabpanel" id=${addTabsId+'-pieces-panel'} aria-labelledby=${addTabsId+'-pieces'} tabIndex="0" hidden=${tab!=='pieces'}>
      ${tab==='pieces'&&html`<${React.Fragment}><input className="field sx-search" placeholder="Search pieces" aria-label="Search pieces" value=${pq} onInput=${e=>setPq(e.target.value)}/>
        <div className="sx-chips scroll-x">${filters.map(([k,l])=>html`<button key=${k} className=${'chip'+(pf===k?' on':'')} onClick=${()=>setPf(k)}>${l}</button>`)}</div>
        <div className="sx-grid">${prods.map(p=>html`<button key=${p.id} className="sx-card" draggable="true" onDragStart=${e=>e.dataTransfer.setData('text/pid',String(p.id))} onClick=${()=>addProduct(p.id)} title=${'Add '+p.name}>
          <span className="sx-card-i"><img src=${cut(p.id)} alt="" loading="lazy"/></span><b>${p.name}</b><span className="num">${fmt(pr(p,ctx.mode))}</span></button>`)}</div>
        ${!prods.length&&html`<p className="sx-note">Nothing matches. Try another word.</p>`}${preparing>0&&html`<p className="sx-note">${preparing} more piece${preparing===1?' is':'s are'} being photographed for the Studio.</p>`}<//>`}
      </div>
      <div role="tabpanel" id=${addTabsId+'-inspo-panel'} aria-labelledby=${addTabsId+'-inspo'} tabIndex="0" hidden=${tab!=='inspo'}>
      ${tab==='inspo'&&html`<${React.Fragment}><p className="sx-note">Inspo carries no price or link and never counts in the total. <button className="lnk" onClick=${()=>ctx.go('inspo')}>Library</button></p>
        ${ctx.inspo.length?html`<div className="sx-grid">${ctx.inspo.map(x=>html`<button key=${x.id} className="sx-card" onClick=${()=>addEl({...mkInspo(x),x:26,y:20,w:44,rot:0})} title=${'Add '+x.title}><span className="sx-card-i photo"><img src=${x.src} alt="" loading="lazy"/></span><b>${x.title}</b></button>`)}</div>`
          :html`<p className="sx-note">No inspo yet. <button className="lnk" onClick=${()=>ctx.go('inspo')}>Upload inspiration</button></p>`}<//>`}
      </div>
      <div role="tabpanel" id=${addTabsId+'-boards-panel'} aria-labelledby=${addTabsId+'-boards'} tabIndex="0" hidden=${tab!=='boards'}>
      ${tab==='boards'&&html`<${React.Fragment}><p className="sx-note">Adds to the canvas; never replaces it.</p>${ctx.boards.map(b=>html`<div key=${b.id} className="sx-board"><div className="row" style=${{justifyContent:'space-between'}}><b>${b.title}</b><button className="lnk" disabled=${!b.pins.length} onClick=${()=>{commit([...els,...b.pins.slice(0,6).map((x,i)=>mkImg(x,i+els.length,mode,SLOTS,mode==='room'?'room':'cutout'))]);ctx.toast(`${Math.min(6,b.pins.length)} pieces added`)}}>Add all</button></div>
        <div className="sx-grid three">${b.pins.map(x=>html`<button key=${projectItemKey(x)} className="sx-card" onClick=${()=>addProduct(x)} title=${'Add '+productFor(x).name}><span className="sx-card-i"><img src=${pieceImage(x)} alt="" loading="lazy"/></span></button>`)}</div></div>`)}<//>`}
      </div>
      <div role="tabpanel" id=${addTabsId+'-ideas-panel'} aria-labelledby=${addTabsId+'-ideas'} tabIndex="0" hidden=${tab!=='ideas'}>
      ${tab==='ideas'&&html`${COMMUNITY.length?html`<div className="sx-grid">${COMMUNITY.map(b=>html`<button key=${b.id} className="sx-card" onClick=${()=>setIdea(b)}><span className="sx-card-i photo" style=${{backgroundImage:`url(${byId(b.items[0]).img})`,backgroundSize:'cover'}}></span><b>${b.title}</b><span>${b.by}</span></button>`)}</div>`
        :html`<p className="sx-note">Community boards appear here as members share them. Compose a board of your own from the wand in the rail.</p>`}`}
      </div>
    <//>`}
    ${drawer==='layers'&&html`<${SxDrawer} title="Layers" onClose=${()=>setDrawer(null)}>
      <p className="sx-note">Top of the list is in front. Select a layer to edit it. Hold Shift while clicking or pressing Enter to select several. Use Arrange to reorder.</p>
      <div className="sx-layers">${layers.map(({e})=>html`<div key=${e.id} className=${'layer sx-layer'+(sels.includes(e.id)?' on':'')+(overL===e.id?' drop':'')} draggable="true" onDragStart=${()=>setDragL(e.id)} onDragOver=${ev=>{ev.preventDefault();setOverL(e.id)}} onDragLeave=${()=>setOverL(null)} onDrop=${()=>{dropLayer(dragL,e.id);setOverL(null)}}>
        <button className="sx-layer-select" aria-label=${'Select '+nameOf(e)} aria-pressed=${sels.includes(e.id)} onClick=${ev=>pick(e.id,ev.shiftKey)}>
        <span className="th" style=${e.kind==='img'?{backgroundImage:`url(${pieceImage(e)})`,backgroundSize:'contain',backgroundRepeat:'no-repeat'}:e.kind==='inspo'?{backgroundImage:`url(${e.src})`}:e.kind==='swatch'?{background:e.color}:{}}>${e.kind==='text'?'T':''}</span>
        <span style=${{opacity:e.hidden?.45:1}}>${nameOf(e)}${e.g&&html` <small className="sx-gtag">Group</small>`}</span></button>
        <button className=${'ib'+(e.hidden?' keep':'')} aria-label=${(e.hidden?'Show ':'Hide ')+nameOf(e)} onClick=${ev=>{ev.stopPropagation();patch(e.id,{hidden:!e.hidden})}}>${I(e.hidden?'eyeoff':'eye')}</button>
        <button className=${'ib'+(e.locked?' keep':'')} aria-label=${(e.locked?'Unlock ':'Lock ')+nameOf(e)} onClick=${ev=>{ev.stopPropagation();patch(e.id,{locked:!e.locked})}}>${I(e.locked?'lock':'unlock')}</button>
        <span className="sx-grip" aria-hidden="true">⋮⋮</span>
      </div>`)}</div>
      ${!els.length&&html`<p className="sx-note">The board is empty. Add a piece from the rail.</p>`}
      ${(S||multi)&&html`<section className="sx-selection" aria-label="Layer properties">
        <b>${multi?sels.length+' selected layers':nameOf(S)}</b>
        ${S&&html`<div className="sx-number-grid">
          ${[['x','Across (%)',-1000,1000,.5],['y','Down (%)',-1000,1000,.5],['rot','Rotation (degrees)',-360,360,1],...(S.kind==='text'?[['size','Text size',2,80,.2]]:[['w','Width (%)',5,1000,.5]])].map(([k,label,min,max,step])=>html`<${EditorNumberField} key=${S.id+k} label=${label} value=${k==='w'?wOf(S,bg):(S[k]||0)} min=${min} max=${max} step=${step} disabled=${!!S.locked||(k==='w'&&!!lockW(S,bg))} onCommit=${value=>patch(S.id,{[k]:value})}/>`)}
        </div>${lockW(S,bg)&&html`<p className="sx-note">Width follows the product's real dimensions and the photo scale.</p>`}${S.locked&&html`<p className="sx-note">Unlock this layer before changing its position, size or rotation.</p>`}
        <div className="sx-property-actions" role="group" aria-label="Arrange">${[['front','Bring to front'],['fwd','Forward'],['bwd','Backward'],['back','Send to back']].map(([to,label])=>html`<button key=${to} className="btn btn-line btn-sm" onClick=${()=>arrange(S.id,to)}>${label}</button>`)}</div>`}
        <div className="sx-property-actions">${multi&&html`<button className="btn btn-line btn-sm" onClick=${grouped?ungroup:group}>${grouped?'Ungroup':'Group'}</button>`}<button className="btn btn-line btn-sm" onClick=${dup}>Duplicate selection</button><button className="btn btn-line btn-sm" onClick=${del}>Delete selection</button></div>
      </section>`}
    <//>`}
    ${drawer==='board'&&html`<${SxDrawer} title="Board" onClose=${()=>{setDrawer(null);setPolyEdit(false)}}>
      <span className="sx-lbl">Shape</span>
      <div className="sx-shapes">${BOARD_SHAPES.map(([k,l])=>html`<button key=${k} className=${(doc.shape||'rect')===k?'on':''} aria-pressed=${(doc.shape||'rect')===k} onClick=${()=>{commitDoc({...doc,shape:k,poly:k==='poly'?(doc.poly||POLY0):doc.poly});setPolyEdit(k==='poly')}}>
        <svg viewBox="0 0 80 100" aria-hidden="true"><path d=${boardPath(k,80,100,doc.poly)}/></svg><span>${l}</span></button>`)}</div>
      ${doc.shape==='poly'&&html`<div className="sx-col" style=${{gap:8}}><span className="sx-note">Drag a corner, use its arrow keys (Shift for larger steps), or enter coordinates below. Delete removes a focused corner; at least three must remain.</span>
        <div className="row" style=${{gap:6}}><button className="btn btn-line btn-sm" onClick=${()=>setPolyEdit(!polyEdit)}>${polyEdit?'Done shaping':'Edit points'}</button><button className="btn btn-line btn-sm" disabled=${(doc.poly||POLY0).length>=64} onClick=${addPoint}>Add a point</button><button className="lnk" onClick=${()=>commitDoc({...doc,poly:POLY0})}>Reset</button></div>
        <div className="sx-corner-fields">${(doc.poly||POLY0).map((point,i)=>html`<fieldset key=${i} id=${addTabsId+'-corner-row-'+i} className="sx-selection"><legend>Corner ${i+1}</legend><div className="sx-number-grid">${[[0,'Across (%)'],[1,'Down (%)']].map(([axis,label])=>html`<${EditorNumberField} key=${axis} label=${label} value=${Math.round(point[axis]*10000)/100} min=${0} max=${100} step=${1} onCommit=${value=>setCorner(i,axis,value/100)}/>`)}
        </div><button className="btn btn-line btn-sm" disabled=${(doc.poly||POLY0).length<=3} onClick=${()=>removeCorner(i)}>Remove corner ${i+1}</button></fieldset>`)}</div></div>`}
      <span className="sx-lbl">Edge</span>
      <div className="sx-chips">${EDGES.map(([k,l])=>html`<button key=${k} className=${'chip'+((doc.edge||'none')===k?' on':'')} onClick=${()=>commitDoc({...doc,edge:k})}>${l}</button>`)}</div>
      ${doc.edge==='thick'&&html`<div className="swatches">${EDGE_COLORS.map(c=>html`<button key=${c} style=${{background:c}} className=${(doc.edgeColor||'#FBF8F2')===c?'on':''} aria-label=${'Border colour '+c} onClick=${()=>commitDoc({...doc,edgeColor:c})}></button>`)}</div>`}
      <p className="sx-note">The shape and edge are saved with the collage and used by every export. Page size is in the ⋯ menu.</p>
    <//>`}
    ${drawer==='bg'&&html`<${SxDrawer} title="Background" onClose=${()=>setDrawer(null)}>
      <div className="swatches">${BGS.map(([n,c])=>html`<button key=${c} title=${n} aria-label=${n+' background'} className=${bg.color===c&&!bg.img?'on':''} style=${{background:c}} onClick=${()=>setBg({color:c,grid:bg.grid})}></button>`)}</div>
      <button className="toggle" disabled=${!!bg.img} onClick=${()=>setBg({...bg,grid:!bg.grid})}><span>Dot grid</span><span className=${'sw'+(bg.grid&&!bg.img?' on':'')}></span></button>
      <button className="btn btn-line btn-sm" style=${{justifySelf:'start'}} onClick=${()=>bgRef.current.click()}>${I('upload',{width:15})} Use a photo of my space</button>
      <input ref=${bgRef} type="file" accept="image/*" hidden onChange=${e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{const d=docRef.current;commitDoc({...d,bg:{img:r.result,widthM:d.bg.widthM},mode:'room',els:d.els.map(x=>x.kind==='img'&&styleOf(x)!=='room'?restyle(x,'room'):x)})};r.readAsDataURL(f);e.target.value=''}}/>
      ${bg.img&&html`<${React.Fragment}><label className="sx-col" style=${{gap:4}}><span className="sx-lbl">How wide is the wall in this photo?</span>
          <span className="row" style=${{gap:8}}><input className="field num" style=${{height:38,width:110}} type="number" min="0.5" max="40" step="0.1" placeholder="e.g. 4.2" value=${bg.widthM||''} onChange=${e=>setBg({...bg,widthM:+e.target.value||undefined})} aria-label="Photo width in metres"/><span className="sx-note">metres</span></span>
          <span className="sx-note">${bg.widthM?'Pieces in the room view are drawn at their real width.':'Give the width and pieces in the room view are drawn at true scale.'}</span></label>
        <button className="lnk" style=${{justifySelf:'start'}} onClick=${()=>setBg({color:'#EFE6D8',grid:true})}>Remove photo</button><//>`}
      ${ctx.inspo.length>0&&html`<${React.Fragment}><span className="sx-lbl">From your inspo</span><div className="sx-grid three">${ctx.inspo.slice(0,9).map(x=>html`<button key=${x.id} className="sx-card" title=${'Use '+x.title} onClick=${()=>setBg({img:x.src})}><span className="sx-card-i photo"><img src=${x.src} alt=""/></span></button>`)}</div><//>`}
    <//>`}

    <section className=${'sx-stagewrap'+(S?' has-sel':'')} ref=${wrapRef}>
      <div className="sx-stage" ref=${stageRef} onPointerDown=${()=>{setSels([]);setPop(null)}}>
        <div className=${'sx-board edge-'+(doc.edge||'none')} style=${{width:fitW*zoom,aspectRatio:`${P[2]}/${P[3]}`}}>
        <div className=${'canvas sx-canvas'+(bg.grid&&!bg.img?' grid':'')} ref=${canvasRef} style=${{...bgStyle(bg),...maskOf(doc.shape,W0,H0,doc.poly)}} onDragOver=${e=>e.preventDefault()} onDrop=${dropOnCanvas}>
          ${els.map((e,i)=>e.hidden?null:html`<div key=${e.id} data-id=${e.id} className=${'el'+(sels.includes(e.id)?' sel':'')+(blends(e,savedCatalog.products)?' blend':'')} style=${{...elStyle(e,i,bg,savedCatalog.products),cursor:e.locked?'default':'move'}} onPointerDown=${ev=>onDown(ev,e)} onDoubleClick=${()=>{if(e.kind==='text')setPop('text')}}>
            <${ElView} e=${e} products=${savedCatalog.products}/>
            ${S&&sel===e.id&&!e.locked&&html`<${React.Fragment}>${!lockW(e,bg)&&html`<span className="h h-rs" onPointerDown=${ev=>onDown(ev,e,'rs')}></span>`}<span className="h h-rot" onPointerDown=${ev=>onDown(ev,e,'rot')}></span><//>`}
          </div>`)}
          ${guides&&html`<${React.Fragment}>${guides.gx.map(x=>html`<i key=${'x'+x} className="sx-guide v" style=${{left:x+'%'}}></i>`)}${guides.gy.map(y=>html`<i key=${'y'+y} className="sx-guide h" style=${{top:y+'%'}}></i>`)}
            ${guides.gap&&(guides.gap.kind==='x'?[[guides.gap.a,guides.gap.b],[guides.gap.c,guides.gap.d]].map(([a,b],k)=>html`<i key=${'g'+k} className="sx-gap h" style=${{left:a+'%',width:(b-a)+'%',top:guides.gap.at+'%'}}></i>`)
              :[[guides.gap.a,guides.gap.b],[guides.gap.c,guides.gap.d]].map(([a,b],k)=>html`<i key=${'g'+k} className="sx-gap v" style=${{top:a+'%',height:(b-a)+'%',left:guides.gap.at+'%'}}></i>`))}<//>`}
        </div>
        <${BoardEdge} doc=${doc}/>
        ${polyEdit&&doc.shape==='poly'&&html`<svg className="sx-poly" viewBox=${`0 0 ${W0} ${H0}`} preserveAspectRatio="none" aria-hidden="true"><path d=${boardPath('poly',W0,H0,doc.poly)}/></svg>
          ${(doc.poly||POLY0).map(([x,y],i)=>html`<button key=${i} className="sx-pt" style=${{left:x*100+'%',top:y*100+'%'}} id=${addTabsId+'-corner-'+i} aria-label=${'Corner point '+(i+1)+', '+Math.round(x*100)+'% across, '+Math.round(y*100)+'% down'} onKeyDown=${e=>cornerKeys(e,i)} onPointerDown=${e=>dragPoint(e,i)} onDoubleClick=${()=>removeCorner(i,true)}></button>`)}`}
        </div>
      </div>
      ${(S||multi)&&barStyle&&html`<div className="sx-selbar" style=${barStyle} onPointerDown=${e=>e.stopPropagation()} role="toolbar" aria-label=${'Edit '+kindName}>
        ${selItems.map(([k,l])=>html`<button key=${k} className=${pop===k?'on':''} aria-expanded=${pop===k} onClick=${()=>setPop(pop===k?null:k)}>${l}</button>`)}
        ${multi&&html`<button onClick=${grouped?ungroup:group} title=${grouped?'Ungroup (Ctrl+Shift+G)':'Group (Ctrl+G)'}>${grouped?'Ungroup':'Group'}</button>`}
        <button onClick=${dup} aria-label="Duplicate" title="Duplicate (Ctrl+D)">${I('copy',{width:16})}</button>
        <button onClick=${del} aria-label="Delete" title="Delete">${I('trash',{width:16})}</button>
        ${pop&&(S||['align','distribute'].includes(pop))&&html`<div className="sx-selpop">
          ${pop==='align'&&html`<div className="sx-col">${[['left','Left edges'],['centre','Centres'],['right','Right edges'],['top','Tops'],['middle','Middles'],['bottom','Bottoms']].map(([k,l])=>html`<button key=${k} className="pop-item" onClick=${()=>align(k)}>Align ${l.toLowerCase()}</button>`)}</div>`}
          ${pop==='distribute'&&html`<div className="sx-col"><button className="pop-item" onClick=${()=>distribute('x')}>Space evenly across</button><button className="pop-item" onClick=${()=>distribute('y')}>Space evenly down</button></div>`}
          ${pop==='style'&&S?.kind==='img'&&html`<${React.Fragment}>
            <div className="sx-looks" role="radiogroup" aria-label="Look">${LOOKS.map(([k,l,hint])=>{const off=k==='3d'||(k==='room'&&!bg.img);const on=styleOf(S)===k;
              return html`<button key=${k} role="radio" aria-checked=${on} className=${on?'on':''} disabled=${off} onClick=${()=>!on&&commit(els.map(x=>x.id===S.id?restyle(x,k):x))}><b>${l}</b><span>${k==='3d'?'Model coming soon':k==='room'&&!bg.img?'Add a room photo in Background':hint}</span></button>`})}</div>
            ${styleOf(S)!=='framed'?html`<${React.Fragment}><span className="sx-lbl">Shadow</span><div className="seg">${[['none','None'],['soft','Soft'],['floor','Floor']].map(([k,l])=>html`<button key=${k} className=${(S.shadow||'soft')===k?'on':''} onClick=${()=>patch(S.id,{shadow:k})}>${l}</button>`)}</div>
              <button className="toggle" onClick=${()=>patch(S.id,{flip:!S.flip})}><span>Flip</span><span className=${'sw'+(S.flip?' on':'')}></span></button>
              ${!geometry.hasCutout(S)&&html`<span className="sx-note">This piece has no studio cutout yet, so its photo blends onto the board.</span>`}<//>`
            :html`<${React.Fragment}><span className="sx-lbl">Border</span><div className="seg">${[['none','None'],['white','White'],['hairline','Hairline']].map(([k,l])=>html`<button key=${k} className=${borderOf(S)===k?'on':''} onClick=${()=>patch(S.id,{border:k})}>${l}</button>`)}</div>
              <span className="sx-lbl">Tilt</span><div className="seg">${[-4,-2,0,2,4].map(t=>html`<button key=${t} className=${Math.round(S.rot)===t?'on':''} onClick=${()=>patch(S.id,{rot:t})}>${t>0?'+'+t:t}°</button>`)}</div><//>`}
            <button className="toggle" onClick=${()=>patch(S.id,{motion:!S.motion})}><span>Gentle motion</span><span className=${'sw'+(S.motion?' on':'')}></span></button>
            <button className="lnk" style=${{justifySelf:'start'}} onClick=${()=>ctx.openPin(S.pid,{pid:S.pid,lid:S.lid,vid:S.vid})}>View ${productFor(S).name} details</button><//>`}
          ${pop==='crop'&&framedSel&&html`<${React.Fragment}>${[['z','Zoom',1,3,.05,1],['x','Across',0,100,1,50],['y','Up and down',0,100,1,50]].map(([k,l,mn,mx,st,d])=>html`<label key=${k} className="sx-range"><span className="sx-lbl">${l}</span><input type="range" min=${mn} max=${mx} step=${st} value=${(S.crop||{})[k]??d} onPointerDown=${()=>record(docRef.current)} onKeyDown=${rangeKeys} onInput=${e=>live(S.id,{crop:{z:1,x:50,y:50,...S.crop,[k]:+e.target.value}})}/></label>`)}
            <button className="lnk" style=${{justifySelf:'start'}} onClick=${()=>patch(S.id,{crop:undefined})}>Reset crop</button><//>`}
          ${pop==='shape'&&html`<div className="seg">${SHAPES.map(([k,l])=>html`<button key=${k} className=${S.shape===k?'on':''} onClick=${()=>patch(S.id,{shape:k})}>${l}</button>`)}</div>`}
          ${pop==='tone'&&html`<div className="seg">${['none','warm','mono','dusk'].map(t=>html`<button key=${t} className=${S.tone===t?'on':''} onClick=${()=>patch(S.id,{tone:t})}>${t==='none'?'Original':t[0].toUpperCase()+t.slice(1)}</button>`)}</div>`}
          ${pop==='text'&&html`<textarea className="field" rows="2" aria-label="Text" value=${S.text} onFocus=${()=>record(docRef.current)} onInput=${e=>live(S.id,{text:e.target.value})}></textarea>`}
          ${pop==='font'&&html`<${React.Fragment}><div className="seg">${[['display','Serif'],['sans','Sans'],['mono','Caps']].map(([k,l])=>html`<button key=${k} className=${S.font===k?'on':''} onClick=${()=>patch(S.id,{font:k})}>${l}</button>`)}</div>
            <label className="sx-range"><span className="sx-lbl">Size</span><input type="range" min="2" max="16" step=".2" value=${S.size} onPointerDown=${()=>record(docRef.current)} onKeyDown=${rangeKeys} onInput=${e=>live(S.id,{size:+e.target.value})}/></label><//>`}
          ${pop==='color'&&html`<div className="swatches">${['#2B211A','#FBF8F2','#A65F2C','#6C6948','#AE884C','#B07A4A','#E7DFD0'].map(c=>html`<button key=${c} style=${{background:c}} className=${S.color===c?'on':''} aria-label=${'Colour '+c} onClick=${()=>patch(S.id,{color:c})}></button>`)}</div>`}
          ${pop==='arrange'&&S&&html`<div className="sx-col">
            <button className="pop-item" onClick=${()=>arrange(S.id,'front')}>${I('up',{width:15})} Bring to front</button>
            <button className="pop-item" onClick=${()=>arrange(S.id,'fwd')}>Forward</button>
            <button className="pop-item" onClick=${()=>arrange(S.id,'bwd')}>Backward</button>
            <button className="pop-item" onClick=${()=>arrange(S.id,'back')}>${I('down',{width:15})} Send to back</button>
            <button className="pop-item" onClick=${()=>patch(S.id,{locked:!S.locked})}>${I(S.locked?'unlock':'lock',{width:15})} ${S.locked?'Unlock':'Lock in place'}</button></div>`}
        </div>`}
      </div>`}
      <div className="sx-zoom" role="group" aria-label="Zoom">
        <button className="ib" aria-label="Zoom out" onClick=${()=>zoomTo(zoom/1.25)} disabled=${zoom<=ZMIN}>${I('minus',{width:15})}</button>
        <button className="sx-zoom-v num" title="Zoom to fit (0)" onClick=${()=>zoomTo(1)}>${Math.round(zoom*100)}%</button>
        <button className="ib" aria-label="Zoom in" onClick=${()=>zoomTo(zoom*1.25)} disabled=${zoom>=ZMAX}>${I('plus',{width:15})}</button>
      </div>
      <${SxPill} ctx=${ctx} count=${pieces.length} total=${total} onOpen=${()=>setTraySheet(true)}/>
    </section>

    ${traySheet&&html`<${SxTray} ctx=${{...ctx,savedProducts:savedCatalog.products}} rows=${rows} onClose=${()=>setTraySheet(false)}/>`}
    ${composeOpen&&html`<${ComposeDialog} catalogComplete=${ctx.catalogComplete} mode=${mode} page=${page} bg=${bg} onClose=${()=>setComposeOpen(false)} onUse=${(p,draft)=>{setComposeOpen(false);openNew({title:(p.charAt(0).toUpperCase()+p.slice(1)).slice(0,TITLE_MAX),els:draft},'Opened as a new collage')}}/>`}
    ${idea&&html`<${SxDialog} title=${idea.title} onClose=${()=>setIdea(null)}>
      <${BoardPreview} els=${idea.items.map((id,i)=>mkImg(id,i,'collage')).concat([mkText(idea.title,6,88,4.6)])} bg=${{color:'#EFE6D8',grid:true}} page="portrait"/>
      <p className="sx-note">By ${idea.by}. Remixing opens a new collage; this one stays as it is.</p>
      <button className="btn btn-cog btn-sm" style=${{justifySelf:'start'}} onClick=${()=>{const t=idea.title;const items=idea.items;setIdea(null);openNew({title:(t+' (remix)').slice(0,TITLE_MAX),els:items.map((id,i)=>mkImg(id,i,'collage')).concat([mkText(t,6,88,4.6)])},'Opened as a new collage')}}>Remix as a new collage</button>
    <//>`}
    ${share&&html`<${ShareSheet} ctx=${ctx} title=${title} doc=${doc} ids=${pieces.map(p=>p.id)} boardKey=${doc.id} onClose=${()=>setShare(false)}/>`}
  </main>`;
}

// Compose: a prompt, then three drafts to choose from. The chosen one opens as a new collage.
function ComposeDialog({mode,page,bg,onClose,onUse,catalogComplete=true}){
  const [p,setP]=useState('');const [drafts,setDrafts]=useState(null);const [pick,setPick]=useState(0);
  const run=q=>{if(!catalogComplete)return;q=(q??p).trim();if(!q)return;setP(q);setDrafts([0,1,2].map(v=>compose(q,mode,v)));setPick(0)};
  return html`<${SxDialog} title="Compose" wide onClose=${onClose}>
    <form className="sx-compose" onSubmit=${e=>{e.preventDefault();run()}}>
      <input className="field" autoFocus aria-label="Describe a style, material or colour" placeholder="A style, texture, material or colour" value=${p} onInput=${e=>setP(e.target.value)}/>
      <button disabled=${!catalogComplete} className="btn btn-cog btn-sm">${I('wand',{width:15})} Compose</button></form>
    <div className="sx-chips">${['cognac leather café','olive velvet bistro','bouclé lobby','rattan coffee bar','brass lounge'].map(c=>html`<button type="button" key=${c} className="chip" disabled=${!catalogComplete} onClick=${()=>run(c)}>${c}</button>`)}</div>
    ${!catalogComplete&&html`<p role="status">The catalog is still loading. Your current collage and description are preserved.</p>`}
    ${drafts&&catalogComplete?html`<${React.Fragment}><div className="sx-drafts" role="radiogroup" aria-label="Drafts">${drafts.map((d,i)=>html`<button key=${i} role="radio" aria-checked=${pick===i} className=${'sx-draft'+(pick===i?' on':'')} onClick=${()=>setPick(i)}><${BoardPreview} els=${d} bg=${bg.img?{color:'#EFE6D8',grid:true}:bg} page=${page}/><span>Draft ${i+1}</span></button>`)}</div>
      <div className="row" style=${{justifyContent:'space-between',flexWrap:'wrap',gap:8}}><span className="sx-note">Opens as a new collage. The one you are working on stays saved.</span><button className="btn btn-cog btn-sm" onClick=${()=>onUse(p,drafts[pick])}>Use this</button></div><//>`
      :html`<p className="sx-note">Describe a look and we'll draft three boards from the House catalog.</p>`}
  <//>`;
}


/* ================= EXPORTS: board images, Story templates, PDF ================= */
// Exports are drawn in the browser from the same collage the canvas shows, at fixed sizes, so a
// board looks the same wherever it lands. Catalog photos load with CORS; one that can't is left
// out rather than tainting the canvas.
const imgCache=new Map();

function loadImg(src){if(!src)return Promise.resolve(null);if(imgCache.has(src))return imgCache.get(src);
  const p=new Promise(res=>{const im=new Image();if(!/^data:|^blob:/.test(src))im.crossOrigin='anonymous';im.decoding='async';im.onload=()=>res(im);im.onerror=()=>res(null);im.src=src});imgCache.set(src,p);return p}

const absUrl=u=>!u||/^(https?:|data:|blob:)/.test(u)?u:new URL(u,location.origin+'/trade/').href;

const FONTS={display:'Newsreader, Georgia, serif',sans:'"DM Sans", system-ui, sans-serif',mono:'"DM Sans", system-ui, sans-serif'};

async function fontsReady(){try{await Promise.all(['italic 400 40px Newsreader','400 40px Newsreader','400 20px "DM Sans"','500 20px "DM Sans"'].map(f=>document.fonts.load(f)));await document.fonts.ready}catch(e){}}

// Frame outlines for framed photos, matching the CSS shapes.
function framePath(g,shape,w,h){const r=shape==='circle'||shape==='oval'?null:shape==='arch'?w/2:shape==='pill'?Math.min(w,h)/2:shape==='rounded'?Math.min(w,h)*.12:Math.min(w,h)*.012;
  g.beginPath();if(shape==='circle'||shape==='oval'){g.ellipse(w/2,h/2,w/2,h/2,0,0,Math.PI*2);return}
  if(shape==='arch'){g.moveTo(0,h);g.lineTo(0,r);g.arc(w/2,r,w/2,Math.PI,0);g.lineTo(w,h-Math.min(w,h)*.03);g.lineTo(w,h);g.closePath();return}
  g.roundRect(0,0,w,h,r)}

function drawCover(g,im,w,h,crop){const z=crop?.z||1,px=(crop?.x??50)/100,py=(crop?.y??50)/100;const s=Math.max(w/im.width,h/im.height)*z;const dw=im.width*s,dh=im.height*s;g.drawImage(im,(w-dw)*px,(h-dh)*py,dw,dh)}

function wrapLines(g,text,max){const out=[];String(text).split('\n').forEach(par=>{let line='';par.split(/(\s+)/).forEach(word=>{const t=line+word;if(g.measureText(t).width>max&&line.trim()){out.push(line.trimEnd());line=word.trimStart()}else line=t});out.push(line)});return out}

const svgImg=svg=>loadImg('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg));

// The board edge, drawn from the same SVG the canvas shows.
function edgeSvg(doc,W,H){const d=boardPath(doc.shape,BW,boardH(doc.page),doc.poly);const e=doc.edge;const inner=e==='hairline'?`<path d="${d}" fill="none" stroke="#2B211A" stroke-width="2.5"/>`:e==='thick'?`<path d="${d}" fill="none" stroke="${doc.edgeColor||'#FBF8F2'}" stroke-width="44" clip-path="url(#c)"/>`:e==='deckle'?`<g clip-path="url(#c)"><path d="${d}" fill="none" stroke="#FBF8F2" stroke-width="56" filter="url(#f)"/></g>`:'';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${BW} ${boardH(doc.page)}" preserveAspectRatio="none"><defs><clipPath id="c"><path d="${d}"/></clipPath><filter id="f"><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="3" seed="3"/><feDisplacementMap in="SourceGraphic" scale="14"/></filter></defs>${inner}</svg>`}

/**
 * Draws a collage at width W (height from its page size). Outside a shaped board stays
 * transparent unless a ground colour is given.
 */
async function renderBoard(doc,W,{ground=null,products=BY_ID}={}){
  const geometry=studioGeometry(products);const {elementAspect:elAR,width:wOf}=geometry;
  await fontsReady();const P=pageOf(doc.page);const H=Math.round(W*P[3]/P[2]);const k=W/100;
  const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');
  if(ground){g.fillStyle=ground;g.fillRect(0,0,W,H)}
  const sx=W/BW,sy=H/boardH(doc.page);const outline=new Path2D(boardPath(doc.shape,BW,boardH(doc.page),doc.poly));
  g.save();g.scale(sx,sy);g.clip(outline);g.setTransform(1,0,0,1,0,0);
  const bg=doc.bg||{color:'#EFE6D8'};
  if(bg.img){const im=await loadImg(absUrl(bg.img));if(im)drawCover(g,im,W,H)}else{g.fillStyle=bg.color||'#EFE6D8';g.fillRect(0,0,W,H);
    if(bg.grid){const step=W*18/560,r=Math.max(.6,W*.0018);g.fillStyle='rgba(43,33,26,.18)';for(let y=step/2;y<H;y+=step)for(let x=step/2;x<W;x+=step){g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill()}}}
  for(const e of doc.els){if(e.hidden)continue;const x=e.x/100*W,y=e.y/100*H;g.save();
    if(e.kind==='text'){const size=e.size*k;g.font=`${e.font==='display'?'italic ':''}400 ${size}px ${FONTS[e.font]||FONTS.display}`;g.fillStyle=e.color;g.textBaseline='top';
      const txt=e.font==='mono'?String(e.text).toUpperCase():e.text;if('letterSpacing' in g)g.letterSpacing=e.font==='mono'?size*.08+'px':-size*.01+'px';
      const lines=wrapLines(g,txt,88*k);const tw=Math.max(...lines.map(l=>g.measureText(l).width)),th=lines.length*size;
      g.translate(x+tw/2,y+th/2);g.rotate((e.rot||0)*Math.PI/180);lines.forEach((l,i)=>g.fillText(l,-tw/2,-th/2+i*size));g.restore();continue}
    if(e.kind==='swatch'){const d=e.w*k;g.translate(x+d/2,y+d/2);g.beginPath();g.arc(0,0,d/2+.6*k,0,Math.PI*2);g.fillStyle='#FFFDF9';g.fill();g.beginPath();g.arc(0,0,d/2,0,Math.PI*2);g.fillStyle=e.color;g.fill();g.restore();continue}
    const w=wOf(e,bg)*k,h=w/elAR(e);g.translate(x+w/2,y+h/2);g.rotate((e.rot||0)*Math.PI/180);g.translate(-w/2,-h/2);
    const framed=e.kind==='inspo'||styleOf(e)==='framed';
    const src=e.kind==='inspo'?e.src:framed?geometry.product(e).img:(geometry.product(e).cutout||geometry.product(e).img);const im=await loadImg(absUrl(src));
    if(framed){const b=borderOf(e),ring=b==='white'?1.4*k:b==='hairline'?.25*k:0;
      g.save();g.shadowColor='rgba(0,0,0,.35)';g.shadowBlur=3*k;g.shadowOffsetY=1.4*k;g.translate(-ring,-ring);framePath(g,e.shape,w+2*ring,h+2*ring);g.fillStyle=b==='hairline'?'#2B211A':b==='white'?'#FFFDF9':'#E5D8C4';g.fill();g.restore();
      framePath(g,e.shape,w,h);g.clip();g.fillStyle='#E5D8C4';g.fillRect(0,0,w,h);if(im){g.filter=toneF[e.tone]||'none';drawCover(g,im,w,h,e.crop)}}
    else{const sh=e.shadow||(styleOf(e)==='room'?'floor':'soft');const real=geometry.hasCutout(e);
      if(sh==='floor'||(sh==='soft'&&!real)){const gr=g.createRadialGradient(w/2,h*1.0,0,w/2,h*1.0,w*.43);gr.addColorStop(0,'rgba(35,22,12,.32)');gr.addColorStop(1,'rgba(35,22,12,0)');g.save();g.translate(0,h);g.scale(1,.09);g.translate(0,-h);g.fillStyle=gr;g.fillRect(0,h-w*.43,w,w*.86);g.restore()}
      if(im){if(!real)g.globalCompositeOperation='multiply';if(sh==='soft'&&real){g.shadowColor='rgba(35,22,12,.26)';g.shadowBlur=2*k;g.shadowOffsetY=1.2*k}
        g.filter=toneF[e.tone]||'none';if(e.flip){g.translate(w,0);g.scale(-1,1)}const s=Math.min(w/im.width,h/im.height);g.drawImage(im,(w-im.width*s)/2,(h-im.height*s)/2,im.width*s,im.height*s)}}
    g.restore()}
  g.restore();
  if(doc.edge&&!['none','shadow'].includes(doc.edge)){const ed=await svgImg(edgeSvg(doc,W,H));if(ed)g.drawImage(ed,0,0,W,H)}
  return c;
}

// A small QR code (qrcode-generator, loaded on demand) drawn on a white tile.
async function drawQR(g,text,x,y,size){const {default:qrcode}=await import('qrcode-generator');const q=qrcode(0,'M');q.addData(text);q.make();const n=q.getModuleCount(),pad=size*.08,cell=(size-2*pad)/n;
  g.fillStyle='#FFFFFF';g.beginPath();g.roundRect(x,y,size,size,size*.06);g.fill();g.fillStyle='#2B211A';for(let r=0;r<n;r++)for(let col=0;col<n;col++)if(q.isDark(r,col))g.fillRect(x+pad+col*cell,y+pad+r*cell,Math.ceil(cell),Math.ceil(cell))}

const canvasBlob=(c,type='image/png',q=.92)=>new Promise((res,rej)=>{try{c.toBlob(b=>b?res(b):rej(new Error('The image could not be made.')),type,q)}catch(e){rej(new Error('One of the photos blocks downloads. Remove it and try again.'))}});

function saveBlob(blob,name){const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000)}

const fileName=(t,ext)=>(String(t||'board').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase()||'board')+'.'+ext;


/* ---------- Story, Pin and post templates ---------- */
// Instagram draws its own controls over a Story's top 250 px and the link sticker over the bottom 340 px.
const STORY={w:1080,h:1920,top:250,bottom:340};

const STORY_SINGLE=[['plaster','Plaster'],['espresso','Espresso'],['arch','Arch frame'],['scene','Room scene']];

const STORY_BOARD=[['bleed','Full bleed'],['card','Framed card'],['grid','Grid of pieces'],['before','Before / after']];

const GROUNDS=['#EFE6D8','#E1D2BB','#F4EFE6','#6C6948','#9A5A2E','#2B211A'];

const isDark=hex=>{const n=parseInt(String(hex).slice(1),16);return ((n>>16)*299+((n>>8)&255)*587+(n&255)*114)/1000<128};

function pillText(g,text,cx,y,{fg,bg,size=34}){g.font=`500 ${size}px ${FONTS.sans}`;const tw=g.measureText(text).width;const w=tw+size*1.8,h=size*2;g.fillStyle=bg;g.beginPath();g.roundRect(cx-w/2,y,w,h,h/2);g.fill();g.fillStyle=fg;g.textAlign='center';g.textBaseline='middle';g.fillText(text,cx,y+h/2);g.textAlign='left'}

function centred(g,text,cx,y,font,color,max){g.font=font;g.fillStyle=color;g.textAlign='center';g.textBaseline='top';const lines=wrapLines(g,text,max);const lh=parseFloat(font.match(/(\d+)px/)[1])*1.15;lines.slice(0,3).forEach((l,i)=>g.fillText(l,cx,y+i*lh));g.textAlign='left';return y+Math.min(3,lines.length)*lh}

async function drawCutout(g,pid,cx,bottom,maxW,maxH,shadow=true,productLookup=byId){const p=productLookup(pid);const im=await loadImg(absUrl(p.cutout||p.img));if(!im)return;const s=Math.min(maxW/im.width,maxH/im.height);const w=im.width*s,h=im.height*s;
  if(shadow){const gr=g.createRadialGradient(cx,bottom,0,cx,bottom,w*.45);gr.addColorStop(0,'rgba(35,22,12,.3)');gr.addColorStop(1,'rgba(35,22,12,0)');g.save();g.translate(0,bottom);g.scale(1,.1);g.translate(0,-bottom);g.fillStyle=gr;g.fillRect(cx-w/2,bottom-w*.45,w,w*.9);g.restore()}
  g.save();if(!p.cutout)g.globalCompositeOperation='multiply';g.drawImage(im,cx-w/2,bottom-h,w,h);g.restore()}

/**
 * Draws a Story (1080 × 1920) or a Pin/post image. `t` is the template, `o` the user's choices:
 * ground colour, caption, prices on or off, the piece for single-product templates.
 */
async function renderStory(doc,o){await fontsReady();
  const byId=o.productLookup||((id)=>displayProduct(BY_ID,+id));
  const drawPiece=(...args)=>drawCutout(...args.slice(0,6),args[6]??true,byId);
  const size=o.size||STORY;const {w:W,h:H}=size;const top=size.top||0,bot=size.bottom||0;
  const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');
  const ground=o.ground||'#EFE6D8';const dark=isDark(ground);const ink=dark?'#FBF8F2':'#2B211A',soft=dark?'rgba(251,248,242,.72)':'rgba(43,33,26,.66)';
  g.fillStyle=ground;g.fillRect(0,0,W,H);const area={y:top,h:H-top-bot};const cx=W/2;
  if(o.kind==='single'){const p=byId(o.pid);const t=o.t;
    if(t==='espresso'){g.fillStyle='#2B211A';g.fillRect(0,0,W,H)}
    const fg=t==='espresso'?'#FBF8F2':ink,sub=t==='espresso'?'rgba(251,248,242,.72)':soft;
    if(t==='arch'){const aw=W*.78,ah=area.h*.62,ax=cx-aw/2,ay=area.y+area.h*.04;g.fillStyle=dark?'rgba(255,255,255,.08)':'#E1D2BB';g.beginPath();g.moveTo(ax,ay+ah);g.lineTo(ax,ay+aw/2);g.arc(cx,ay+aw/2,aw/2,Math.PI,0);g.lineTo(ax+aw,ay+ah);g.closePath();g.fill();
      await drawPiece(g,o.pid,cx,ay+ah-ah*.08,aw*.86,ah*.6)}
    else if(t==='scene'){const fy=area.y+area.h*.56;if(doc?.bg?.img){const im=await loadImg(absUrl(doc.bg.img));if(im){g.save();g.beginPath();g.rect(0,area.y,W,area.h*.66);g.clip();drawCover(g,im,W,area.h*.66);g.restore()}}
      else{g.fillStyle=dark?'rgba(255,255,255,.06)':'#E6DBC9';g.fillRect(0,area.y,W,fy-area.y);g.fillStyle=dark?'rgba(0,0,0,.18)':'#D9CBB4';g.fillRect(0,fy,W,area.h*.1)}
      await drawPiece(g,o.pid,cx,fy+area.h*.05,W*.84,area.h*.44)}
    else await drawPiece(g,o.pid,cx,area.y+area.h*.6,W*.86,area.h*.52);
    let y=area.y+area.h*.66;y=centred(g,p.name,cx,y,`italic 400 84px ${FONTS.display}`,fg,W*.86);
    y=centred(g,o.caption||p.line,cx,y+12,`400 34px ${FONTS.sans}`,sub,W*.8);
    if(o.prices)y=centred(g,fmt(pr(p,'retail')),cx,y+10,`400 40px ${FONTS.display}`,fg,W);
    pillText(g,'Shop on Louie Mae',cx,Math.min(y+28,area.y+area.h-80),{fg:t==='espresso'?'#2B211A':dark?'#2B211A':'#FBF8F2',bg:t==='espresso'||dark?'#FBF8F2':'#2B211A'});
    return c}
  // Whole collage
  const t=o.t;const ids=o.ids||doc.els.filter(e=>e.kind==='img'&&!e.hidden).map(e=>e.pid);const n=ids.length;
  const board=o.board||await renderBoard(doc,1080*2,{products:o.products||BY_ID});const bw=board.width,bh=board.height;
  const titleBlock=async y=>{y=centred(g,o.caption||o.title||doc?.title||'',cx,y,`italic 400 72px ${FONTS.display}`,ink,W*.86);y=centred(g,`${n} piece${n===1?'':'s'}${o.prices&&n?' · '+fmt(ids.map(byId).reduce((s,p)=>s+pr(p,'retail'),0)):''}`,cx,y+8,`400 32px ${FONTS.sans}`,soft,W);return y};
  if(t==='bleed'){const s=Math.min(W/bw,(area.h*.8)/bh);const dw=bw*s,dh=bh*s;const by=area.y+Math.max(0,(area.h-dh-260)/2);g.drawImage(board,cx-dw/2,by,dw,dh);const y=await titleBlock(by+dh+28);pillText(g,'Shop the board',cx,Math.min(y+22,area.y+area.h-76),{fg:dark?'#2B211A':'#FBF8F2',bg:ink});return c}
  if(t==='card'){const pad=W*.08;const s=Math.min((W-2*pad-48)/bw,(area.h*.7)/bh);const dw=bw*s,dh=bh*s;const cy=area.y+Math.max(20,(area.h-dh-48-290)/2);
    g.save();g.shadowColor='rgba(30,20,12,.28)';g.shadowBlur=60;g.shadowOffsetY=24;g.fillStyle='#FFFDF9';g.beginPath();g.roundRect(cx-dw/2-24,cy,dw+48,dh+48,18);g.fill();g.restore();g.drawImage(board,cx-dw/2,cy+24,dw,dh);
    const y=await titleBlock(cy+dh+48+30);pillText(g,'Shop the board',cx,Math.min(y+22,area.y+area.h-76),{fg:dark?'#2B211A':'#FBF8F2',bg:ink});return c}
  if(t==='grid'){const s=Math.min(W*.74/bw,(area.h*.5)/bh);const dw=bw*s,dh=bh*s;g.drawImage(board,cx-dw/2,area.y,dw,dh);let y=await titleBlock(area.y+dh+20);
    const show=[...new Set(ids)].slice(0,6),cols=3,cw=(W*.86)/cols,ch=Math.min(200,(area.y+area.h-y-120)/2);let i=0;
    for(const pid of show){const col=i%cols,row=Math.floor(i/cols);const x0=W*.07+col*cw,y0=y+24+row*(ch+10);g.fillStyle=dark?'rgba(255,255,255,.07)':'#F4EFE6';g.beginPath();g.roundRect(x0+6,y0,cw-12,ch,14);g.fill();await drawPiece(g,pid,x0+cw/2,y0+ch*.74,cw*.8,ch*.62,false);
      g.font=`400 22px ${FONTS.sans}`;g.fillStyle=soft;g.textAlign='center';g.textBaseline='alphabetic';g.fillText(byId(pid).name+(o.prices?' · '+fmt(pr(byId(pid),'retail')):''),x0+cw/2,y0+ch-14);g.textAlign='left';i++}
    pillText(g,'Shop the board',cx,area.y+area.h-76,{fg:dark?'#2B211A':'#FBF8F2',bg:ink});return c}
  if(t==='before'){const half=(area.h-140)/2;const lab=(txt,y)=>{g.font=`500 26px ${FONTS.sans}`;g.fillStyle=dark?'#2B211A':'#FBF8F2';const tw=g.measureText(txt).width;g.fillStyle=ink;g.beginPath();g.roundRect(W*.07,y+16,tw+36,48,24);g.fill();g.fillStyle=dark?'#2B211A':'#FBF8F2';g.textBaseline='middle';g.fillText(txt,W*.07+18,y+40)};
    const im=doc?.bg?.img?await loadImg(absUrl(doc.bg.img)):null;
    g.save();g.translate(W*.06,area.y);g.beginPath();g.roundRect(0,0,W*.88,half,18);g.clip();if(im)drawCover(g,im,W*.88,half);else{g.fillStyle=dark?'rgba(255,255,255,.08)':'#E1D2BB';g.fillRect(0,0,W*.88,half)}g.restore();lab('Before',area.y);
    g.save();g.beginPath();g.roundRect(W*.06,area.y+half+16,W*.88,half,18);g.clip();g.translate(W*.06,area.y+half+16);const s=Math.max(W*.88/bw,half/bh);g.drawImage(board,(W*.88-bw*s)/2,(half-bh*s)/2,bw*s,bh*s);g.restore();lab('After',area.y+half+16);
    const y=await titleBlock(area.y+2*half+40);pillText(g,'Shop the board',cx,Math.min(y+12,area.y+area.h-70),{fg:dark?'#2B211A':'#FBF8F2',bg:ink});return c}
  return c;
}


/* ---------- PDF: the board, then a product sheet with live links ---------- */
async function boardPdf(doc,{title,board,counts:given,link,pieceLink,prices,mode,products=BY_ID,productLookup}){
  const byId=productLookup||((id)=>displayProduct(products,+id));const has=id=>!!byId(id).lid;const cut=id=>byId(id).cutout||byId(id).img;
  const {PDFDocument,StandardFonts,rgb,PDFName,PDFString}=await import('pdf-lib');
  const pdf=await PDFDocument.create();pdf.setTitle(title);pdf.setCreator('House of Louie Mae');
  const serif=await pdf.embedFont(StandardFonts.TimesRomanItalic),sans=await pdf.embedFont(StandardFonts.Helvetica),sansB=await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink=rgb(.17,.13,.1),mute=rgb(.44,.39,.34),cognac=rgb(.65,.37,.17);
  const addLink=(page,x,y,w,h,url)=>{if(!url)return;const ref=pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[x,y,x+w,y+h],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of(url)}}));
    const ann=page.node.lookup(PDFName.of('Annots'));if(ann)ann.push(ref);else page.node.set(PDFName.of('Annots'),pdf.context.obj([ref]))};
  const toJpg=async(c,q=.88)=>new Uint8Array(await (await canvasBlob(c,'image/jpeg',q)).arrayBuffer());
  const toPng=async c=>new Uint8Array(await (await canvasBlob(c,'image/png')).arrayBuffer());
  const LW=612,LH=792,M=48;
  // Page 1: the board
  const shaped=!!doc&&doc.shape&&doc.shape!=='rect';const bc=board||await renderBoard(doc,1600,{products});
  const bimg=shaped?await pdf.embedPng(await toPng(bc)):await pdf.embedJpg(await toJpg(bc,.9));
  const p1=pdf.addPage([LW,LH]);p1.drawRectangle({x:0,y:0,width:LW,height:LH,color:rgb(.937,.902,.847)});
  p1.drawText(title,{x:M,y:LH-M-22,size:26,font:serif,color:ink});
  const avail={w:LW-2*M,h:LH-2*M-70};const s=Math.min(avail.w/bc.width,avail.h/bc.height);const dw=bc.width*s,dh=bc.height*s;const bx=(LW-dw)/2,by=M+30+(avail.h-dh)/2;
  p1.drawImage(bimg,{x:bx,y:by,width:dw,height:dh});addLink(p1,bx,by,dw,dh,link);
  if(link){p1.drawText(mode==='shop'?'Shop the board':'View the board',{x:M,y:M,size:11,font:sansB,color:cognac});p1.drawText(link,{x:M+(mode==='shop'?92:96),y:M,size:10,font:sans,color:mute});addLink(p1,M,M-4,LW-2*M,18,link)}
  // Page 2+: the product sheet
  const counts=given||{};if(!given)doc.els.forEach(e=>{if(e.kind==='img'&&!e.hidden)counts[e.pid]=(counts[e.pid]||0)+1});
  const ids=Object.keys(counts).filter(has);
  let page=null,y=0;const row=96;
  const newPage=()=>{page=pdf.addPage([LW,LH]);page.drawText('The pieces',{x:M,y:LH-M-22,size:24,font:serif,color:ink});if(link){page.drawText(link,{x:M,y:LH-M-42,size:9,font:sans,color:mute});addLink(page,M,LH-M-46,LW-2*M,14,link)}y=LH-M-70};
  newPage();let total=0;
  for(const pid of ids){if(y-row<M+40)newPage();const p=byId(pid);const q=counts[pid]||1;
    const im=await loadImg(absUrl(cut(pid)));
    if(im){const tc=document.createElement('canvas');const sz=240;tc.width=tc.height=sz;const tg=tc.getContext('2d');tg.fillStyle='#EFE6D8';tg.fillRect(0,0,sz,sz);const sc=Math.min(sz*.86/im.width,sz*.86/im.height);try{tg.drawImage(im,(sz-im.width*sc)/2,(sz-im.height*sc)/2,im.width*sc,im.height*sc);const ji=await pdf.embedJpg(await toJpg(tc,.85));page.drawImage(ji,{x:M,y:y-row+8,width:row-16,height:row-16})}catch(e){}}
    const tx=M+row+4;page.drawText(p.name,{x:tx,y:y-24,size:15,font:serif,color:ink});page.drawText(p.line.slice(0,70),{x:tx,y:y-42,size:10,font:sans,color:mute});
    const dims=dimsText(p);if(dims)page.drawText(dims,{x:tx,y:y-57,size:9,font:sans,color:mute});
    const pl=pieceLink(pid);if(pl){page.drawText('View piece',{x:tx,y:y-74,size:10,font:sansB,color:cognac});addLink(page,tx,y-78,60,14,pl)}
    if(prices){const amt=pr(p,'retail')*q;total+=amt;const t=`${q>1?q+' × ':''}${fmt(pr(p,'retail'))}`;page.drawText(t,{x:LW-M-sans.widthOfTextAtSize(t,12),y:y-24,size:12,font:sans,color:ink});if(p.oos)page.drawText('Sold out',{x:LW-M-48,y:y-40,size:9,font:sans,color:cognac})}
    page.drawLine({start:{x:M,y:y-row},end:{x:LW-M,y:y-row},thickness:.5,color:rgb(.85,.82,.78)});y-=row}
  if(prices&&ids.length){if(y-40<M)newPage();const t=`Total ${fmt(total)} · retail, before delivery and tax`;page.drawText(t,{x:LW-M-sansB.widthOfTextAtSize(t,11),y:y-26,size:11,font:sansB,color:ink})}
  return new Blob([await pdf.save()],{type:'application/pdf'});
}

const pieceUrl=(pid)=>pieceShareUrl(shareOrigin(),pid);

const isPhone=()=>matchMedia('(pointer:coarse)').matches&&innerWidth<900;

// Uploaded photos stay on the sharer's device; the shared layout keeps everything else.
const shareableDoc=shareableBoard;

const ROUTES=[['image','Download image','PNG at 2×, ready to print or post','download'],['pdf','Download PDF','The board, then a product sheet with live links','board'],['story','Instagram Story','A 1080 × 1920 template, with the link copied for the sticker','img'],['pin','Pin or post','1000 × 1500 for Pinterest, or 1080 × 1350 for a feed','pin'],['link','Copy link','A short link to the shoppable board','link'],['share','Send to a friend','Your phone\'s share sheet, or email on a computer','send']];

/**
 * The Share sheet: every way a board leaves the site, each carrying the same bundle link with the
 * partner's code. `doc` is a collage; the planner passes `image` (its snapshot) and piece ids instead.
 */
function ShareSheet({ctx,title,doc,image,ids,selections,boardKey,room,units,onClose}){
  const [m,setM]=useState('shop');const [links,setLinks]=useState({});const [busy,setBusy]=useState('');const [err,setErr]=useState('');const [view,setView]=useState('routes');
  const [qr,setQr]=useState(false);const [qrFor,setQrFor]=useState(null);
  const share=useMutation(api.holmSync.shareBoard);const uploadCover=useAction(api.holmSync.uploadCover);
  const identities=selections||doc?.els.filter(e=>e.kind==='img'&&!e.hidden)||room?.items||(ids||[]).map(pid=>({pid,...(has(pid)?{lid:byId(pid).lid,vid:byId(pid).vid}:{})}));
  const savedCatalog=useProjectCatalog(identities,BY_ID);
  const rows=editorSelections(identities,savedCatalog.products);
  const selectedProducts=new Map(rows.filter(row=>row.product).map(row=>[row.key,row.product]));
  const productLookup=key=>selectedProducts.get(key);
  const signature=JSON.stringify(rows.map(row=>[row.key,row.qty,row.product]));
  const current=useRef(signature);current.current=signature;
  const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
  const generation=catalogGeneration;
  const check=()=>{if(!mounted.current||generation!==catalogGeneration||current.current!==signature||rows.some(row=>!row.product))throw new Error('The catalog changed. Review your saved items and try again.');};
  if(rows.some(row=>!row.product))return html`<${Modal} open label="Review unavailable items" onClose=${onClose}><h2>Review saved items before sharing</h2><p>${savedCatalog.pending?'Checking saved products.':savedCatalog.preparing?'Saved products need verification.':savedCatalog.failed?'Saved products could not be checked. Reload to try again.':'Some saved products are unavailable or have conflicting identities.'} Your composition is preserved. Resolve these items before creating a link or export.</p><button className="btn btn-line" onClick=${onClose}>Close</button><//>`;
  const counts=Object.fromEntries(rows.map(row=>[row.key,row.qty]));const pieces=rows.map(row=>row.key);
  const download=(blob,name)=>{check();saveBlob(blob,name)};
  const shop=m==='shop';const prices=shop;
  const boardCanvas=async w=>{if(doc)return renderBoard(doc,w,{products:savedCatalog.products});const im=await loadImg(image);const c=document.createElement('canvas');c.width=w;c.height=Math.round(w*im.height/im.width);c.getContext('2d').drawImage(im,0,0,c.width,c.height);return c};
  // The link is made once per mode (with the rendered board as its cover) and reused by every route.
  const ensure=async()=>{check();if(links[m]?.signature===signature)return links[m];if(!ctx.me.signedIn){onClose();ctx.toast('Sign in to share a link');ctx.signInThen(ctx.route);return null}
    let coverId;try{const c=doc?await renderBoard(shareableDoc(doc),1200,{products:savedCatalog.products}):await boardCanvas(1200);const b=await canvasBlob(c,'image/jpeg',.88);const bytes=await b.arrayBuffer();check();coverId=await uploadCover({bytes,type:'image/jpeg'});check()}catch(e){coverId=undefined}
    check();const r=await share({title,mode:shop?'shop':'presentation',items:pieces.map(id=>({productId:productLookup(id).lid,variantId:productLookup(id).vid,qty:counts[id]})),boardKey:boardKey||undefined,doc:doc?shareableDoc(doc):undefined,coverId});
    check();setLinks(l=>({...l,[m]:{...r,signature}}));return r};
  const run=async(k,fn)=>{setBusy(k);setErr('');try{check();await fn()}catch(e){setErr(errText(e))}finally{setBusy('')}};
  const go=k=>{
    if(k==='image')return run(k,async()=>{if(!doc&&image){download(await (await fetch(image)).blob(),fileName(title,'jpg'));return}
      const c=await renderBoard(doc,2160,{products:savedCatalog.products});if(qr){const l=await ensure();if(!l)return;await drawQR(c.getContext('2d'),bundleUrl(l.slug,'qr'),c.width-c.width*.15,c.height-c.width*.15,c.width*.12)}
      download(await canvasBlob(c),fileName(title,'png'));ctx.toast('Image downloaded')});
    if(k==='pdf')return run(k,async()=>{const l=ctx.me.signedIn?await ensure():null;
      const blob=await boardPdf(doc,{title,board:doc?null:await boardCanvas(1600),counts,link:l?bundleUrl(l.slug,'pdf'):null,pieceLink:pid=>l||!ctx.me.signedIn?pieceUrl(productLookup(pid).id,l?.refCode,'pdf'):null,prices,mode:m,products:savedCatalog.products,productLookup});
      if(blob.size>8e6)ctx.toast('This PDF is large. Fewer uploaded photos make it smaller.');download(blob,fileName(title,'pdf'));ctx.toast(l?'PDF downloaded, with live links':'PDF downloaded. Sign in to add live links.')});
    if(k==='link')return run(k,async()=>{const l=await ensure();check();if(l)copyText(bundleUrl(l.slug,'link'),ctx.toast)});
    if(k==='plan')return run(k,async()=>{const l=ctx.me.signedIn?await ensure():null;download(await planPdf(room,{title,units,link:l?bundleUrl(l.slug,'pdf'):null,products:savedCatalog.products}),fileName(title+'-plan','pdf'));ctx.toast(l?'Plan PDF downloaded, with the bundle link':'Plan PDF downloaded. Sign in to add the bundle link.')});
    if(k==='share')return run(k,async()=>{const l=await ensure();if(!l)return;check();const url=bundleUrl(l.slug,'share');
      if(navigator.share&&isPhone()){try{await navigator.share({title,text:title,url})}catch(e){}}else location.href=`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${title}\n\n${url}`)}`});
    setView(k)};
  return html`<${Modal} open label="Share" onClose=${onClose}><div className="scrim sx-scrim" onClick=${e=>e.target===e.currentTarget&&onClose()}>
    <div className="sx-dialog wide sx-share">
      <div className="sx-drawer-h">${view!=='routes'?html`<button className="lnk" onClick=${()=>setView('routes')}>${I('back',{width:15})} Share</button>`:html`<b>Share</b>`}<button className="ib" aria-label="Close" onClick=${onClose}>${I('x')}</button></div>
      <div className="modecards">
        <button className=${'modecard'+(shop?' on':'')} onClick=${()=>setM('shop')}><b>Shoppable</b><p>${ctx.me.partner?'Retail prices with your partner code. You earn commission on retail orders for 30 days.':'Retail prices, ready to add to a project.'}</p></button>
        <button className=${'modecard'+(!shop?' on':'')} onClick=${()=>setM('pres')}><b>Presentation</b><p>No prices, for client review. You order at trade.</p></button>
      </div>
      ${view==='routes'&&html`<${React.Fragment}><div className="sx-routes">${(room?[...ROUTES.slice(0,2),['plan','Plan PDF','The floor plan to scale, every room, piece and seat count','board'],...ROUTES.slice(2)]:ROUTES).map(([k,l,hint,ic])=>html`<button key=${k} className="sx-route" disabled=${!!busy||!pieces.length&&k!=='image'} onClick=${()=>go(k)}>
          <span className="sx-route-i">${I(ic,{width:18})}</span><span><b>${busy===k?'One moment…':l}</b><small>${hint}</small></span></button>`)}</div>
        ${doc&&html`<label className="toggle"><span>Add a QR code to the image's corner</span><input type="checkbox" className="sr" checked=${qr} onChange=${e=>setQr(e.target.checked)}/><span className=${'sw'+(qr?' on':'')}></span></label>`}
        ${links[m]?.signature===signature&&html`<div className="linkbox"><code>${bundleUrl(links[m].slug,'link')}</code><button className="btn btn-ink btn-sm" onClick=${()=>run('link',async()=>{check();await copyText(bundleUrl(links[m].slug,'link'),ctx.toast)})}>${I('link',{width:15})} Copy</button></div>`}<//>`}
      ${(view==='story'||view==='pin')&&html`<${StoryBuilder} ctx=${ctx} products=${savedCatalog.products} productLookup=${productLookup} signature=${signature} doc=${doc} boardCanvas=${doc?null:boardCanvas} pieces=${pieces} title=${title} pin=${view==='pin'} prices=${prices} ensure=${ensure} onQR=${setQrFor} busy=${busy} run=${run} check=${check} download=${download}/>`}
      ${qrFor&&html`<div className="sx-qr"><canvas ref=${c=>{if(c&&c.dataset.u!==qrFor){c.dataset.u=qrFor;c.width=c.height=220;drawQR(c.getContext('2d'),qrFor,0,0,220)}}} width="220" height="220" aria-label="QR code for the board link"></canvas>
        <p className="sx-note">Scan with your phone to open the board there, then post the image from your camera roll with a Link sticker.</p></div>`}
      ${err&&html`<p className="sx-note" style=${{color:'var(--bad)'}}>${err}</p>`}
      ${shop&&ctx.me.partner&&html`<p className="sx-note">Posting on social? Add #ad or "I earn commission" to the caption. FTC rules require it, and it's in the partner terms.</p>`}
      ${!shop&&html`<p className="sx-note">Presentation links never carry your partner code and never show prices.</p>`}
    </div></div><//>`;
}

// Story and Pin/post templates: flip between looks with the arrows, then share or download.
function StoryBuilder({ctx,doc,boardCanvas,pieces,title,pin,prices,ensure,onQR,busy,run,check,download,products,productLookup,signature}){
  const byId=productLookup;
  const [kind,setKind]=useState(pin||!pieces.length?'board':'single');const [ti,setTi]=useState(pin?1:0);const [pid,setPid]=useState(pieces[0]);
  const [ground,setGround]=useState('#EFE6D8');const [caption,setCaption]=useState('');const [showP,setShowP]=useState(prices);const [size,setSize]=useState('pin');const [url,setUrl]=useState(null);
  const list=kind==='single'?STORY_SINGLE:STORY_BOARD.filter(([k])=>k!=='before'||doc?.bg?.img);const t=list[((ti%list.length)+list.length)%list.length];
  const SIZES={pin:{w:1000,h:1500},feed:{w:1080,h:1350}};const dims=pin?SIZES[size]:STORY;
  useEffect(()=>{let live=true;const tm=setTimeout(async()=>{try{const c=await renderStory(doc,{products,productLookup,title,kind,t:t[0],pid,ground,caption,prices:prices&&showP,size:dims,board:boardCanvas?await boardCanvas(2160):null,ids:pieces});if(live)setUrl(c.toDataURL('image/jpeg',.8))}catch(e){}},150);return()=>{live=false;clearTimeout(tm)}},[kind,t[0],pid,ground,caption,showP,size,pin,signature,prices]);
  const out=()=>run('story',async()=>{const c=await renderStory(doc,{products,productLookup,title,kind,t:t[0],pid,ground,caption,prices:prices&&showP,size:dims,board:boardCanvas?await boardCanvas(2160):null,ids:pieces});const blob=await canvasBlob(c);
    check();const l=await ensure();if(!l)return;check();const ch=pin?(size==='pin'?'pin':'post'):'story';const link=bundleUrl(l.slug,ch);const file=new File([blob],fileName(title,'png'),{type:'image/png'});
    if(isPhone()&&navigator.canShare?.({files:[file]})){await copyText(link,()=>{});ctx.toast(pin?'Link copied. Paste it as the post\'s link.':'Link copied. Add a Link sticker and paste.');try{check();await navigator.share({files:[file],title})}catch(e){}return}
    download(blob,file.name);await copyText(link,()=>{});ctx.toast(pin?'Image downloaded and link copied':'Image downloaded and link copied for the Link sticker');if(!pin)onQR(bundleUrl(l.slug,'qr'))});
  return html`<div className="sx-story">
    <div className="sx-story-pre">
      <button className="ib" aria-label="Previous template" onClick=${()=>setTi(i=>i-1)}>${I('back')}</button>
      <figure>${url?html`<img src=${url} alt=${t[1]+' template preview'} style=${{aspectRatio:`${dims.w}/${dims.h}`}}/>`:html`<span className="sx-story-wait" style=${{aspectRatio:`${dims.w}/${dims.h}`}}></span>`}<figcaption>${t[1]}</figcaption></figure>
      <button className="ib" aria-label="Next template" onClick=${()=>setTi(i=>i+1)}>${I('arrow')}</button>
    </div>
    <div className="sx-story-opts">
      ${!pin&&html`<div className="seg" role="group" aria-label="Start from"><button className=${kind==='single'?'on':''} disabled=${!pieces.length} onClick=${()=>{setKind('single');setTi(0)}}>Single product</button><button className=${kind==='board'?'on':''} onClick=${()=>{setKind('board');setTi(0)}}>Whole board</button></div>`}
      ${pin&&html`<div className="seg" role="group" aria-label="Size"><button className=${size==='pin'?'on':''} title="1000 × 1500" onClick=${()=>setSize('pin')}>Pinterest</button><button className=${size==='feed'?'on':''} title="1080 × 1350" onClick=${()=>setSize('feed')}>Feed post</button></div>`}
      ${kind==='single'&&html`<label className="sx-col" style=${{gap:4}}><span className="sx-lbl">Piece</span><select className="field" style=${{height:38}} value=${pid} onChange=${e=>setPid(e.target.value)}>${pieces.map(id=>html`<option key=${id} value=${id}>${byId(id).name} · ${byId(id).line}</option>`)}</select></label>`}
      <span className="sx-lbl">Ground</span><div className="swatches">${GROUNDS.map(c=>html`<button key=${c} style=${{background:c}} className=${ground===c?'on':''} aria-label=${'Ground '+c} onClick=${()=>setGround(c)}></button>`)}</div>
      <label className="sx-col" style=${{gap:4}}><span className="sx-lbl">Caption</span><input className="field" style=${{height:38}} maxLength="80" placeholder=${kind==='single'?byId(pid)?.line:title} value=${caption} onInput=${e=>setCaption(e.target.value)}/></label>
      ${prices&&html`<button className="toggle" onClick=${()=>setShowP(!showP)}><span>Show prices</span><span className=${'sw'+(showP?' on':'')}></span></button>`}
      <button className="btn btn-cog" disabled=${!!busy} onClick=${out}>${busy==='story'?'One moment…':isPhone()?(pin?'Share':'Share to Story'):'Download and copy link'}</button>
      <p className="sx-note">${pin?'The link goes with the pin, so every save leads back to the board.':isPhone()?'We copy the link first; add a Link sticker in Instagram and paste.':'Instagram posts Stories from phones. We download the image and show a QR code to open the board on your phone.'}</p>
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


// Pieces outside the curated 24 have no measured cutout: width comes from the listing's facts, the rest from their type.
// Every piece is placed from its catalog W × D × H; one without dimensions can't be placed.
const PL_TEMPLATES={blank:{label:'Blank room',W:8,D:6,H:3.2,wall:'#F1E9DC',floor:'oak',openings:[{wall:'back',t:'win',x:0,w:2.4,h:1.8,y:.8}],items:[]}};

SPACE_KEYS.forEach(k=>{const s=STUDY[k];PL_TEMPLATES[k]={label:SPACES[k].label+' study',W:s.W,D:s.D,H:s.H,wall:s.dark?'#3B2A1E':ROOMS[k].wall,floor:ROOMS[k].floor,openings:s.openings.map(o=>({...o,wall:'back'})),items:s.items.map(i=>({pid:i.id,x:i.x,z:i.z,rot:0,hang:!!i.hang}))}});

// Every room as polygons: a drawn plan's rooms, or the rectangle W × D.
const roomZones=doc=>doc.zones?.length?doc.zones:[{id:'room',name:'Room',poly:[[-doc.W/2,-doc.D/2],[doc.W/2,-doc.D/2],[doc.W/2,doc.D/2],[-doc.W/2,doc.D/2]],floor:doc.floor,wall:doc.wall}];

const zoneOf=(doc,x,z)=>roomZones(doc).find(zn=>inPoly([x,z],zn.poly))||null;

const r2=v=>Math.round(v*100)/100;

// Lengths read in metres or in feet and inches, to the centimetre or half inch.
const fmtLen=(m,u)=>{if(u!=='ft')return `${m.toFixed(2)} m`;const inch=Math.round(m/.0254*2)/2;const ft=Math.floor(inch/12);const r=inch-ft*12;return `${ft}′ ${String(r).replace('.5','½')}″`};

const fmtCm=(cm,u)=>u==='ft'?`${String(Math.round(cm/2.54*2)/2).replace('.5','½')}″`:`${Math.round(cm)} cm`;

// Rugs are layout guides in standard US sizes (metres from feet); they sit under furniture, so they never collide.
const RUG_SIZES=[['5 × 8 ft',1.52,2.44],['6 × 9 ft',1.83,2.74],['8 × 10 ft',2.44,3.05],['9 × 12 ft',2.74,3.66],['10 × 14 ft',3.05,4.27],['2.5 × 8 ft runner',.76,2.44],['6 ft round',1.83,1.83,1],['8 ft round',2.44,2.44,1]];

const RUG_MATS=[['jute','Jute'],['wool','Wool']];

const RUG_COLORS=[['','Natural'],['#F1EADC','Ivory'],['#D9C8A9','Oatmeal'],['#B4683F','Rust'],['#8E9A7C','Sage'],['#6E7787','Slate'],['#4A4440','Charcoal']];

// Fit a back-wall preset to the room: openings never overlap, cross the wall's ends or rise past the ceiling.
const plFit=(W,H,ops)=>ops.map((o,i)=>{const near=Math.min(Infinity,...ops.filter((_,j)=>j!==i).map(p=>Math.abs(p.x-o.x)))-.15;let w=Math.max(.3,Math.min(o.w,near,2*(W/2-.1-Math.abs(o.x))));const y=Math.min(o.y,Math.max(.05,H-.5));const h=Math.max(.3,Math.min(o.h,H-y-.1));if(o.t==='arch')w=Math.min(w,2*(h-.05));return {...o,w:r2(w),y:r2(y),h:r2(h)}});

const plWord=(it,doc)=>`${it.x<-doc.W/6?'left':it.x>doc.W/6?'right':'centre'}${it.z<-doc.D/6?' back':it.z>doc.D/6?' front':''}`;


/** Keep the planner canvas mounted behind independently dismissible snapshot and render dialogs. */
function Room({ctx}){
  const [saved,setSaved]=useState(()=>load('room',null));
  const raw=ctx.roomSeed;const seed=((Array.isArray(raw)?raw:raw?.ids)||[]).map(editorIdentity);
  const identities=[...(saved?.items||[]),...seed];
  const savedCatalog=useProjectCatalog(identities,BY_ID);
  const missing=identities.flatMap((item,index)=>{const p=resolveProjectProduct(item,savedCatalog.products);return !p||!p.dimsCm?[{item,index}]:[]});
  if(missing.length)return html`<${PlannerReview} missing=${missing} message=${item=>resolveProjectProduct(item,savedCatalog.products)?.lid?'Measurements are needed before this piece can be placed. Your saved item is preserved.':projectResolutionMessage(item,savedCatalog.states)} remove=${index=>{const count=saved?.items?.length||0;if(index<count){const next={...saved,items:saved.items.filter((_,i)=>i!==index)};store('room',next);setSaved(next)}else{const next=seed.filter((_,i)=>i!==index-count);ctx.setRoomSeed(Array.isArray(raw)?next:{...raw,ids:next})}}} back=${()=>ctx.go('discover')}/>`;
  return html`<${ReadyRoom} ctx=${ctx} products=${savedCatalog.products} onDraftChange=${setSaved}/>`;
}

const persistPlannerRoom=doc=>store('room',doc);

function ReadyRoom({ctx,onDraftChange,products}){
  const catalogRef=useRef(products);catalogRef.current=products;
  const geometryRef=useRef(null);geometryRef.current=plannerGeometry(products);
  const byId=reference=>studioGeometry(catalogRef.current).product(reference);
  const has=reference=>!!byId(reference).lid;
  const cut=reference=>byId(reference).cutout||byId(reference).img;
  const plDims=(...args)=>geometryRef.current.dimensions(...args),plReady=(...args)=>geometryRef.current.ready(...args),plCm=(...args)=>geometryRef.current.widthCm(...args),plExt=(...args)=>geometryRef.current.extents(...args),plClamp=(...args)=>geometryRef.current.clamp(...args),plHit=(...args)=>geometryRef.current.collides(...args),plPlace=(...args)=>geometryRef.current.place(...args),plReflow=(...args)=>geometryRef.current.reflow(...args);
  const currentIdentity=reference=>{const identity=editorIdentity(reference);const p=byId(identity);return p.lid?{pid:identity.pid,lid:p.lid,vid:p.vid}:identity};
  // Pieces sent here join the saved room. From the Studio's 3D switch (sync) the room follows the board
  // instead: its new pieces arrive and the ones it dropped leave.
  const init=()=>{const saved=load('room',null);const raw=ctx.roomSeed;const sync=!!raw?.sync;const seed=((Array.isArray(raw)?raw:raw?.ids)||[]).map(currentIdentity);
    if(saved&&Array.isArray(saved.items)){const kept=saved.items.map(i=>({...i,...currentIdentity(i)}));const place=(pids,z)=>pids.map((reference,i)=>({uid:uid(),...currentIdentity(reference),x:(i-(pids.length-1)/2)*1.4,z,rot:0,hang:byId(reference).hangs}));
      if(sync){const {keep,add}=reconcileEditorSelections(kept,seed.filter(plReady));return plReflow({...saved,items:[...kept.filter((_,i)=>keep.has(i)),...place(add,0)],wallImg:ctx.roomWall||saved.wallImg||null})}
      // Only pieces the room doesn't already hold are added, so nothing is duplicated.
      const fresh=reconcileEditorSelections(kept,seed.filter(plReady)).add;
      if(!fresh.length)return {...saved,items:kept,wallImg:ctx.roomWall||saved.wallImg||null};
      return plReflow({...saved,items:[...kept,...place(fresh,-saved.D/2+1.3)],wallImg:ctx.roomWall||saved.wallImg||null})}
    const key=PL_TEMPLATES[ctx.space]?ctx.space:'blank';const t=JSON.parse(JSON.stringify(PL_TEMPLATES[key]));let items=t.items;
    if(seed.length){items=seed.filter(plReady).map((reference,i,a)=>({...currentIdentity(reference),x:(i-(a.length-1)/2)*1.7,z:-t.D/2+1.3,rot:0,hang:byId(reference).hangs}))}
    return plReflow({...t,tpl:key,items:items.filter(plReady).map(it=>({...it,...currentIdentity(it),uid:uid()})),rugs:[],wallImg:ctx.roomWall||null})};
  const [doc,setDoc]=useState(init);const [view,setView]=useState('orbit');const [style,setStyle]=useState('material');const [tod,setTod]=useState(.12);
  useEffect(()=>onDraftChange(doc),[doc,onDraftChange]);
  const [sel,setSel]=useState(null);const [tab,setTab]=useState('pieces');const [snap,setSnap]=useState(true);const [q,setQ]=useState('');const [cat,setCat]=useState('all');
  const [shot,setShot]=useState(null);const [showPrompt,setShowPrompt]=useState(false);
  const [drawer,setDrawer]=useState(null);const [pop,setPop]=useState(null);const [traySheet,setTraySheet]=useState(false);const [tplAsk,setTplAsk]=useState(null);const [lookOpen,setLookOpen]=useState(false);
  const [planOpen,setPlanOpen]=useState(false);const [units,setUnits]=useState(()=>load('units','m'));useEffect(()=>store('units',units),[units]);const [rendering,setRendering]=useState(null);
  const [shareImg,setShareImg]=useState(null);const [roomKey]=useState(()=>{let k=load('roomKey',null);if(!k){k='room-'+uid();store('roomKey',k)}return k});const createRender=useAction(api.holmRender.create);const [aiJob,setAiJob]=useState(null);const [aiBusy,setAiBusy]=useState(false);
  const [title,setTitle]=useState(()=>load('roomTitle','Untitled room'));useEffect(()=>store('roomTitle',title),[title]);
  const [three,threeFailed]=useThree();const [eng,setEng]=useState(0);
  const hist=useRef({past:[],future:[]});const vpRef=useRef(),cvRef=useRef(),labRef=useRef(),E=useRef({}),docRef=useRef(doc);docRef.current=doc;
  const commit=next=>{next={...next,placementConflicts:next.items.filter(i=>plHit(next,i,i.x,i.z)).map(i=>i.uid)};hist.current.past.push(docRef.current);if(hist.current.past.length>60)hist.current.past.shift();hist.current.future=[];setDoc(next)};
  const undo=()=>{const h=hist.current;if(!h.past.length)return;h.future.push(docRef.current);setDoc(h.past.pop())};
  const redo=()=>{const h=hist.current;if(!h.future.length)return;h.past.push(docRef.current);setDoc(h.future.pop())};
  const patchItem=(id,o)=>{const d=docRef.current;const current=d.items.find(i=>i.uid===id);if(!current||(current.lock&&['x','z','rot'].some(k=>k in o)))return;commit({...d,items:d.items.map(i=>{if(i.uid!==id)return i;if(i.lock&&('x' in o||'z' in o||'rot' in o))return i;const n={...i,...o};if('x' in o||'z' in o||'rot' in o){const position=plPlace(d,n,n.x,n.z);if(!position){ctx.toast('No clear space for this move. Your previous position is preserved.');return i}const [x,z]=position;n.x=r2(x);n.z=r2(z)}return n})})};
  const addItem=(pid,x,z)=>{if(!plReady(pid)){ctx.toast(`Measurements needed: ${byId(pid).name} has no width, depth and height yet`);return}const d=docRef.current;const it={uid:uid(),...currentIdentity(pid),x:0,z:0,rot:0,hang:byId(pid).hangs};const position=plPlace(d,it,x??0,z??0);if(!position){ctx.toast('There is no clear space for this piece. Enlarge the room or remove another piece.');return}const [px,pz]=position;it.x=r2(px);it.z=r2(pz);commit({...d,items:[...d.items,it]});setSel(it.uid)};
  const removeItem=id=>{const d=docRef.current;commit({...d,items:d.items.filter(i=>i.uid!==id),rugs:(d.rugs||[]).filter(r=>r.uid!==id)});setSel(null)};
  const rugOf=id=>(docRef.current.rugs||[]).find(r=>r.uid===id);
  const patchRug=(id,o)=>{const d=docRef.current;commit({...d,rugs:(d.rugs||[]).map(r=>{if(r.uid!==id)return r;const n={...r,...o};[n.x,n.z]=rugClamp(d,n,n.x,n.z);return n})})};
  // A new rug centres under the selected piece when there is one, so it lands where the seating is.
  const addRug=([size,w,dp,round])=>{const d=docRef.current;const at=d.items.find(i=>i.uid===sel);const r={uid:uid(),x:0,z:0,rot:0,w,d:dp,round:!!round,size,mat:'jute',color:''};[r.x,r.z]=rugClamp(d,r,at?at.x:0,at?at.z:0);commit({...d,rugs:[...(d.rugs||[]),r]});setSel(r.uid)};
  const patchSel=(id,o)=>rugOf(id)?patchRug(id,o):patchItem(id,o);
  const dupItem=id=>{const rg=rugOf(id);if(rg){const d=docRef.current;const n={...rg,uid:uid()};[n.x,n.z]=rugClamp(d,n,rg.x+.6,rg.z+.3);commit({...d,rugs:[...d.rugs,n]});setSel(n.uid);return}
    const it=docRef.current.items.find(i=>i.uid===id);if(!it)return;const d=docRef.current;const n={...it,uid:uid()};const position=plPlace(d,n,it.x+.6,it.z+.3);if(!position){ctx.toast('There is no clear space for another copy.');return}const [px,pz]=position;n.x=r2(px);n.z=r2(pz);commit({...d,items:[...d.items,n]});setSel(n.uid)};
  useEffect(()=>{if(ctx.roomSeed)ctx.setRoomSeed(null);if(ctx.roomWall)ctx.setRoomWall(null)},[]);
  // The room autosaves on this device; a photo on the wall is too large to keep, so it is left out.
  usePlannerPersistence(doc,persistPlannerRoom);
  useEffect(()=>setPop(null),[sel]);
  useEffect(()=>{if(view==='product'&&!doc.items.some(i=>i.uid===sel))setView('orbit')},[sel,view]);

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
    // Image-based light from an interior environment, so materials read as leather, bouclé, velvet and brass.
    const pmrem=new T.PMREMGenerator(renderer);let envTex=null;import('three/examples/jsm/environments/RoomEnvironment.js').then(({RoomEnvironment})=>{if(!S.alive)return;envTex=pmrem.fromScene(new RoomEnvironment(renderer),.04).texture;applyLook()}).catch(()=>{});
    // Contact shadows: a soft dark pool under each standing piece.
    const contactTex=(()=>{const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');const gr=g.createRadialGradient(64,64,0,64,64,64);gr.addColorStop(0,'rgba(0,0,0,.62)');gr.addColorStop(.55,'rgba(0,0,0,.28)');gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(0,0,128,128);return new T.CanvasTexture(c)})();
    // Ambient occlusion on computers; phones keep the plain renderer for frame rate.
    let composer=null,aoPass=null;const wantAO=!matchMedia('(pointer:coarse)').matches;
    if(wantAO)Promise.all([import('three/examples/jsm/postprocessing/EffectComposer.js'),import('three/examples/jsm/postprocessing/RenderPass.js'),import('three/examples/jsm/postprocessing/GTAOPass.js'),import('three/examples/jsm/postprocessing/OutputPass.js')]).then(([{EffectComposer},{RenderPass},{GTAOPass},{OutputPass}])=>{if(!S.alive)return;
      composer=new EffectComposer(renderer);const rp=new RenderPass(scene,persp);composer.addPass(rp);aoPass=new GTAOPass(scene,persp,size.w,size.h);aoPass.blendIntensity=.85;composer.addPass(aoPass);composer.addPass(new OutputPass());composer.rp=rp;composer.setSize(size.w,size.h)}).catch(()=>{});
    const loader=new T.TextureLoader();const cache={};const tex=(url,rep)=>{const k=url+(rep||'');if(cache[k])return cache[k];const t=loader.load(url.replace(/#bump$/,''));t.colorSpace=T.SRGBColorSpace;if(rep){t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(rep[0],rep[1])}t.anisotropy=8;return cache[k]=t};
    const CLAY=new T.MeshStandardMaterial({color:'#F0E9DB',roughness:.95});const LINE=new T.MeshBasicMaterial({color:'#FBFAF6',polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
    const PLANM=new T.MeshBasicMaterial({color:'#E7D7BF'});const PLANRUG=new T.MeshBasicMaterial({color:'#F3EADB',polygonOffset:true,polygonOffsetFactor:-1});const PLANSEL=new T.MeshBasicMaterial({color:'#F2C4A2'});
    const edgeM=new T.LineBasicMaterial({color:'#1E1B19'});const selM=new T.LineBasicMaterial({color:'#E8541E'});const fpM=new T.LineBasicMaterial({color:'#A65F2C'});const dimM=new T.LineBasicMaterial({color:'#E8541E'});
    const glowTex=(()=>{const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');const gr=g.createRadialGradient(64,64,0,64,64,64);gr.addColorStop(0,'rgba(255,214,150,1)');gr.addColorStop(.3,'rgba(255,170,80,.35)');gr.addColorStop(1,'rgba(255,150,60,0)');g.fillStyle=gr;g.fillRect(0,0,128,128);return new T.CanvasTexture(c)})();
    const S={alive:true,doc:null,items:new Map(),rugs:new Map(),surfaces:[],edges:[],ceil:null,cam:{th:-.62,ph:.98,r:13,tx:0,ty:.6,tz:-.4},vel:{th:0,ph:0},prod:{th:.6,auto:true},eye:{yaw:0,pitch:-.06,x:0,z:1.5},keys:new Set(),plan:{x:0,z:0,zoom:1},view:'orbit',style:'material',tod:.12,sel:null,snap:true,drag:null,dims:[],units:'m',touches:new Map(),last:performance.now()};
    const clear=g=>{while(g.children.length){const o=g.children.pop();o.traverse(c=>{if(c.geometry)c.geometry.dispose()})}};
    const rect=(w,d)=>{const a=w/2,b=d/2;return new T.BufferGeometry().setFromPoints([[-a,-b,a,-b],[a,-b,a,b],[a,b,-a,b],[-a,b,-a,-b]].flatMap(([x1,z1,x2,z2])=>[new T.Vector3(x1,0,z1),new T.Vector3(x2,0,z2)]))};
    // A drawn plan: each room gets its own floor and ceiling, every wall follows its edge at true
    // thickness with its openings, and columns or fixed blocks stand where they were drawn.
    function buildPlan(d){const {H}=d;const t=d.wallT||.12;S.underlay=null;
      for(const zn of d.zones){const poly=zn.poly;const cw=polyArea(poly)>0;
        const shape=new T.Shape(poly.map(([x,z])=>new T.Vector2(x,-z)));
        const ft=texture(zn.floor||d.floor),tile=FLOOR_TILE[zn.floor||d.floor]||2;const fmap=tex(ft.url,[1/tile,1/tile]);
        const fm=new T.MeshStandardMaterial({map:fmap,color:new T.Color(zn.floorTint||d.floorTint||'#ffffff'),roughness:/marble|tile|checker/.test(zn.floor||d.floor)?.35:.75});
        const floor=new T.Mesh(new T.ShapeGeometry(shape),fm);floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;floor.userData.fin=fm;roomG.add(floor);S.surfaces.push(floor);
        const ceil=new T.Mesh(new T.ShapeGeometry(shape),new T.MeshStandardMaterial({color:'#F3EEE6',roughness:1,side:T.DoubleSide}));ceil.rotation.x=-Math.PI/2;ceil.position.y=H;roomG.add(ceil);(S.ceils||=[]).push(ceil);
        const lime=texture('lime');
        poly.forEach((a,i)=>{const b=poly[(i+1)%poly.length];const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<.05)return;const ux=dx/len,uz=dz/len;const nx=cw?uz:-uz,nz=cw?-ux:ux;
          const ops=d.openings.filter(o=>o.wall===`${zn.id}:${i}`);const g=new T.ExtrudeGeometry(plShape(len+t,H,ops),{depth:t,bevelEnabled:false});
          const m=new T.MeshStandardMaterial({color:new T.Color(zn.wall||d.wall),roughness:.92});const bm=tex(lime.url,[len/4,H/4]);bm.colorSpace=T.NoColorSpace;m.bumpMap=bm;m.bumpScale=.012;
          const place=o=>{o.position.set((a[0]+b[0])/2+nx*t,0,(a[1]+b[1])/2+nz*t);o.rotation.y=Math.atan2(-uz,ux)};
          const w=new T.Mesh(g,m);place(w);w.castShadow=w.receiveShadow=true;w.userData.fin=m;roomG.add(w);S.surfaces.push(w);const e=new T.LineSegments(new T.EdgesGeometry(g,25),edgeM);place(e);roomG.add(e);S.edges.push(e)})}
      for(const bk of d.blocks||[]){const g=new T.BoxGeometry(bk.w,bk.h||1.05,bk.d);const m=new T.MeshStandardMaterial({color:'#E6DED1',roughness:.85});const mesh=new T.Mesh(g,m);mesh.position.set(bk.x,(bk.h||1.05)/2,bk.z);mesh.rotation.y=(bk.rot||0)*Math.PI/180;mesh.castShadow=mesh.receiveShadow=true;mesh.userData.fin=m;roomG.add(mesh);S.surfaces.push(mesh);
        const e=new T.LineSegments(new T.EdgesGeometry(g),edgeM);e.position.copy(mesh.position);e.rotation.copy(mesh.rotation);roomG.add(e);S.edges.push(e)}
      // The plan drawing sits under Plan view at its own opacity, at true scale.
      const u=d.underlay;if(u?.img){const um=new T.MeshBasicMaterial({map:tex(u.img),transparent:true,opacity:u.opacity??.5,depthWrite:false});const pw=u.w*u.mPerPx,ph=u.h*u.mPerPx;const plane=new T.Mesh(new T.PlaneGeometry(pw,ph),um);plane.rotation.x=-Math.PI/2;plane.position.set(u.ox+pw/2,.02,u.oz+ph/2);plane.renderOrder=2;roomG.add(plane);S.underlay=plane}
      S.doc=d;applyLook()}
    function buildRoom(d){clear(roomG);S.surfaces=[];S.edges=[];S.ceils=[];if(d.zones?.length){S.ceil=null;buildPlan(d);return}const {W,D,H}=d;
      const ft=texture(d.floor),tile=FLOOR_TILE[d.floor]||2;const fm=new T.MeshStandardMaterial({map:tex(ft.url,[W/tile,D/tile]),color:new T.Color(d.floorTint||'#ffffff'),roughness:/marble|tile|checker/.test(d.floor)?.35:d.floor==='carpet'?1:.75});{const b=tex(ft.url+'#bump',[W/tile,D/tile]);b.colorSpace=T.NoColorSpace;fm.bumpMap=b;fm.bumpScale=d.floor==='carpet'?.02:.006}
      const floor=new T.Mesh(new T.PlaneGeometry(W,D),fm);floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;floor.userData.fin=fm;roomG.add(floor);S.surfaces.push(floor);
      const lime=texture('lime');
      const t=d.wallT||.12;const mk=(len,ops,place,back)=>{const g=new T.ExtrudeGeometry(plShape(len,H,ops),{depth:t,bevelEnabled:false});const m=new T.MeshStandardMaterial({color:new T.Color(d.wall),roughness:.92});
        if(back&&d.wallImg){m.map=tex(d.wallImg);m.color=new T.Color('#ffffff')}else{const b=tex(lime.url,[len/4,H/4]);b.colorSpace=T.NoColorSpace;m.bumpMap=b;m.bumpScale=.012}
        const w=new T.Mesh(g,m);place(w);w.castShadow=w.receiveShadow=true;w.userData.fin=m;roomG.add(w);S.surfaces.push(w);const e=new T.LineSegments(new T.EdgesGeometry(g,25),edgeM);place(e);roomG.add(e);S.edges.push(e)};
      mk(W+2*t,d.openings.filter(o=>o.wall==='back'),m=>m.position.set(0,0,-D/2-t),true);
      mk(D,d.openings.filter(o=>o.wall==='left'),m=>{m.rotation.y=Math.PI/2;m.position.set(-W/2-t,0,0)});
      mk(D,d.openings.filter(o=>o.wall==='right'),m=>{m.rotation.y=-Math.PI/2;m.position.set(W/2+t,0,0)});
      const ceil=new T.Mesh(new T.PlaneGeometry(W+2*t,D),new T.MeshStandardMaterial({color:'#F3EEE6',roughness:1,side:T.DoubleSide}));ceil.rotation.x=Math.PI/2;ceil.position.y=H;roomG.add(ceil);S.ceil=ceil;
      S.doc=d;applyLook()}
    function makeItem(it){const {p,w,d,hp,hb}=plDims(it);const g=new T.Group();g.userData.uid=it.uid;
      const box=new T.BoxGeometry(w,hp,d);const proxy=new T.Mesh(box,CLAY);proxy.position.y=it.hang?0:hp/2;proxy.castShadow=proxy.receiveShadow=true;proxy.userData.uid=it.uid;g.add(proxy);
      const pe=new T.LineSegments(new T.EdgesGeometry(box),edgeM);pe.position.copy(proxy.position);g.add(pe);
      const map=tex(cut(it));const bm=new T.MeshStandardMaterial({map,transparent:true,alphaTest:.45,side:T.DoubleSide,roughness:.85});const bb=new T.Mesh(new T.PlaneGeometry(w,hb),bm);bb.castShadow=true;bb.customDepthMaterial=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,map,alphaTest:.45});bb.position.y=it.hang?0:hb/2;g.add(bb);
      const fp=new T.LineSegments(rect(w,d),fpM);g.add(fp);
      const cs=new T.Mesh(new T.PlaneGeometry(w*1.3,d*1.3),new T.MeshBasicMaterial({map:contactTex,transparent:true,depthWrite:false,opacity:.75}));cs.rotation.x=-Math.PI/2;cs.position.y=.006;cs.visible=!it.hang;g.add(cs);
      const v0={g,proxy,pe,bb,fp,cs,lamp:null,w,d,hp,hb,model:null,modelState:p.model?'loading':'none',hi:false};
      if(p.model){loadGLB(p.modelLow||p.model,renderer).then(obj=>{if(!S.alive||S.items.get(it.uid)!==v0)return;fitToDims(T,obj,p.dimsCm);obj.position.y+=it.hang?-hp/2:0;g.add(obj);v0.model=obj;v0.modelState='ready';applyLook()}).catch(()=>{v0.modelState='failed';applyLook()})}
      let lamp=null;if(GLOW_AT[it.pid]){const gl=GLOW_AT[it.pid];const light=new T.PointLight('#FFB868',0,7,2);const spr=new T.Sprite(new T.SpriteMaterial({map:glowTex,transparent:true,opacity:0,depthWrite:false,blending:T.AdditiveBlending}));spr.scale.set(w*1.4,w*1.4,1);const ly=(.5-gl[1]/100)*hb+(it.hang?0:hb/2);light.position.set((gl[0]/100-.5)*w,ly,.05);spr.position.copy(light.position);g.add(light,spr);lamp={light,spr}}
      itemsG.add(g);v0.lamp=lamp;return v0}
    const circ=r=>{const pts=[];for(let k=0;k<64;k++){const a=k/64*Math.PI*2,b=(k+1)/64*Math.PI*2;pts.push(new T.Vector3(Math.cos(a)*r,0,Math.sin(a)*r),new T.Vector3(Math.cos(b)*r,0,Math.sin(b)*r))}return new T.BufferGeometry().setFromPoints(pts)};
    function makeRug(r){const g=new T.Group();const wool=r.mat==='wool',rep=wool?1.5:.6;
      const fin=new T.MeshStandardMaterial({map:tex(texture(wool?'carpet':'jute').url,[r.w/rep,r.d/rep]),color:new T.Color(r.color||'#ffffff'),roughness:1,polygonOffset:true,polygonOffsetFactor:-1});
      const m=new T.Mesh(r.round?new T.CircleGeometry(r.w/2,64):new T.PlaneGeometry(r.w,r.d),fin);m.rotation.x=-Math.PI/2;m.position.y=.004;m.receiveShadow=true;m.userData.uid=r.uid;m.userData.fin=fin;g.add(m);
      const ol=new T.LineSegments(r.round?circ(r.w/2):rect(r.w,r.d),fpM);ol.position.y=.009;g.add(ol);rugsG.add(g);return {g,m,ol,w:r.w,d:r.d}}
    function placeRug(v){const r=v.it;v.g.position.set(r.x,0,r.z);v.g.rotation.y=(r.rot||0)*Math.PI/180}
    function syncRugs(rugs){const keep=new Set(rugs.map(r=>r.uid));for(const [k,v] of S.rugs){if(!keep.has(k)){rugsG.remove(v.g);v.g.traverse(c=>{if(c.geometry)c.geometry.dispose()});S.rugs.delete(k)}}
      rugs.forEach((r,i)=>{const sig=[r.w,r.d,r.round,r.mat,r.color].join();let v=S.rugs.get(r.uid);if(!v||v.sig!==sig){if(v){rugsG.remove(v.g);v.g.traverse(c=>{if(c.geometry)c.geometry.dispose()})}v=makeRug(r);v.sig=sig;S.rugs.set(r.uid,v)}v.it=r;v.m.position.y=.004+i*.0015;v.ol.position.y=.009+i*.0015;placeRug(v)});applyLook()}
    function syncItems(items){const keep=new Set(items.map(i=>i.uid));for(const [k,v] of S.items){if(!keep.has(k)){itemsG.remove(v.g);v.g.traverse(c=>{if(c.geometry)c.geometry.dispose()});S.items.delete(k)}}
      items.forEach(it=>{const p=byId(it);const signature=JSON.stringify([p.lid,p.vid,p.img,p.cutout,p.dimsCm,p.model,p.modelLow,p.hangs]);let v=S.items.get(it.uid);if(!v||v.signature!==signature){if(v){itemsG.remove(v.g)}v=makeItem(it);v.pid=it.pid;v.signature=signature;S.items.set(it.uid,v);if(S.ready&&!it.hang)v.drop=performance.now()}v.it=it;placeItem(v)});applyLook()}
    function placeItem(v){const it=v.it,d=S.doc;const y=it.hang?d.H-v.hb/2-.05:0;v.baseY=y;v.g.position.set(it.x,y,it.z);v.g.rotation.y=(it.rot||0)*Math.PI/180;v.fp.position.y=it.hang?-y+.012:.012}
    function applyLook(){const st=S.style,plan=S.view==='plan';
      S.surfaces.forEach(m=>{m.material=st==='material'?m.userData.fin:st==='clay'?CLAY:LINE});
      S.edges.forEach(e=>e.visible=st!=='material'||plan);edgeM.color.set(st==='clay'&&!plan?'#9C8E7E':'#1E1B19');if(S.ceil)S.ceil.visible=S.view==='eye';(S.ceils||[]).forEach(c=>c.visible=S.view==='eye');if(S.underlay)S.underlay.visible=plan;
      for(const [k,v] of S.rugs){const isSel=k===S.sel;v.m.material=plan?PLANRUG:st==='material'?v.m.userData.fin:st==='clay'?CLAY:LINE;v.ol.material=isSel?selM:fpM}
      scene.environment=st==='material'&&!plan?envTex:null;
      for(const [k,v] of S.items){const isSel=k===S.sel;const mat=st==='material'&&!plan;const model=v.modelState==='ready',loading=v.modelState==='loading';
        // Material look: the model when it has one, a clay block of the right size while it loads, else the photo cutout.
        const showProxy=plan||st!=='material'||loading;v.proxy.visible=showProxy;v.proxy.material=plan?(isSel?PLANSEL:PLANM):st==='line'?LINE:CLAY;
        if(v.model)v.model.visible=!plan&&st!=='line'&&model;if(v.model&&st==='clay')v.model.traverse(o=>{if(o.isMesh){o.userData.fin??=o.material;o.material=CLAY}});if(v.model&&st==='material')v.model.traverse(o=>{if(o.isMesh&&o.userData.fin)o.material=o.userData.fin});
        if(v.model&&st==='clay')v.proxy.visible=false;v.cs.visible=!v.it.hang&&!plan&&st!=='line';
        v.pe.visible=showProxy&&(st!=='material'||plan||isSel);v.pe.material=isSel?selM:edgeM;v.bb.visible=mat&&!model&&!loading;v.fp.visible=plan||isSel;v.fp.material=isSel?selM:fpM;
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
    const size={w:1,h:1};function resize(){const r=vp.getBoundingClientRect();size.w=r.width;size.h=r.height;renderer.setSize(r.width,r.height,false);persp.aspect=r.width/r.height;persp.updateProjectionMatrix();composer?.setSize(r.width,r.height)}
    const ro=new ResizeObserver(resize);ro.observe(vp);resize();
    function camera(){const d=S.doc;if(S.view==='plan'){const a=size.w/size.h;const half=(Math.max(d.D,d.W/a)/2+1.2)/S.plan.zoom;ortho.left=-half*a;ortho.right=half*a;ortho.top=half;ortho.bottom=-half;ortho.position.set(S.plan.x,30,S.plan.z);ortho.up.set(0,0,-1);ortho.lookAt(S.plan.x,0,S.plan.z);ortho.updateProjectionMatrix();return ortho}
      if(S.view==='eye'){const e=S.eye;persp.fov=60;persp.updateProjectionMatrix();persp.up.set(0,1,0);persp.position.set(e.x,1.5,e.z);persp.lookAt(e.x+Math.sin(e.yaw)*Math.cos(e.pitch),1.5+Math.sin(e.pitch),e.z-Math.cos(e.yaw)*Math.cos(e.pitch));return persp}
      if(S.view==='product'){const v=S.sel&&S.items.get(S.sel);if(v){const c=v.g.position,R=Math.max(v.w,v.d,v.hp)*2.4+.6,ph=1.1;persp.fov=34;persp.updateProjectionMatrix();persp.up.set(0,1,0);
        persp.position.set(c.x+R*Math.sin(ph)*Math.sin(S.prod.th),(v.it.hang?c.y:0)+v.hp*.5+R*Math.cos(ph),c.z+R*Math.sin(ph)*Math.cos(S.prod.th));persp.lookAt(c.x,(v.it.hang?c.y:0)+v.hp*.45,c.z);return persp}}
      const c=S.cam;persp.fov=40;persp.updateProjectionMatrix();persp.up.set(0,1,0);persp.position.set(c.tx+c.r*Math.sin(c.ph)*Math.sin(c.th),c.ty+c.r*Math.cos(c.ph),c.tz+c.r*Math.sin(c.ph)*Math.cos(c.th));persp.lookAt(c.tx,c.ty,c.tz);return persp}
    // picking & dragging
    const ray=new T.Raycaster(),ndc=new T.Vector2(),floorP=new T.Plane(new T.Vector3(0,1,0),0),hit=new T.Vector3();
    const setNdc=e=>{const r=cv.getBoundingClientRect();ndc.set((e.clientX-r.left)/r.width*2-1,-((e.clientY-r.top)/r.height*2-1));ray.setFromCamera(ndc,S.camObj)};
    const floorAt=e=>{setNdc(e);return ray.ray.intersectPlane(floorP,hit)?hit.clone():null};
    const pickItem=e=>{setNdc(e);const hits=ray.intersectObjects([...S.items.values()].map(v=>v.proxy),false);if(hits.length)return hits[0].object.userData.uid;const rh=ray.intersectObjects([...S.rugs.values()].map(v=>v.m),false);return rh.length?rh[0].object.userData.uid:null};
    const snapV=v=>S.snap?Math.round(v/.05)*.05:v;
    // Orbit stays between 10° and 85° above the floor, all the way round.
    const PH_MIN=5*Math.PI/180,PH_MAX=80*Math.PI/180;
    const touch2=()=>{const [a,b]=[...S.touches.values()];return {d:Math.hypot(a.x-b.x,a.y-b.y),x:(a.x+b.x)/2,y:(a.y+b.y)/2}};
    const onDown=e=>{vp.focus();if(e.pointerType==='touch'){S.touches.set(e.pointerId,{x:e.clientX,y:e.clientY});if(S.touches.size===2){const t=touch2();S.drag={kind:'touch2',...t,r:S.cam.r,zoom:S.plan.zoom};return}if(S.touches.size>2)return}S.vel={th:0,ph:0};const id=pickItem(e);if(id&&e.button===0&&S.rugs.has(id)){const v=S.rugs.get(id);const f=floorAt(e);api.select(id);S.drag={kind:'rug',id,off:f?{x:v.it.x-f.x,z:v.it.z-f.z}:{x:0,z:0},moved:false};cv.setPointerCapture(e.pointerId);return}
      if(id&&e.button===0){const v=S.items.get(id);if(v.it.lock){api.select(id);return}const f=floorAt(e);api.select(id);S.drag={kind:'item',id,off:f?{x:v.it.x-f.x,z:v.it.z-f.z}:{x:0,z:0},moved:false};cv.setPointerCapture(e.pointerId);return}
      if(!id&&e.button===0&&!e.shiftKey)api.select(null);S.drag={kind:e.button===2||e.shiftKey?'pan':'cam',x:e.clientX,y:e.clientY};cv.setPointerCapture(e.pointerId)};
    const onMove=e=>{if(S.touches.has(e.pointerId))S.touches.set(e.pointerId,{x:e.clientX,y:e.clientY});const g=S.drag;if(!g)return;const d=S.doc;
      if(g.kind==='touch2'){if(S.touches.size<2)return;const t=touch2();const k=g.d/Math.max(1,t.d);if(S.view==='plan')S.plan.zoom=Math.max(.5,Math.min(4,g.zoom/k));else S.cam.r=Math.max(2,Math.min(32,g.r*k));
        const dx=t.x-g.x,dy=t.y-g.y;g.x=t.x;g.y=t.y;if(S.view==='plan'){const kk=(ortho.right-ortho.left)/size.w;S.plan.x-=dx*kk;S.plan.z-=dy*kk}else{const c=S.cam;const kk=c.r*.0016;c.tx-=Math.cos(c.th)*dx*kk;c.tz+=Math.sin(c.th)*dx*kk;c.ty=Math.max(0,Math.min(3,c.ty+dy*kk))}return}
      if(g.kind==='rug'){const f=floorAt(e);if(!f)return;const v=S.rugs.get(g.id);const [nx,nz]=rugClamp(d,v.it,snapV(f.x+g.off.x),snapV(f.z+g.off.z));v.it={...v.it,x:nx,z:nz};placeRug(v);g.moved=true;return}
      if(g.kind==='item'){const f=floorAt(e);if(!f)return;const v=S.items.get(g.id);const dn={...d,items:[...S.items.values()].map(x=>x.it)};const it=v.it;let [nx,nz]=plClamp(dn,it,snapV(f.x+g.off.x),snapV(f.z+g.off.z));if(!plHit(dn,it,it.x,it.z)&&plHit(dn,it,nx,nz)){const [ax,az]=plClamp(dn,it,nx,it.z),[bx,bz]=plClamp(dn,it,it.x,nz);if(!plHit(dn,it,ax,az)){nx=ax;nz=az}else if(!plHit(dn,it,bx,bz)){nx=bx;nz=bz}else{nx=it.x;nz=it.z}}v.it={...it,x:nx,z:nz};placeItem(v);g.moved=true;return}
      const dx=e.clientX-g.x,dy=e.clientY-g.y;g.x=e.clientX;g.y=e.clientY;
      if(S.view==='plan'){const k=(ortho.right-ortho.left)/size.w;S.plan.x-=dx*k;S.plan.z-=dy*k;return}
      if(S.view==='eye'){S.eye.yaw+=dx*.004;S.eye.pitch=Math.max(-.6,Math.min(.5,S.eye.pitch-dy*.003));return}
      if(g.kind==='pan'){const c=S.cam;const k=c.r*.0016;c.tx-=(Math.cos(c.th)*dx)*k;c.tz-=(-Math.sin(c.th)*dx)*k;c.ty=Math.max(0,Math.min(3,c.ty+dy*k));return}
      if(S.view==='product'){S.prod.th-=dx*.008;S.prod.auto=false;return}
      S.vel={th:-dx*.006,ph:-dy*.005};S.cam.th+=S.vel.th;S.cam.ph=Math.max(PH_MIN,Math.min(PH_MAX,S.cam.ph+S.vel.ph))};
    const onUp=e=>{S.touches.delete(e.pointerId);const g=S.drag;if(g?.kind==='touch2'&&S.touches.size)return;S.drag=null;if(g?.kind!=='cam')S.vel={th:0,ph:0};if(g&&(g.kind==='item'||g.kind==='rug')&&g.moved){const v=(g.kind==='rug'?S.rugs:S.items).get(g.id);api.onMoved(g.id,{x:+v.it.x.toFixed(2),z:+v.it.z.toFixed(2)})}};
    const onWheel=e=>{e.preventDefault();const s=Math.sign(e.deltaY);if(S.view==='plan')S.plan.zoom=Math.max(.5,Math.min(4,S.plan.zoom*(s>0?.9:1.1)));else if(S.view==='eye'){const d=S.doc;S.eye.x=Math.max(-d.W/2+.4,Math.min(d.W/2-.4,S.eye.x-Math.sin(S.eye.yaw)*s*.35));S.eye.z=Math.max(-d.D/2+.4,Math.min(d.D/2+.4,S.eye.z+Math.cos(S.eye.yaw)*s*.35))}else S.cam.r=Math.max(2,Math.min(32,S.cam.r*(s>0?1.08:.93)))};
    // Double-click a piece to bring the orbit round to it.
    const onDbl=e=>{if(S.view!=='orbit')return;const id=pickItem(e);const v=id&&S.items.get(id);if(!v)return;S.focus={tx:v.it.x,ty:Math.min(1.2,v.hp/2),tz:v.it.z,r:Math.max(2.2,Math.max(v.w,v.d)*3)}};
    const onKey=(e,on)=>{if(editorShortcutsBlocked(e)){S.keys.clear();return;}const k={w:'f',arrowup:'f',s:'b',arrowdown:'b',a:'l',arrowleft:'l',d:'r',arrowright:'r'}[e.key.toLowerCase()];if(!k||S.view!=='eye')return;if(on){S.keys.add(k);e.preventDefault()}else S.keys.delete(k)};
    const kd=e=>onKey(e,true),ku=e=>onKey(e,false),stopWalking=()=>S.keys.clear();addEventListener('keydown',kd);addEventListener('keyup',ku);addEventListener('blur',stopWalking);document.addEventListener('focusin',stopWalking);cv.addEventListener('dblclick',onDbl);
    const onDrop=e=>{e.preventDefault();const pid=+e.dataTransfer.getData('text/pid');if(!pid)return;const f=floorAt(e);api.onDrop(pid,f?snapV(f.x):0,f?snapV(f.z):0)};
    cv.addEventListener('pointerdown',onDown);cv.addEventListener('pointermove',onMove);cv.addEventListener('pointerup',onUp);cv.addEventListener('pointercancel',onUp);cv.addEventListener('wheel',onWheel,{passive:false});cv.addEventListener('contextmenu',e=>e.preventDefault());cv.addEventListener('dragover',e=>e.preventDefault());cv.addEventListener('drop',onDrop);
    // labels (plan names, room dims, distances)
    const tmp=new T.Vector3();
    function labels(){const el=labRef.current;if(!el)return;const d=S.doc;const u=S.units;const out=[];const proj=(x,y,z)=>{tmp.set(x,y,z).project(S.camObj);return [(tmp.x+1)/2*size.w,(1-tmp.y)/2*size.h,tmp.z<1]};
      const lab=(cls,p,t)=>{if(p[2])out.push({className:cls,x:p[0],y:p[1],text:t})};
      if(S.view==='plan'&&d.zones?.length){const t=d.wallT||.12;for(const zn of d.zones){const cw=polyArea(zn.poly)>0;zn.poly.forEach((a,i)=>{const b=zn.poly[(i+1)%zn.poly.length];const len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.3)return;const ux=(b[0]-a[0])/len,uz=(b[1]-a[1])/len;const nx=cw?uz:-uz,nz=cw?-ux:ux;lab('dim',proj((a[0]+b[0])/2+nx*(t+.3),0,(a[1]+b[1])/2+nz*(t+.3)),fmtLen(len,u))});
          const c=polyCentre(zn.poly);const seats=d.items.filter(it=>!it.hang&&inPoly([it.x,it.z],zn.poly)).reduce((s2,it)=>s2+byId(it).seats,0);lab('zone',proj(c[0],0,c[1]),`${zn.name} · ${seats} seat${seats===1?'':'s'}`)}
        for(const v of S.rugs.values()){const r=v.it;lab('rug'+(r.uid===S.sel?' sel':''),proj(r.x,0,r.z+rugExt(r)[1]-.22),`Rug · ${r.size}`)}
        for(const v of S.items.values())lab(v.it.uid===S.sel?'sel':'',proj(v.it.x,0,v.it.z),byId(v.it).name)}
      else if(S.view==='plan'){const t=d.wallT||.12;lab('dim',proj(0,0,-d.D/2-t-.35),fmtLen(d.W,u));lab('dim',proj(0,0,d.D/2+.45),fmtLen(d.W,u));lab('dim',proj(-d.W/2-t-.45,0,0),fmtLen(d.D,u));lab('dim',proj(d.W/2+t+.55,0,0),fmtLen(d.D,u));
        for(const v of S.rugs.values()){const r=v.it;lab('rug'+(r.uid===S.sel?' sel':''),proj(r.x,0,r.z+rugExt(r)[1]-.22),`Rug · ${r.size}`)}
        for(const v of S.items.values())lab(v.it.uid===S.sel?'sel':'',proj(v.it.x,0,v.it.z),byId(v.it).name)}
      const sv=S.sel&&(S.items.get(S.sel)||S.rugs.get(S.sel));const lines=[];
      if(sv&&S.view!=='eye'){const it=sv.it;const isRug=S.rugs.has(S.sel);const [hw,hd]=isRug?rugExt(it):plExt(it);
        // Distances to the nearest wall in each direction; a drawn plan casts against every wall it has.
        const hitWall=(x,z,dx,dz)=>{if(!d.zones?.length)return dx?[dx>0?d.W/2:-d.W/2,z]:[x,dz>0?d.D/2:-d.D/2];let best=Infinity;for(const zn of d.zones)zn.poly.forEach((a,i)=>{const b=zn.poly[(i+1)%zn.poly.length];
          const ex=b[0]-a[0],ez=b[1]-a[1],den=dx*ez-dz*ex;if(Math.abs(den)<1e-9)return;const tt=((a[0]-x)*ez-(a[1]-z)*ex)/den,uu=((a[0]-x)*dz-(a[1]-z)*dx)/den;if(tt>=0&&uu>=0&&uu<=1&&tt<best)best=tt});return best<Infinity?[x+dx*best,z+dz*best]:[x,z]};
        const segs=[[-1,0],[1,0],[0,-1],[0,1]].map(([dx,dz])=>{const sx=it.x+dx*hw,sz=it.z+dz*hd;const [hx,hz]=hitWall(sx,sz,dx,dz);return [sx,sz,hx,hz]});
        // The nearest other piece, measured edge to edge along whichever axis separates them.
        if(!isRug){let best=null;for(const o of S.items.values()){if(o.it.uid===it.uid||!!o.it.hang!==!!it.hang)continue;const [ow,od]=plExt(o.it);const gx=Math.abs(o.it.x-it.x)-hw-ow,gz=Math.abs(o.it.z-it.z)-hd-od;
          const gap=Math.max(gx,gz);if(gap<=0)continue;if(!best||gap<best.gap){const sx=Math.sign(o.it.x-it.x),sz=Math.sign(o.it.z-it.z);best={gap,seg:gx>=gz?[it.x+sx*hw,it.z,it.x+sx*(hw+gx),it.z]:[it.x,it.z+sz*hd,it.x,it.z+sz*(hd+gz)]}}}
          if(best&&best.gap<4)segs.push(best.seg)}
        segs.forEach(([x1,z1,x2,z2])=>{const len=Math.hypot(x2-x1,z2-z1);if(len<.01)return;lines.push([x1,z1,x2,z2]);lab('dist',proj((x1+x2)/2,.03,(z1+z2)/2),fmtLen(len,u))});
        if(!isRug){const D=byId(it).dimsCm;if(D)lab('size',proj(it.x,(it.hang?sv.g.position.y:0)+sv.hp+.18,it.z),`${fmtCm(D.w,u)} W × ${fmtCm(D.d,u)} D × ${fmtCm(D.h,u)} H`)}}
      // Rebuild the measure lines and labels only when they change, so an idle view costs nothing.
      const lk=JSON.stringify(lines);if(lk!==S.lineKey){S.lineKey=lk;clear(dimG);lines.forEach(([x1,z1,x2,z2])=>dimG.add(new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(x1,.03,z1),new T.Vector3(x2,.03,z2)]),dimM)))}
      const key=JSON.stringify(out);if(key!==S.labHtml){S.labHtml=key;renderPlannerLabels(el,out)}}
    const bounce=t=>{const n=7.5625,k=2.75;return t<1/k?n*t*t:t<2/k?n*(t-=1.5/k)*t+.75:t<2.5/k?n*(t-=2.25/k)*t+.9375:n*(t-=2.625/k)*t+.984375};
    const walk=dt=>{if(!S.keys.size)return;const e=S.eye,d=S.doc,sp=1.4*dt;let f=(S.keys.has('f')?1:0)-(S.keys.has('b')?1:0),st=(S.keys.has('r')?1:0)-(S.keys.has('l')?1:0);
      const dx=(Math.sin(e.yaw)*f+Math.cos(e.yaw)*st)*sp,dz=(-Math.cos(e.yaw)*f+Math.sin(e.yaw)*st)*sp;const free=(x,z)=>Math.abs(x)<d.W/2-.3&&Math.abs(z)<d.D/2-.3&&![...S.items.values()].some(v=>{if(v.it.hang)return false;const [a,b]=plExt(v.it);return Math.abs(x-v.it.x)<a+.25&&Math.abs(z-v.it.z)<b+.25});
      if(free(e.x+dx,e.z))e.x+=dx;if(free(e.x,e.z+dz))e.z+=dz};
    let raf=0,run=true;const loop=()=>{if(!run)return;const now=performance.now();const dt=Math.min(.05,(now-S.last)/1000);S.last=now;
      if(!S.drag&&S.view==='orbit'&&(Math.abs(S.vel.th)>1e-4||Math.abs(S.vel.ph)>1e-4)){S.cam.th+=S.vel.th;S.cam.ph=Math.max(PH_MIN,Math.min(PH_MAX,S.cam.ph+S.vel.ph));S.vel.th*=.9;S.vel.ph*=.9}
      if(S.focus){const c=S.cam,f=S.focus,k=1-Math.pow(.001,dt);c.tx+=(f.tx-c.tx)*k;c.ty+=(f.ty-c.ty)*k;c.tz+=(f.tz-c.tz)*k;c.r+=(f.r-c.r)*k;if(Math.abs(f.r-c.r)<.01)S.focus=null}
      if(S.view==='eye')walk(dt);if(S.view==='product'&&S.prod.auto&&!S.drag)S.prod.th+=dt*.35;
      S.camObj=camera();
      // The high-detail model loads once the camera comes within 3.5 m of a piece.
      for(const v of S.items.values()){const p=byId(v.it);if(v.model&&p.modelLow&&!v.hi&&S.view!=='plan'&&S.camObj.position.distanceTo(v.g.position)<3.5){v.hi=true;loadGLB(p.model,renderer).then(obj=>{if(!S.alive||S.items.get(v.it.uid)!==v||!v.model)return;fitToDims(T,obj,p.dimsCm);obj.position.y=v.model.position.y;v.g.remove(v.model);v.g.add(obj);v.model=obj;applyLook()}).catch(()=>{})}}for(const v of S.items.values()){if(v.drop!=null){const t=Math.min(1,(now-v.drop)/520);v.g.position.y=v.baseY+.45*(1-bounce(t));if(t>=1)v.drop=null}}for(const v of S.items.values()){if(v.bb.visible){const wp=v.g.position;v.bb.rotation.y=Math.atan2(S.camObj.position.x-wp.x,S.camObj.position.z-wp.z)-v.g.rotation.y}}// Hold frame rate: if frames run long for about a second, ambient occlusion steps aside.
      {const raw=now-(S.prev??now);S.prev=now;if(raw>24)S.slowT=(S.slowT||0)+raw;else S.slowT=Math.max(0,(S.slowT||0)-raw);if(S.slowT>1500)S.aoOff=true}
      lights();if(composer&&aoPass&&!S.aoOff&&S.style==='material'&&S.view!=='plan'){composer.rp.camera=S.camObj;aoPass.camera=S.camObj;composer.render()}else renderer.render(scene,S.camObj);labels();raf=requestAnimationFrame(loop)};
    const api={select:id=>{S.sel=id;applyLook();E.current.onSelect&&E.current.onSelect(id)},onMoved:(id,o)=>E.current.onMoved&&E.current.onMoved(id,o),onDrop:(pid,x,z)=>E.current.onDrop&&E.current.onDrop(pid,x,z)};
    // Still render: a progressive path tracer refines the current view into a photograph with real
    // bounced light, at 2560 × 1440, for up to 18 seconds. Where it can't run, a high-quality raster frame stands in.
    async function still(onProgress,W=2560,H=1440){
      if(S.view==='plan')throw new Error('Switch to Orbit or Walk to render.');
      const cam=S.camObj.clone();cam.aspect=W/H;cam.updateProjectionMatrix();
      const hidden=[];scene.traverse(o=>{if(o.visible&&(o.isLine||o.isLineSegments||o.isSprite||o===grid||o===sky||o===ground)){hidden.push(o);o.visible=false}});
      return withRestoredVisibility(hidden,async()=>{
        for(const v of S.items.values()){const p=byId(v.it);if(v.model&&p.modelLow&&!v.hi){v.hi=true;try{const obj=await loadGLB(p.model,renderer);fitToDims(T,obj,p.dimsCm);obj.position.y=v.model.position.y;v.g.remove(v.model);v.g.add(obj);v.model=obj}catch(e){}}}
        const configure=off=>{off.setSize(W,H,false);off.outputColorSpace=T.SRGBColorSpace;off.toneMapping=T.ACESFilmicToneMapping;off.toneMappingExposure=renderer.toneMappingExposure;off.shadowMap.enabled=true;off.shadowMap.type=T.PCFSoftShadowMap;off.setClearColor(renderer.getClearColor(new T.Color()));};
        try{
          if(!canTrace(renderer)||window.__forceTrace===false)throw new Error('This device renders stills without path tracing.');
          const {WebGLPathTracer}=await import('three-gpu-pathtracer');
          return await usingDisposable(()=>new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true}),async off=>{
            configure(off);const sky=renderer.getClearColor(new T.Color());
            return usingDisposable(()=>new T.DataTexture(new Float32Array([sky.r,sky.g,sky.b,1,sky.r,sky.g,sky.b,1,.35,.3,.26,1,.35,.3,.26,1]),2,2,T.RGBAFormat,T.FloatType),async env=>{
              env.mapping=T.EquirectangularReflectionMapping;env.needsUpdate=true;
              const prevEnv=scene.environment,prevBg=scene.background;
              try{
                scene.environment=env;scene.background=sky;
                if(!('environmentRotation' in T.Scene.prototype)){T.Scene.prototype.environmentRotation=new T.Euler();T.Scene.prototype.backgroundRotation=new T.Euler()}
                return await usingDisposable(()=>new WebGLPathTracer(off),async pt=>{
                  pt.tiles.set(2,2);pt.setScene(scene,cam);const t0=performance.now();let n=0;
                  while(performance.now()-t0<18000&&n<600){pt.renderSample();n++;onProgress&&onProgress(Math.min(1,(performance.now()-t0)/18000),n);await new Promise(r=>setTimeout(r,0))}
                  return {url:off.domElement.toDataURL('image/jpeg',.94),samples:n,traced:true};
                });
              }finally{scene.environment=prevEnv;scene.background=prevBg;}
            });
          });
        }catch(e){
          console.warn('Path tracing unavailable; rendering a raster still instead.',e);
          return usingDisposable(()=>new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true}),off=>{
            configure(off);off.render(scene,cam);
            return {url:off.domElement.toDataURL('image/jpeg',.94),samples:0,traced:false};
          });
        }
      });
    }
    Object.assign(E.current,{S,buildRoom,syncItems,syncRugs,applyLook,api,still,snapshot:()=>{renderer.render(scene,S.camObj);return cv.toDataURL('image/jpeg',.92)}});
    loop();setEng(n=>n+1);
    return()=>{run=false;S.alive=false;cancelAnimationFrame(raf);ro.disconnect();removeEventListener('keydown',kd);removeEventListener('keyup',ku);removeEventListener('blur',stopWalking);document.removeEventListener('focusin',stopWalking);scene.traverse(o=>{if(o.geometry)o.geometry.dispose()});pmrem.dispose();envTex?.dispose();composer?.dispose?.();renderer.dispose()};
  },[three]);
  // wire engine callbacks to React
  useEffect(()=>{Object.assign(E.current,{onSelect:id=>setSel(id),onMoved:(id,o)=>patchSel(id,o),onDrop:(pid,x,z)=>addItem(pid,x,z)})});
  const geoKey=JSON.stringify([doc.W,doc.D,doc.H,doc.wallT,doc.wall,doc.floor,doc.floorTint,doc.openings,doc.wallImg?doc.wallImg.length:0,doc.zones,doc.blocks,doc.underlay?{...doc.underlay,img:doc.underlay.img.length}:null]);
  useEffect(()=>{const e=E.current;if(!e.buildRoom)return;e.buildRoom(doc);e.syncItems(doc.items);setTimeout(()=>{if(e.S)e.S.ready=true},50)},[geoKey,eng]);
  const catalogSignature=JSON.stringify(doc.items.map(it=>byId(it)));
  const sceneRevision=useRef(0),previousSceneInputs=useRef('');
  const sceneInputs=JSON.stringify([doc,catalogSignature,view,style,tod,title,units]);
  if(previousSceneInputs.current!==sceneInputs){previousSceneInputs.current=sceneInputs;sceneRevision.current++}
  useEffect(()=>setShareImg(null),[catalogSignature]);
  useEffect(()=>{const e=E.current;if(e.syncItems)e.syncItems(doc.items)},[doc.items,eng,catalogSignature]);
  useEffect(()=>{const e=E.current;if(e.syncRugs)e.syncRugs(doc.rugs||[])},[doc.rugs,eng]);
  useEffect(()=>{const e=E.current;if(!e.S)return;e.S.view=view;e.S.style=style;e.S.tod=tod;e.S.snap=snap;e.S.sel=sel;e.S.units=units;if(view==='product')e.S.prod.auto=true;e.applyLook()},[view,style,tod,snap,sel,units,eng]);
  useEffect(()=>{const k=e=>{if(editorShortcutsBlocked(e))return;if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();e.shiftKey?redo():undo();return}
      if(e.key==='Escape'&&!sel){setDrawer(null);setLookOpen(false);return}
      if(e.key==='1')setView('plan');if(e.key==='2')setView('orbit');if(e.key==='3')setView('eye');if(e.key==='4'&&S0)setView('product');
      if(view==='eye'&&/^(w|a|s|d|arrow\w+)$/i.test(e.key))return;
      const it=sel&&(docRef.current.items.find(i=>i.uid===sel)||rugOf(sel));if(!it)return;
      if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();removeItem(sel)}if(e.key==='r'||e.key==='R')patchSel(sel,{rot:((it.rot||0)+(e.shiftKey?-15:15)+360)%360});if(e.key==='d'&&!e.ctrlKey)dupItem(sel);if(e.key==='Escape')setSel(null);
      const step=e.shiftKey?.25:.05;const mv={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[e.key];if(mv){e.preventDefault();patchSel(sel,{x:+(it.x+mv[0]).toFixed(2),z:+(it.z+mv[1]).toFixed(2)})}};
    addEventListener('keydown',k);return()=>removeEventListener('keydown',k)});

  // ---------- derived ----------
  const S0=doc.items.find(i=>i.uid===sel);const SD=S0&&plDims(S0);const R0=!S0&&(doc.rugs||[]).find(r=>r.uid===sel);
  const rugName=r=>`${r.color?RUG_COLORS.find(c=>c[0]===r.color)?.[1].toLowerCase()+' ':''}${r.mat} rug, ${r.size}`;
  const pieces=doc.items.map(i=>byId(i));const retail=pieces.reduce((s,p)=>s+p.price,0);const seats=pieces.reduce((s,p)=>s+p.seats,0);
  const todLabel=(()=>{const m=Math.round((7.5*60+tod*15.5*60)/10)*10;return `${String(Math.floor(m/60)%24).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`})();
  const prompt=`Photorealistic interior photograph of a ${doc.W} × ${doc.D} m room with a ${doc.H} m ceiling. Walls in ${doc.wall} limewash plaster, ${PL_FLOORS.find(f=>f[0]===doc.floor)?.[1].toLowerCase()} floor. Openings: ${doc.openings.map(o=>`${o.t==='arch'?'an arched window':o.t==='door'?'a doorway':'a window'} on the ${o.wall} wall`).join(', ')||'none'}.\n${(doc.rugs||[]).length?`Rugs: ${doc.rugs.map(r=>`a ${rugName(r)} at ${plWord(r,doc)}`).join('; ')}.\n`:''}Furnished with exactly these Louie Mae pieces, matching their product photos: ${doc.items.map(i=>{const p=byId(i);return `${p.name} ${p.line} at ${plWord(i,doc)}`}).join('; ')||'no furniture yet'}.\nLight: ${tod<.35?'soft morning daylight':tod<.7?'warm golden-hour sun':'after dark, lit by warm lamps'} (${todLabel}). Three-quarter view at 1.3 m height, 26 mm lens, straight verticals, editorial interior photography. No people, no text.`;
  const prods=PRODUCTS.filter(p=>(cat==='all'||p.type===cat)&&(p.name+' '+p.line+' '+p.mat).toLowerCase().includes(q.toLowerCase()));
  const setOpening=(i,o)=>commit({...doc,openings:doc.openings.map((x,k)=>k===i?{...x,...o}:x)});
  const planWalls=doc.zones?.length?doc.zones.flatMap(z=>z.poly.map((a,i)=>{const b=z.poly[(i+1)%z.poly.length];return [`${z.id}:${i}`,`${z.name} · wall ${i+1}`,Math.hypot(b[0]-a[0],b[1]-a[1])]})):null;
  const wallLen=w=>planWalls?(planWalls.find(x=>x[0]===w)?.[2]??4):w==='back'?doc.W:doc.D;
  const applyPlan=r=>{setPlanOpen(false);if(!r){commit(plReflow({...doc,zones:undefined,blocks:undefined,underlay:undefined,openings:doc.openings.filter(o=>['back','left','right'].includes(o.wall))}));ctx.toast('Back to a rectangular room',{label:'Undo',fn:undo});return}
    const ok=new Set(r.zones.flatMap(z=>z.poly.map((_,i)=>`${z.id}:${i}`)));commit(plReflow({...doc,...r,openings:doc.openings.filter(o=>ok.has(o.wall))}));ctx.toast('Floor plan in place',{label:'Undo',fn:undo})};
  const plRows=editorSelections(doc.items,products);
  const pickRail=k=>setDrawer(d=>d===k?null:k);
  const selRug=R0,selPiece=S0;
  // AI render: the current view and its written brief go to an image model; the member sees the
  // result here when it's ready and gets it by email too.
  const startAi=async()=>{if(!eng)return;if(!ctx.me.signedIn){setShowPrompt(false);ctx.toast('Sign in to make an AI render');ctx.signInThen('room');return}
    if(view==='plan'){ctx.toast('Switch to Orbit or Walk to make an AI render.');return}
    setAiBusy(true);try{const captured={doc:structuredClone(docRef.current),title,units};const S=E.current.S;const snap=await dataUrlBlob(E.current.snapshot());
      const pieces=[...new Set(doc.items.map(i=>byId(i)?.lid).filter(Boolean))].slice(0,6);
      const id=await createRender({title,prompt,snapshot:await snap.arrayBuffer(),camera:S?{view:S.view,orbit:S.cam,walk:S.eye}:undefined,pieces});
      setShowPrompt(false);setAiJob({id,...captured})}catch(e){ctx.toast(errText(e))}finally{setAiBusy(false)}};
  return html`<main className="sx planner2"><h1 className="sr">Room planner</h1>${!!doc.placementConflicts?.length&&html`<p role="alert" className="help">Some pieces could not be placed without overlap or outside the floor plan. Your pieces are preserved. Enlarge the room, move or remove these pieces: ${doc.items.filter(i=>doc.placementConflicts.includes(i.uid)).map(i=>byId(i).name).join(", ")}</p>`}
    <${SxTop} ctx=${ctx} title=${title} setTitle=${t=>setTitle(t.slice(0,TITLE_MAX))} view="3d" onView=${k=>{ctx.setStudioSeed({view:k==='room'?'room':'collage',sync:doc.items.map(currentIdentity)});ctx.go('studio')}} saved="Saved on this device" onShare=${()=>eng&&setShareImg({url:E.current.snapshot(),doc:structuredClone(docRef.current),title,units})}>
      <${SxMenu} ctx=${ctx} hist=${{undo,redo,canUndo:hist.current.past.length>0,canRedo:hist.current.future.length>0,steps:hist.current.past.length}}>
        <div className="sx-pop-sec"><span className="sx-lbl">Placing</span>
          <button className="toggle" onClick=${()=>setSnap(!snap)}><span>Snap to 5 cm and walls</span><span className=${'sw'+(snap?' on':'')}></span></button></div>
        <div className="sx-pop-sec"><span className="sx-lbl">Units</span><div className="seg" role="group" aria-label="Units">${[['m','Metres'],['ft','Feet and inches']].map(([k,l])=>html`<button key=${k} className=${units===k?'on':''} onClick=${()=>setUnits(k)}>${l}</button>`)}</div></div>
        <div className="sx-pop-sec"><span className="sx-lbl">This room</span>
          <button className="pop-item" data-close disabled=${!eng} onClick=${()=>setShot({url:E.current.snapshot(),doc:structuredClone(docRef.current),title,units})}>${I('cam',{width:16})} Snapshot</button>
          <button className="pop-item" data-close onClick=${async()=>{try{const signature=JSON.stringify(doc.items.map(i=>byId(i)));const generation=catalogGeneration;const blob=await planPdf(doc,{title,units,link:null,products});if(generation!==catalogGeneration||signature!==JSON.stringify(docRef.current.items.map(i=>byId(i)))||!E.current.S?.alive)throw Error('The catalog changed. Review your saved items and try again.');saveBlob(blob,fileName(title+'-plan','pdf'));ctx.toast('Plan PDF downloaded')}catch(e){ctx.toast(errText(e))}}}>${I('board',{width:16})} Download the plan as a PDF</button>
          <button className="pop-item" data-close disabled=${!eng||!doc.items.length} onClick=${()=>{const img=E.current.snapshot();const ids=doc.items.map(currentIdentity);const els=ids.slice(0,8).map((identity,i)=>({...mkImg(identity,0,'collage',SLOTS,'cutout'),x:4+i*12,y:84,w:11,rot:0}));ctx.setStudioSeed({collage:{id:uid(),title:(title+' view').slice(0,TITLE_MAX),mode:'collage',page:'landscape',shape:'rect',edge:'shadow',bg:{img},els}});ctx.go('studio')}}>${I('img',{width:16})} Send this view to the Studio</button>
          <button className="pop-item" data-close onClick=${()=>setShowPrompt(true)}>${I('wand',{width:16})} Render brief</button></div>
      <//>
    <//>
    <${SxRail} items=${[['add','Add','plus'],['layers','Layers','layers'],['room','Room','cube']]} open=${drawer} onPick=${pickRail}/>
    ${drawer==='room'&&html`<${SxDrawer} title="Room" onClose=${()=>setDrawer(null)}><div className="pl-sec sx-pl">
        <div className="pl-plan"><b>${doc.zones?.length?`Floor plan · ${doc.zones.length} room${doc.zones.length===1?'':'s'}`:'Your own floor plan'}</b><span className="help" style=${{margin:0}}>${doc.zones?.length?'Rooms, walls and columns from your plan.':'Upload a plan, set its scale, then trace L-shapes, alcoves and angled walls.'}</span>
          <button className="btn btn-line btn-sm" onClick=${()=>setPlanOpen(true)}>${doc.zones?.length?'Edit the floor plan':'Draw a floor plan'}</button></div>
        ${doc.zones?.length>0&&html`<div className="pl-zones">${doc.zones.map(z=>{const its=doc.items.filter(it=>inPoly([it.x,it.z],z.poly));const seats=its.filter(i=>!i.hang).reduce((s2,i)=>s2+byId(i).seats,0);const sub=its.reduce((s2,i)=>s2+pr(byId(i),ctx.mode),0);
          const setZ=o=>commit({...doc,zones:doc.zones.map(x=>x.id===z.id?{...x,...o}:x)});
          return html`<div key=${z.id} className="pl-zone"><div className="row" style=${{justifyContent:'space-between'}}><b>${z.name}</b><span className="mono">${its.length} pieces · ${seats} seats · ${fmt(sub)}</span></div>
            <div className="row" style=${{gap:6}}><select className="field" style=${{height:34}} value=${z.floor||doc.floor} onChange=${e=>setZ({floor:e.target.value})} aria-label=${z.name+' floor'}>${PL_FLOORS.map(([k,l])=>html`<option key=${k} value=${k}>${l}</option>`)}</select>
              <label className="pl-color" title="Wall colour" style=${{background:z.wall||doc.wall}}><input type="color" value=${z.wall||doc.wall} onChange=${e=>setZ({wall:e.target.value})} aria-label=${z.name+' wall colour'}/></label></div></div>`})}</div>`}
        ${!doc.zones?.length&&html`<${React.Fragment}><label className="lbl" htmlFor="pl-tpl">Start from</label>
        <select id="pl-tpl" className="field" value=${doc.tpl} onChange=${e=>setTplAsk(e.target.value)}>${Object.entries(PL_TEMPLATES).map(([k,t])=>html`<option key=${k} value=${k}>${t.label}</option>`)}</select><//>`}
        <div className="pl-dims">${(doc.zones?.length?[['H','Height',2.4,8]]:[['W','Width',3,30],['D','Depth',3,24],['H','Height',2.4,8]]).map(([k,l,mn,mx])=>{const ft=units==='ft',f=ft?3.28084:1;return html`<label key=${k}><span className="mono mute">${l} (${ft?'ft':'m'})</span><input className="field num" type="number" step=${ft?.25:.1} min=${+(mn*f).toFixed(2)} max=${+(mx*f).toFixed(2)} value=${+(doc[k]*f).toFixed(2)} onChange=${e=>{const v=Math.max(mn,Math.min(mx,(+e.target.value||mn*f)/f));commit(plReflow({...doc,[k]:r2(v)}))}}/></label>`})}</div>
        <label className="sx-col" style=${{gap:4}}><span className="mono mute">Wall thickness (${units==='ft'?'in':'cm'})</span><input className="field num" style=${{height:38}} type="number" min=${units==='ft'?2:5} max=${units==='ft'?24:60} step="1" value=${units==='ft'?Math.round((doc.wallT||.12)/.0254):Math.round((doc.wallT||.12)*100)} onChange=${e=>{const n=+e.target.value;if(!(n>0))return;const m=units==='ft'?n*.0254:n/100;commit({...doc,wallT:Math.max(.05,Math.min(.6,m))})}}/></label>
        <span className="lbl">Walls</span>
        <div className="swatches">${PL_WALLS.map(c=>html`<button key=${c} className=${doc.wall===c&&!doc.wallImg?'on':''} style=${{background:c}} aria-label=${'Wall '+c} onClick=${()=>commit({...doc,wall:c,wallImg:null})}></button>`)}<label className="pl-color" title="Custom colour"><input type="color" value=${doc.wall} onChange=${e=>commit({...doc,wall:e.target.value})} aria-label="Custom wall colour"/></label></div>
        <label className="btn btn-line btn-sm" style=${{cursor:'pointer'}}>${I('upload',{width:14})} Photo on back wall<input type="file" accept="image/*" hidden onChange=${e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>commit({...doc,wallImg:r.result});r.readAsDataURL(f)}}/></label>
        ${ctx.inspo.length>0&&html`<div className="pl-mini">${ctx.inspo.slice(0,6).map(x=>html`<button key=${x.id} title=${'Use '+x.title} onClick=${()=>commit({...doc,wallImg:x.src})}><img src=${x.src} alt=""/></button>`)}</div>`}
        <span className="lbl">Floor</span>
        <div className="pl-floors">${PL_FLOORS.map(([k,l])=>html`<button key=${k} className=${doc.floor===k?'on':''} onClick=${()=>commit({...doc,floor:k})}><i style=${{backgroundImage:`url(${texture(k).url})`}}></i>${l}</button>`)}</div>
        <span className="lbl">Floor colour</span>
        <div className="swatches">${PL_TINTS.map(([c,l])=>html`<button key=${l} title=${l} aria-label=${'Floor colour '+l} className=${(doc.floorTint||'')===c?'on':''} style=${{background:c||'linear-gradient(135deg,#fff 45%,#ccc 55%)'}} onClick=${()=>commit({...doc,floorTint:c})}></button>`)}<label className="pl-color" title="Custom floor colour"><input type="color" value=${doc.floorTint||'#ffffff'} onChange=${e=>commit({...doc,floorTint:e.target.value})} aria-label="Custom floor colour"/></label></div>
        ${!doc.zones?.length&&html`<span className="lbl">Back wall</span>`}
        ${!doc.zones?.length&&html`<div className="pl-floors">${PL_BACK.map(([k,l,f])=>html`<button key=${k} onClick=${()=>commit({...doc,openings:[...doc.openings.filter(o=>o.wall!=='back'),...plFit(doc.W,doc.H,f(doc.W,doc.H)).map(o=>({...o,wall:'back'}))]})}>${l}</button>`)}</div>`}
        <div className="row" style=${{justifyContent:'space-between'}}><span className="lbl" style=${{margin:0}}>Openings</span><button className="lnk" onClick=${()=>commit({...doc,openings:[...doc.openings,{wall:planWalls?planWalls[0][0]:'back',t:'win',x:0,w:1.4,h:1.8,y:.8}]})}>+ Add</button></div>
        ${doc.openings.map((o,i)=>{const L=wallLen(o.wall);return html`<div key=${i} className="pl-open">
          <div className="row" style=${{gap:6}}><select className="field" value=${o.wall} onChange=${e=>setOpening(i,{wall:e.target.value,x:0})} aria-label="Wall">${(planWalls||[['back','back wall'],['left','left wall'],['right','right wall']]).map(([w,l])=>html`<option key=${w} value=${w}>${l}</option>`)}</select>
          <select className="field" value=${o.t} onChange=${e=>{const t=e.target.value;setOpening(i,t==='door'?{t,y:.02,h:2.2,w:1}:t==='arch'?{t,y:.5,h:2.4,w:Math.max(1.4,o.w)}:{t,y:.8,h:1.8})}} aria-label="Type"><option value="win">Window</option><option value="arch">Arch</option><option value="door">Door</option></select>
          <button className="ib" aria-label="Remove opening" onClick=${()=>commit({...doc,openings:doc.openings.filter((_,k)=>k!==i)})}>${I('x',{width:14})}</button></div>
          <label className="pl-range"><span className="mono mute">Position</span><input type="range" min=${-L/2+o.w/2+.1} max=${L/2-o.w/2-.1} step="0.05" value=${o.x} onInput=${e=>setOpening(i,{x:+e.target.value})}/></label>
          <label className="pl-range"><span className="mono mute">Width ${o.w.toFixed(1)} m</span><input type="range" min=".6" max=${Math.min(6,L-.4)} step="0.1" value=${o.w} onInput=${e=>setOpening(i,{w:+e.target.value,x:Math.max(-L/2+ +e.target.value/2+.1,Math.min(L/2- +e.target.value/2-.1,o.x))})}/></label>
        </div>`})}
</div><//>`}
    ${drawer==='add'&&html`<${SxDrawer} title="Add" onClose=${()=>setDrawer(null)}><div className="pl-sec sx-pl">
        <span className="lbl">Rugs · layout guide</span>
        <p className="help" style=${{margin:0}}>Standard sizes. A rug lands under the selected piece, or in the middle of the room.</p>
        <div className="pl-floors">${RUG_SIZES.map(z=>html`<button key=${z[0]} onClick=${()=>addRug(z)}><i style=${{background:'#D8C7A6',borderRadius:z[3]?'50%':'3px',width:z[3]?22:Math.round(14+z[1]*4),height:z[3]?22:Math.round(10+z[2]*3)}}></i>${z[0]}</button>`)}</div>
        <span className="lbl">Pieces</span>
        <input className="field" style=${{height:40}} placeholder="Search pieces" aria-label="Search pieces" value=${q} onInput=${e=>setQ(e.target.value)}/>
        <div className="scroll-x">${[['all','All'],...Object.entries(TYPE)].map(([k,l])=>html`<button key=${k} className=${'chip'+(cat===k?' on':'')} style=${{height:30,fontSize:12}} onClick=${()=>setCat(k)}>${l}</button>`)}</div>
        <p className="help" style=${{margin:0}}>Click to place in the middle of the room, or drag onto the floor.</p>
        <div className="pl-cat">${prods.map(p=>html`<button key=${p.id} draggable="true" onDragStart=${e=>e.dataTransfer.setData('text/pid',String(p.id))} onClick=${()=>addItem(p.id,0,0)} title=${'Place '+p.name}><img src=${cut(p.id)} alt="" loading="lazy"/><b>${p.name}</b><span className="mono">${plCm(p.id)?Math.round(plCm(p.id))+' cm':'Measurements needed'} · ${ctx.mode==='trade'?fmt(tp(p)):fmt(p.price)}</span></button>`)}</div>
</div><//>`}
    ${drawer==='layers'&&html`<${SxDrawer} title="Layers" onClose=${()=>setDrawer(null)}><div className="pl-sec sx-pl">${doc.items.length?doc.items.map(it=>{const p=byId(it);return html`<div key=${it.uid} className=${'layer'+(sel===it.uid?' on':'')} ><button className="sx-layer-select" aria-label=${'Select '+p.name} aria-pressed=${sel===it.uid} onClick=${()=>setSel(it.uid)}><span className="th" style=${{backgroundImage:`url(${cut(it)})`,backgroundSize:'contain',backgroundRepeat:'no-repeat',backgroundPosition:'center'}}></span><span>${p.name}</span></button><button className="ib" aria-label=${it.lock?'Unlock':'Lock'} onClick=${e=>{e.stopPropagation();patchItem(it.uid,{lock:!it.lock})}}>${I(it.lock?'lock':'unlock')}</button><button className="ib" aria-label="Remove" onClick=${e=>{e.stopPropagation();removeItem(it.uid)}}>${I('trash')}</button></div>`}):html`<p className="help">No pieces yet. Add some from the Pieces tab.</p>`}
        ${(doc.rugs||[]).map(r=>html`<div key=${r.uid} className=${'layer'+(sel===r.uid?' on':'')} ><button className="sx-layer-select" aria-label=${'Select rug '+r.size} aria-pressed=${sel===r.uid} onClick=${()=>setSel(r.uid)}><span className="th" style=${{background:r.color||'#D8C7A6',borderRadius:r.round?'50%':'4px'}}></span><span>Rug · ${r.size}</span></button><button className="ib" aria-label="Remove" onClick=${e=>{e.stopPropagation();removeItem(r.uid)}}>${I('trash')}</button></div>`)}</div><//>`}

    <section className=${'sx-stagewrap'+(sel?' has-sel':'')}>
      <div className="pl-vp sx-vp" ref=${vpRef} tabIndex="0" aria-label="Room viewport">
        <canvas ref=${cvRef} className="pl-cv"></canvas>
        <div className="pl-labels" ref=${labRef} aria-hidden="true"></div>
        ${threeFailed&&html`<div className="pl-fail" role="alert">The 3D view could not load. Check your connection and reload the page to try again.</div>`}
        <div className="sx-viewbar" role="toolbar" aria-label="View">
          <div className="seg" role="group" aria-label="Camera">${[['plan','Plan','1'],['orbit','Orbit','2'],['eye','Walk','3'],['product','Product','4']].map(([k,l,n])=>html`<button key=${k} className=${view===k?'on':''} aria-pressed=${view===k} disabled=${k==='product'&&!S0} onClick=${()=>setView(k)} title=${k==='product'&&!S0?'Select a piece to turn it on its own':l+' ('+n+')'}>${l}</button>`)}</div>
          <div className="sx-more"><button className=${'sx-look'+(lookOpen?' on':'')} aria-expanded=${lookOpen} onClick=${()=>setLookOpen(!lookOpen)}>Look · ${style==='material'?'Render':style==='clay'?'Clay':'Line'}</button>
            ${lookOpen&&html`<div className="pop sx-pop" style=${{left:0,right:'auto'}}>
              <div className="sx-pop-sec"><span className="sx-lbl">Look</span><div className="seg" role="group" aria-label="Look">${[['material','Render'],['clay','Clay'],['line','Line']].map(([k,l])=>html`<button key=${k} className=${style===k?'on':''} onClick=${()=>setStyle(k)}>${l}</button>`)}</div></div>
              <div className="sx-pop-sec"><span className="sx-lbl">Time of day · ${todLabel}</span><input type="range" min="0" max="1" step="0.01" value=${tod} onInput=${e=>setTod(+e.target.value)} aria-label="Time of day" style=${{accentColor:'var(--cognac)'}}/></div>
            </div>`}</div>
          ${style==='material'&&view!=='plan'&&html`<button className="sx-look sx-render" disabled=${!eng||!!rendering} onClick=${async()=>{setRendering({p:0});try{const capturedDoc=structuredClone(docRef.current);const capturedTitle=title,capturedUnits=units;const r=await renderAtRevision(()=>sceneRevision.current,()=>E.current.still(pr=>setRendering({p:pr})));setRendering(null);if(!r){ctx.toast('The room changed while rendering. Render again to share the current room.');return}setShareImg({url:r.url,doc:capturedDoc,title:capturedTitle,units:capturedUnits});if(!r.traced)ctx.toast('This device rendered a quick still instead of a path-traced one.')}catch(e){setRendering(null);ctx.toast(errText(e))}}}>${I('cam',{width:14})} ${rendering?`Rendering ${Math.round(rendering.p*100)}%`:'Render'}</button>`}
          ${view!=='plan'&&html`<button className="sx-look sx-render" disabled=${!eng||aiBusy} onClick=${startAi} title="A photoreal picture of this view, made by AI">${I('wand',{width:14})} ${aiBusy?'Sending…':'AI render'}</button>`}
        </div>
        <div className="pl-hint sx-hint">${view==='plan'?'Drag to pan · scroll to zoom · drag a piece to move it':view==='eye'?'WASD or arrows to walk · drag to look':view==='product'?'Drag to turn the piece':'Drag to orbit · right-drag or two fingers to pan · scroll to zoom · double-click a piece to focus'}</div>
      </div>
      ${(selRug||selPiece)&&html`<div className="sx-selbar sx-selbar-pl" role="toolbar" aria-label="Edit selection" onPointerDown=${e=>e.stopPropagation()}>
        <button className=${pop==='info'?'on':''} aria-expanded=${pop==='info'} onClick=${()=>setPop(pop==='info'?null:'info')}>${selRug?'Rug':byId(selPiece).name}</button>
        <button disabled=${!!selPiece?.lock} aria-label="Rotate left 15°" title="Rotate (Shift+R)" onClick=${()=>patchSel(sel,{rot:(((selRug||selPiece).rot||0)+345)%360})}>↺</button>
        <button disabled=${!!selPiece?.lock} aria-label="Rotate right 15°" title="Rotate (R)" onClick=${()=>patchSel(sel,{rot:(((selRug||selPiece).rot||0)+15)%360})}>↻</button>
        <button aria-label="Duplicate" title="Duplicate (D)" onClick=${()=>dupItem(sel)}>${I('copy',{width:16})}</button>
        ${selPiece&&html`<button aria-label=${selPiece.lock?'Unlock':'Lock'} onClick=${()=>patchItem(selPiece.uid,{lock:!selPiece.lock})}>${I(selPiece.lock?'unlock':'lock',{width:16})}</button>`}
        <button aria-label="Delete" onClick=${()=>removeItem(sel)}>${I('trash',{width:16})}</button>
        ${pop==='info'&&html`<div className="sx-selpop sx-pl">${selRug?html`<div className="pl-sec" style=${{padding:0}}>
        <span className="eyebrow">Rug · layout guide</span><h3 style=${{fontSize:26}}>${R0.size}</h3>
        <div className="kv"><span className="mono mute">Size</span><span>${R0.round?`${R0.w.toFixed(2)} m across`:`${R0.w.toFixed(2)} × ${R0.d.toFixed(2)} m`}</span><span className="mono mute">Price</span><span>Not priced</span>
          <span className="mono mute">To left wall</span><span>${(R0.x-rugExt(R0)[0]+doc.W/2).toFixed(2)} m</span><span className="mono mute">To right wall</span><span>${(doc.W/2-R0.x-rugExt(R0)[0]).toFixed(2)} m</span><span className="mono mute">To back wall</span><span>${(R0.z-rugExt(R0)[1]+doc.D/2).toFixed(2)} m</span></div>
        <span className="lbl">Size</span>
        <div className="pl-floors">${RUG_SIZES.map(z=>html`<button key=${z[0]} className=${R0.size===z[0]?'on':''} onClick=${()=>patchRug(R0.uid,{size:z[0],w:z[1],d:z[2],round:!!z[3]})}>${z[0]}</button>`)}</div>
        <span className="lbl">Material</span>
        <div className="seg">${RUG_MATS.map(([k,l])=>html`<button key=${k} className=${R0.mat===k?'on':''} onClick=${()=>patchRug(R0.uid,{mat:k})}>${l}</button>`)}</div>
        <span className="lbl">Colour</span>
        <div className="swatches">${RUG_COLORS.map(([c,l])=>html`<button key=${l} title=${l} aria-label=${'Rug colour '+l} className=${R0.color===c?'on':''} style=${{background:c||'#CDBB98'}} onClick=${()=>patchRug(R0.uid,{color:c})}></button>`)}</div>
        <div className="pl-dims">${[['x','X (m)',doc.W],['z','Z (m)',doc.D],['rot','Rotation (degrees)',720]].map(([k,label,span])=>html`<${EditorNumberField} key=${R0.uid+k} label=${label} value=${R0[k]||0} min=${-span/2} max=${span/2} step=${k==='rot'?15:.05} onCommit=${value=>patchRug(R0.uid,{[k]:k==='rot'?(value%360+360)%360:value})}/>`)}</div>
        
</div>`:html`<div className="pl-sec" style=${{padding:0}}>
        <div className="pl-insp-h"><img src=${cut(S0)} alt=""/><div><span className="mono mute">${SD.p.sku} · ${MAT[SD.p.mat]}</span><h3>${SD.p.name}</h3><p className="mute" style=${{fontSize:13}}>${SD.p.line}</p></div></div>
        <div className="kv"><span className="mono mute">Footprint</span><span>${SD.w.toFixed(2)} × ${SD.d.toFixed(2)} m (approx.)</span><span className="mono mute">Price</span><span>${ctx.mode==='trade'?fmt(tp(SD.p),true):fmt(SD.p.price,true)}</span>
          <span className="mono mute">To left wall</span><span>${(S0.x-SD.w/2+doc.W/2).toFixed(2)} m</span><span className="mono mute">To right wall</span><span>${(doc.W/2-S0.x-SD.w/2).toFixed(2)} m</span><span className="mono mute">To back wall</span><span>${(S0.z-SD.d/2+doc.D/2).toFixed(2)} m</span></div>
        <div className="pl-dims">${[['x','X (m)',doc.W],['z','Z (m)',doc.D],['rot','Rotation (degrees)',720]].map(([k,label,span])=>html`<${EditorNumberField} key=${S0.uid+k} label=${label} value=${S0[k]||0} min=${-span/2} max=${span/2} step=${k==='rot'?15:.05} disabled=${!!S0.lock} onCommit=${value=>patchItem(S0.uid,{[k]:k==='rot'?(value%360+360)%360:value})}/>`)}</div>${S0.lock&&html`<p className="sx-note">Unlock this piece before moving or rotating it.</p>`}
        
        <button className="btn btn-ink btn-sm" onClick=${()=>ctx.openPin(S0.pid,currentIdentity(S0))}>View product</button>
</div>`}</div>`}
      </div>`}
      <${SxPill} ctx=${ctx} count=${doc.items.length} total=${pieces.reduce((s,p)=>s+pr(p,ctx.mode),0)} onOpen=${()=>setTraySheet(true)}/>
    </section>
    ${traySheet&&html`<${SxTray} ctx=${{...ctx,savedProducts:products}} rows=${plRows} onClose=${()=>setTraySheet(false)}/>`}
    ${shareImg&&html`<${ShareSheet} ctx=${ctx} title=${shareImg.title} image=${shareImg.url} ids=${shareImg.doc.items.map(i=>i.pid)} selections=${shareImg.doc.items.map(currentIdentity)} boardKey=${roomKey} room=${shareImg.doc} units=${shareImg.units} onClose=${()=>setShareImg(null)}/>`}
    ${planOpen&&html`<${FloorPlanEditor} ctx=${ctx} doc=${doc} units=${units} onClose=${()=>setPlanOpen(false)} onApply=${applyPlan}/>`}
    ${tplAsk&&html`<${SxDialog} title="Replace this room?" onClose=${()=>setTplAsk(null)}>
      <p className="sx-note">Starting from <b>${PL_TEMPLATES[tplAsk].label}</b> replaces the room and its ${doc.items.length} piece${doc.items.length===1?'':'s'} with:</p>
      <div className="sx-tplpre"><b>${PL_TEMPLATES[tplAsk].W} × ${PL_TEMPLATES[tplAsk].D} m</b><span>${PL_TEMPLATES[tplAsk].H} m ceiling · ${PL_FLOORS.find(f=>f[0]===PL_TEMPLATES[tplAsk].floor)?.[1]||'Oak'} floor</span>
        <span className="sx-tplpcs">${PL_TEMPLATES[tplAsk].items.length?PL_TEMPLATES[tplAsk].items.map((it,i)=>html`<img key=${i} src=${cut(it)} alt=${byId(it).name} title=${byId(it).name}/>`):html`<span className="sx-note">No pieces</span>`}</span></div>
      <div className="row" style=${{gap:8,justifyContent:'flex-end'}}><button className="btn btn-line btn-sm" onClick=${()=>setTplAsk(null)}>Keep my room</button>
        <button className="btn btn-cog btn-sm" onClick=${()=>{const k=tplAsk;const t=JSON.parse(JSON.stringify(PL_TEMPLATES[k]));commit(plReflow({...t,tpl:k,items:t.items.map(it=>({...it,uid:uid()})),rugs:[],wallImg:null}));setSel(null);setTplAsk(null);ctx.toast('Room replaced',{label:'Undo',fn:undo})}}>Replace canvas</button></div>
    <//>`}
    ${shot&&html`<${Modal} open label="Snapshot" onClose=${()=>setShot(null)}><div className="scrim" onClick=${e=>e.target===e.currentTarget&&setShot(null)}><div className="sheet share" style=${{width:'min(1000px,100%)'}}><div className="row" style=${{justifyContent:'space-between'}}><h2 style=${{fontSize:32}}>Snapshot</h2><button className="ib" aria-label="Close" onClick=${()=>setShot(null)}>${I('x')}</button></div><img src=${shot.url} alt="Snapshot of the room" style=${{borderRadius:12}}/><div className="row" style=${{gap:8,flexWrap:'wrap'}}><a className="btn btn-cog btn-sm" href=${shot.url} download=${(title||'room').replace(/[^a-z0-9]+/gi,'-').toLowerCase()+'.jpg'}>${I('download',{width:15})} Download image</a><button className="btn btn-line btn-sm" onClick=${()=>{setShareImg(shot);setShot(null)}}>${I('share',{width:15})} Share</button></div></div></div><//>`}
    ${showPrompt&&html`<${Modal} open label="Render brief" onClose=${()=>setShowPrompt(false)}><div className="scrim" onClick=${e=>e.target===e.currentTarget&&setShowPrompt(false)}><div className="sheet share" style=${{width:'min(720px,100%)'}}>
      <div className="row" style=${{justifyContent:'space-between'}}><h2 style=${{fontSize:32}}>Render <em style=${{color:'var(--cognac)'}}>brief</em></h2><button className="ib" aria-label="Close" onClick=${()=>setShowPrompt(false)}>${I('x')}</button></div>
      <p className="help" style=${{margin:0}}>Written from your exact layout, materials and light. AI render turns this view into a photoreal picture from the brief, keeping your exact layout and pieces.</p>
      <pre style=${{whiteSpace:'pre-wrap',background:'var(--plaster)',padding:16,borderRadius:12,fontFamily:'var(--mono)',fontSize:12.5,lineHeight:1.6,margin:0,maxHeight:320,overflow:'auto'}}>${prompt}</pre>
      <div className="row" style=${{flexWrap:'wrap'}}><button className="btn btn-ink btn-sm" onClick=${()=>copyText(prompt,ctx.toast)}>${I('copy',{width:14})} Copy brief</button><button className="btn btn-line btn-sm" disabled=${!eng} onClick=${()=>{setShowPrompt(false);setShot({url:E.current.snapshot(),doc:structuredClone(docRef.current),title,units})}}>${I('cam',{width:14})} Take snapshot</button><button className="btn btn-cog btn-sm" disabled=${aiBusy||!eng} onClick=${startAi}>${I('wand',{width:14})} ${aiBusy?'Sending…':'Make an AI render'}</button></div>
    </div></div><//>`}
    ${aiJob&&html`<${AiRender} ctx=${ctx} id=${aiJob.id} onClose=${()=>setAiJob(null)} onShare=${u=>{setShareImg({...aiJob,url:u});setAiJob(null)}} onRetry=${()=>{setAiJob(null);startAi()}}/>`}
  </main>`;
}


/** Shows an AI render while it's made and when it's ready: download, share or try again. */
/** Display render progress or results without starting generation merely by opening the dialog. */
function AiRender({ctx,id,onClose,onShare,onRetry}){
  const r=useQuery(api.holmRender.one,{id});const [busy,setBusy]=useState(false);
  const blobOf=async()=>await (await fetch(r.url)).blob();
  return html`<${Modal} open label="AI render" onClose=${onClose}><div className="scrim" onClick=${e=>e.target===e.currentTarget&&onClose()}><div className="sheet share" style=${{width:'min(1000px,100%)'}}>
    <div className="row" style=${{justifyContent:'space-between'}}><h2 style=${{fontSize:32}}>AI <em style=${{color:'var(--cognac)'}}>render</em></h2><button className="ib" aria-label="Close" onClick=${onClose}>${I('x')}</button></div>
    ${!r||r.status==='rendering'?html`<div className="ai-wait" role="status"><span className="ai-spin" aria-hidden="true"></span><p>Making your render. It takes about a minute.</p><p className="help">You can close this and keep planning. We'll email it to you when it's ready.</p></div>`
    :r.status==='ready'&&r.url?html`<img src=${r.url} alt=${'AI render of '+r.title} style=${{borderRadius:12,width:'100%'}}/>
      <p className="help" style=${{margin:0}}>Made by AI from your layout. Details can differ slightly from the real pieces.</p>
      <div className="row" style=${{gap:8,flexWrap:'wrap'}}>
        <button className="btn btn-cog btn-sm" disabled=${busy} onClick=${async()=>{setBusy(true);try{saveBlob(await blobOf(),fileName(r.title+'-render','png'))}catch(e){ctx.toast(errText(e))}finally{setBusy(false)}}}>${I('download',{width:15})} Download</button>
        <button className="btn btn-line btn-sm" disabled=${busy} onClick=${async()=>{setBusy(true);try{onShare(URL.createObjectURL(await blobOf()))}catch(e){ctx.toast(errText(e))}finally{setBusy(false)}}}>${I('share',{width:15})} Share</button>
        <button className="btn btn-line btn-sm" onClick=${onRetry}>${I('wand',{width:15})} Make another</button></div>`
    :html`<p role="alert">${r.error||'The render could not be made.'}</p><div className="row"><button className="btn btn-cog btn-sm" onClick=${onRetry}>Try again</button></div>`}
  </div></div><//>`;
}


/* ================= FLOOR PLANS ================= */
// Trade partners trace their real plan: upload it, set its scale from one known wall, draw each
// room (L-shapes, alcoves, angled walls) and the columns or fixed blocks in it, or let an AI pass
// propose the walls first. Plans are drawn in image pixels and saved in metres.
const ZONE_NAMES=['Dining room','Bar','Lobby','Lounge','Terrace','Private room'];

const BLOCKS=[['Column',.4,.4,2.8],['Bar counter',3,.7,1.05],['Host stand',.9,.6,1.1],['Built-in banquette',2.4,.7,.9]];

// A PDF plan's first page becomes the underlay (pdf.js, loaded on demand).
async function pdfFirstPage(file){const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).href;
  const doc=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise;const page=await doc.getPage(1);const v0=page.getViewport({scale:1});const vp=page.getViewport({scale:Math.min(4,2200/Math.max(v0.width,v0.height))});
  const c=document.createElement('canvas');c.width=vp.width;c.height=vp.height;await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;return c}

// Underlays are kept at 2000 px on the long side as JPEG, small enough to save with the room.
async function planImage(file){let c;if(/pdf$/i.test(file.type)||/\.pdf$/i.test(file.name))c=await pdfFirstPage(file);else{const u=URL.createObjectURL(file);const im=await loadImg(u);if(!im)throw new Error('This image could not be opened.');c=document.createElement('canvas');const s=Math.min(1,2000/Math.max(im.width,im.height));c.width=Math.round(im.width*s);c.height=Math.round(im.height*s);const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(u)}
  return {img:c.toDataURL('image/jpeg',.82),w:c.width,h:c.height}}

const snap90=(a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1];const ang=Math.atan2(dy,dx);const q=Math.round(ang/(Math.PI/4))*(Math.PI/4);if(Math.abs(ang-q)<.12){const L=Math.hypot(dx,dy);return [a[0]+Math.cos(q)*L,a[1]+Math.sin(q)*L]}return b};

/** Edit a local plan draft; Escape cancels an unfinished polygon before dismissing the modal. */
function FloorPlanEditor({ctx,doc,units,onClose,onApply}){
  // Work in image pixels; a plan with no underlay draws on a 20 m × 14 m sheet at 50 px a metre.
  const init=()=>{const u=doc.underlay;if(doc.zones?.length&&u){const k=1/u.mPerPx;const px=([x,z])=>[(x-u.ox)*k,(z-u.oz)*k];return {img:u.img,w:u.w,h:u.h,mPerPx:u.mPerPx,opacity:u.opacity??.5,zones:doc.zones.map(z=>({...z,poly:z.poly.map(px)})),blocks:(doc.blocks||[]).map(b=>({...b,x:(b.x-u.ox)*k,z:(b.z-u.oz)*k}))}}
    if(doc.zones?.length){const k=50,ox=-10,oz=-7;return {img:null,w:1000,h:700,mPerPx:1/k,opacity:.5,zones:doc.zones.map(z=>({...z,poly:z.poly.map(([x,y])=>[(x-ox)*k,(y-oz)*k])})),blocks:(doc.blocks||[]).map(b=>({...b,x:(b.x-ox)*k,z:(b.z-oz)*k}))}}
    return {img:null,w:1000,h:700,mPerPx:.02,opacity:.5,zones:[],blocks:[]}};
  const [entry,setEntry]=useState([50,50]);
  const [P,setP]=useState(init);const [mode,setMode]=useState(P.zones.length?'select':'upload');const [draft,setDraft]=useState([]);const [cal,setCal]=useState([]);const [calLen,setCalLen]=useState('');
  const [sel,setSel]=useState(P.zones[0]?.id||null);const [busy,setBusy]=useState('');const [err,setErr]=useState('');const [hover,setHover]=useState(null);const svgRef=useRef();const fileRef=useRef();
  const readWalls=useAction(api.holmPlans.readWalls);
  const ft=units==='ft';const toU=m=>ft?m*3.28084:m;const fromU=v=>ft?v/3.28084:v;const uLab=ft?'ft':'m';
  const at=e=>{const s=svgRef.current;const pt=s.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;const p=pt.matrixTransform(s.getScreenCTM().inverse());return [p.x,p.y]};
  const lenPx=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
  const upload=async f=>{if(!f)return;setBusy('upload');setErr('');try{const im=await planImage(f);setP(p=>({...p,...im}));setMode('scale');setCal([])}catch(e){setErr(errText(e))}finally{setBusy('')}};
  const placePoint=p=>{if(!p.every(Number.isFinite)||p[0]<0||p[0]>P.w||p[1]<0||p[1]>P.h){setErr('Place the point within the drawing sheet.');return}setErr('');
    if(mode==='scale'){setCal(c=>c.length>=2?[p]:[...c,p]);return}
    if(mode==='draw'){if(draft.length>=64){setErr('A room can have up to 64 corners. Finish it or undo a point.');return}if(draft.length>2&&lenPx(p,draft[0])<14){closeDraft();return}setDraft(d=>[...d,d.length?snap90(d[d.length-1],p):p]);return}
    if(mode==='block'){const [n,w,d,h]=BLOCKS[0];addBlock(p,n,w,d,h);return}};
  const onClick=e=>placePoint(at(e));
  const closeDraft=()=>{if(!validRoomPolygon(draft)){setErr('Use at least three distinct corners enclosing an area, without crossing walls. Your points are kept for editing.');return}setErr('');setHover(null);const id=uid();const name=ZONE_NAMES[P.zones.length%ZONE_NAMES.length];setP(p=>({...p,zones:[...p.zones,{id,name,poly:draft,floor:doc.floor,wall:doc.wall}]}));setDraft([]);setSel(id);setMode('select')};
  const addBlock=(p,name,w,d,h)=>setP(s=>({...s,blocks:[...s.blocks,{id:uid(),name,x:p[0],z:p[1],w,d,h,rot:0}]}));
  const planKeys=e=>{if(e.key==='Escape'&&draft.length){e.preventDefault();setDraft([]);return}if(['INPUT','TEXTAREA','SELECT','BUTTON','A'].includes(e.target.tagName))return;if(e.key==='Enter'&&mode==='draw'){e.preventDefault();closeDraft()}if((e.key==='Backspace'||e.key==='Delete')&&mode==='draw'&&draft.length){e.preventDefault();setDraft(d=>d.slice(0,-1))}};
  // Drag a corner to move it.
  const dragPt=(e,zid,i)=>{e.stopPropagation();const mv=ev=>{const p=at(ev);setP(s=>({...s,zones:s.zones.map(z=>z.id!==zid?z:{...z,poly:z.poly.map((q,k)=>k===i?p:q)})}))};const up=()=>removeEventListener('pointermove',mv);addEventListener('pointermove',mv);addEventListener('pointerup',up,{once:true})};
  const dragBlock=(e,id)=>{e.stopPropagation();const mv=ev=>{const p=at(ev);setP(s=>({...s,blocks:s.blocks.map(b=>b.id!==id?b:{...b,x:p[0],z:p[1]})}))};const up=()=>removeEventListener('pointermove',mv);addEventListener('pointermove',mv);addEventListener('pointerup',up,{once:true})};
  const setScale=()=>{const v=fromU(parseFloat(calLen));const scale=cal.length<2?null:calibrationScale(v,lenPx(cal[0],cal[1]));if(scale===null){setErr('Choose two distinct points and enter a finite positive length.');return}setErr('');setP(p=>({...p,mPerPx:scale}));setMode(P.zones.length?'select':'draw')};
  const ai=async()=>{if(!P.img)return;if(!ctx.me.signedIn){ctx.toast('Sign in to read walls from a plan');return}setBusy('ai');setErr('');
    try{const r=await readWalls({image:P.img.split(',')[1],mime:'image/jpeg'});const px=([x,y])=>[x*P.w,y*P.h];
      setP(p=>({...p,zones:r.rooms.map(rm=>({id:uid(),name:rm.name,poly:rm.points.map(px),floor:doc.floor,wall:doc.wall})),blocks:r.blocks.map(b=>{const q=b.points.map(px);const xs=q.map(v=>v[0]),ys=q.map(v=>v[1]);return {id:uid(),name:b.name,x:(Math.min(...xs)+Math.max(...xs))/2,z:(Math.min(...ys)+Math.max(...ys))/2,w:(Math.max(...xs)-Math.min(...xs))*p.mPerPx,d:(Math.max(...ys)-Math.min(...ys))*p.mPerPx,h:1.05,rot:0}})}));
      if(r.scale){setCal([px(r.scale.a),px(r.scale.b)]);setCalLen(String(+toU(r.scale.meters).toFixed(2)))}
      setMode(r.scale?'scale':'select');ctx.toast(r.scale?'Walls read. Check the scale against a wall you know, then fix any wall.':'Walls read. Set the scale from a wall you know, then fix any wall.')}
    catch(e){setErr(errText(e))}finally{setBusy('')}};
  // Save in metres, centred on the plan, with the underlay placed to match.
  const apply=()=>{if(draft.length){setErr('Finish or discard the unfinished room before applying this plan.');return}if(!P.zones.length){setErr('Draw at least one room first.');return}const k=P.mPerPx;if(!Number.isFinite(k)||k<=0||!P.zones.every(z=>validRoomPolygon(z.poly))||P.blocks.some(b=>![b.x,b.z,b.w,b.d,b.h].every(Number.isFinite)||b.w<=0||b.d<=0||b.h<=0)){setErr('Check the scale, room corners and block dimensions. Rooms need an area and cannot have crossing walls.');return}const all=P.zones.flatMap(z=>z.poly);const xs=all.map(p=>p[0]*k),zs=all.map(p=>p[1]*k);const cx=(Math.min(...xs)+Math.max(...xs))/2,cz=(Math.min(...zs)+Math.max(...zs))/2;
    const m=([x,y])=>[r2(x*k-cx),r2(y*k-cz)];const zones=P.zones.map(z=>({...z,poly:z.poly.map(m)}));if(!zones.every(z=>validRoomPolygon(z.poly))){setErr('This scale collapses room corners. Adjust the scale or corners before applying.');return}const b=polyBounds(zones.map(z=>z.poly));
    onApply({zones,blocks:P.blocks.map(bl=>({...bl,x:r2(bl.x*k-cx),z:r2(bl.z*k-cz)})),W:r2(b.maxX-b.minX),D:r2(b.maxZ-b.minZ),underlay:P.img?{img:P.img,w:P.w,h:P.h,mPerPx:k,ox:r2(-cx),oz:r2(-cz),opacity:P.opacity}:null})};
  const Z=P.zones.find(z=>z.id===sel);const k=P.mPerPx;const fmtM=m=>`${toU(m).toFixed(2)} ${uLab}`;
  const gridStep=Number.isFinite(k)&&k>0?Math.max(1/k,P.w/200,P.h/200):Math.max(P.w,P.h);
  const hint={upload:'Upload the plan as an image or PDF, or draw on the blank sheet.',scale:'Place both ends of a known wall with the pointer or coordinate fields, then enter its real length.',draw:'Place corners with the pointer or coordinate fields. Finish room closes it; Undo last point removes a corner.',block:'Click to place a column; change its size in the list.',select:'Drag corners or edit their coordinates. Type a wall length to set it exactly.'}[mode];
  return html`<${Modal} open label="Floor plan" onClose=${onClose}><div className="scrim sx-scrim" onKeyDown=${planKeys}>
    <div className="sx-dialog fplan">
      <div className="sx-drawer-h"><b>Floor plan</b><button className="ib" aria-label="Close" onClick=${onClose}>${I('x')}</button></div>
      <div className="fp-tools">
        <div className="seg" role="group" aria-label="Step">${[['upload','Plan'],['scale','Scale'],['draw','Draw a room'],['block','Columns'],['select','Adjust']].map(([kk,l])=>html`<button key=${kk} className=${mode===kk?'on':''} onClick=${()=>{setMode(kk);setDraft([])}}>${l}</button>`)}</div>
        ${mode==='upload'&&html`<${React.Fragment}><button className="btn btn-line btn-sm" disabled=${!!busy} onClick=${()=>fileRef.current.click()}>${I('upload',{width:15})} ${busy==='upload'?'Opening…':'Upload a plan'}</button><input ref=${fileRef} type="file" accept="image/*,application/pdf" hidden onChange=${e=>{upload(e.target.files[0]);e.target.value=''}}/><//>`}
        ${P.img&&html`<button className="btn btn-line btn-sm" disabled=${!!busy} onClick=${ai}>${I('wand',{width:15})} ${busy==='ai'?'Reading walls…':'Read walls from the image'}</button>`}
        ${P.img&&html`<label className="fp-op"><span className="sx-lbl">Plan</span><input type="range" min="0" max="1" step=".05" value=${P.opacity} onInput=${e=>setP(p=>({...p,opacity:+e.target.value}))} aria-label="Plan opacity"/></label>`}
        ${mode==='scale'&&html`<span className="row" style=${{gap:6}}><input className="field num" style=${{height:34,width:90}} type="number" min="0" step="0.01" placeholder=${'Length ('+uLab+')'} value=${calLen} onInput=${e=>setCalLen(e.target.value)} aria-label="Real length of the wall"/><button className="btn btn-cog btn-sm" disabled=${cal.length<2||!(parseFloat(calLen)>0)} onClick=${setScale}>Set scale</button></span>`}
        ${mode==='block'&&html`<span className="row" style=${{gap:6,flexWrap:'wrap'}}>${BLOCKS.map(([n,w,d,h])=>html`<button key=${n} className="chip" onClick=${()=>addBlock([P.w/2,P.h/2],n,w,d,h)}>${n}</button>`)}</span>`}
      </div>
      <p className="sx-note">${hint} <span className="mono">1 px = ${(k*100).toFixed(1)} cm</span></p>
      ${['scale','draw','block'].includes(mode)&&html`<div className="fp-point-entry" role="group" aria-label="Point placement">
        ${[[0,'Across (%)'],[1,'Down (%)']].map(([axis,label])=>html`<${EditorNumberField} key=${axis} label=${label} value=${entry[axis]} min=${0} max=${100} step=${1} onCommit=${value=>setEntry(p=>p.map((v,i)=>i===axis?value:v))}/>`)}
        <button className="btn btn-line btn-sm" onClick=${()=>placePoint([entry[0]*P.w/100,entry[1]*P.h/100])}>${mode==='scale'?'Add calibration point':mode==='block'?'Place column':'Add corner'}</button>
        ${mode==='draw'&&html`<button className="btn btn-cog btn-sm" disabled=${draft.length<3} onClick=${closeDraft}>Finish room</button><button className="btn btn-line btn-sm" disabled=${!draft.length} onClick=${()=>{setDraft(p=>p.slice(0,-1));setErr('')}}>Undo last point</button><span role="status">${draft.length} corners placed</span>`}
        ${mode==='scale'&&html`<button className="btn btn-line btn-sm" disabled=${!cal.length} onClick=${()=>setCal([])}>Clear calibration points</button><span role="status">${cal.length} of 2 calibration points</span>`}
      </div>`}

      <div className="fp-body">
        <div className="fp-sheet"><svg ref=${svgRef} viewBox=${`0 0 ${P.w} ${P.h}`} tabIndex="0" aria-label="Floor plan drawing area" onClick=${e=>{e.currentTarget.focus();onClick(e)}} onPointerMove=${e=>mode==='draw'&&draft.length&&setHover(snap90(draft[draft.length-1],at(e)))} style=${{cursor:mode==='select'?'default':'crosshair'}}>
          <rect width=${P.w} height=${P.h} fill="#FBF8F2"/>
          ${P.img?html`<image href=${P.img} width=${P.w} height=${P.h} opacity=${P.opacity}/>`:html`<path d=${Array.from({length:Math.ceil(P.w/gridStep)},(_,i)=>`M${i*gridStep} 0V${P.h}`).join('')+Array.from({length:Math.ceil(P.h/gridStep)},(_,i)=>`M0 ${i*gridStep}H${P.w}`).join('')} stroke="rgba(43,33,26,.08)"/>`}
          ${P.zones.map(z=>html`<g key=${z.id} className=${'fp-zone'+(z.id===sel?' on':'')} onClick=${e=>{if(mode==='select'){e.stopPropagation();setSel(z.id)}}}>
            <polygon points=${z.poly.map(p=>p.join(',')).join(' ')}/>
            ${z.poly.map((a,i)=>{const b=z.poly[(i+1)%z.poly.length];return html`<text key=${i} x=${(a[0]+b[0])/2} y=${(a[1]+b[1])/2} className="fp-len">${fmtM(lenPx(a,b)*k)}</text>`})}
            <text x=${polyCentre(z.poly)[0]} y=${polyCentre(z.poly)[1]} className="fp-name">${z.name}</text>
            ${mode==='select'&&z.poly.map((p,i)=>html`<circle key=${'c'+i} cx=${p[0]} cy=${p[1]} r=${Math.max(5,P.w/180)} className="fp-pt" onPointerDown=${e=>dragPt(e,z.id,i)}/>`)}
          </g>`)}
          ${P.blocks.map(b=>html`<rect key=${b.id} className="fp-block" x=${b.x-b.w/k/2} y=${b.z-b.d/k/2} width=${b.w/k} height=${b.d/k} onPointerDown=${e=>mode==='select'&&dragBlock(e,b.id)}/>`)}
          ${draft.length>0&&html`<polyline className="fp-draft" points=${[...draft,...(hover?[hover]:[])].map(p=>p.join(',')).join(' ')}/>`}
          ${draft.map((p,i)=>html`<circle key=${'d'+i} cx=${p[0]} cy=${p[1]} r=${Math.max(4,P.w/220)} className=${'fp-pt'+(i===0?' first':'')}/>`)}
          ${cal.length>0&&html`<g className="fp-cal">${cal.length===2&&html`<line x1=${cal[0][0]} y1=${cal[0][1]} x2=${cal[1][0]} y2=${cal[1][1]}/>`}${cal.map((p,i)=>html`<circle key=${i} cx=${p[0]} cy=${p[1]} r=${Math.max(5,P.w/180)}/>`)}</g>`}
        </svg></div>
        <aside className="fp-side">
          <span className="sx-lbl">Rooms</span>
          ${P.zones.length?P.zones.map(z=>html`<button key=${z.id} className=${'fp-row'+(z.id===sel?' on':'')} onClick=${()=>{setSel(z.id);setMode('select')}}><b>${z.name}</b><span className="mono">${(Math.abs(polyArea(z.poly))*k*k*(ft?10.7639:1)).toFixed(1)} ${ft?'sq ft':'m²'}</span></button>`):html`<p className="sx-note">No rooms yet. Choose Draw a room${P.img?' or read the walls from the image':''}.</p>`}
          ${Z&&html`<div className="sx-col" style=${{gap:8}}>
            <label className="sx-col" style=${{gap:4}}><span className="sx-lbl">Name</span><input className="field" style=${{height:36}} value=${Z.name} maxLength="40" onInput=${e=>setP(p=>({...p,zones:p.zones.map(z=>z.id===Z.id?{...z,name:e.target.value}:z)}))}/></label>
            <span className="sx-lbl">Walls (${uLab})</span>
            <div className="fp-walls">${Z.poly.map((a,i)=>{const b=Z.poly[(i+1)%Z.poly.length];return html`<label key=${i}><span className="mono mute">${i+1}</span><input className="field num" type="number" step="0.01" min="0.1" value=${+toU(lenPx(a,b)*k).toFixed(2)} onChange=${e=>{const v=fromU(+e.target.value);if(v>0)setP(p=>({...p,zones:p.zones.map(z=>z.id===Z.id?{...z,poly:setWallLength(z.poly,i,v/k)}:z)}))}}/></label>`})}</div>
            <span className="sx-lbl">Corner coordinates</span><div className="sx-number-grid">${Z.poly.flatMap((point,i)=>[[0,'Across',P.w],[1,'Down',P.h]].map(([axis,label,span])=>html`<${EditorNumberField} key=${Z.id+i+label} label=${'Corner '+(i+1)+' '+label.toLowerCase()+' (%)'} value=${Math.round(point[axis]/span*100000)/1000} min=${0} max=${100} step=${1} onCommit=${value=>{setErr('');setP(p=>({...p,zones:p.zones.map(z=>z.id!==Z.id?z:{...z,poly:z.poly.map((v,index)=>index!==i?v:v.map((n,a)=>a===axis?value*span/100:n))})}))}}/>`))}</div>
            <button className="lnk" style=${{color:'var(--bad)',justifySelf:'start'}} onClick=${()=>{setP(p=>({...p,zones:p.zones.filter(z=>z.id!==Z.id)}));setSel(null)}}>Delete this room</button></div>`}
          ${P.blocks.length>0&&html`<${React.Fragment}><span className="sx-lbl">Columns and fixed blocks</span>${P.blocks.map(b=>html`<div key=${b.id} className="fp-brow"><input className="field" style=${{height:32}} value=${b.name} onInput=${e=>setP(p=>({...p,blocks:p.blocks.map(x=>x.id===b.id?{...x,name:e.target.value}:x)}))} aria-label="Name"/>
            <div className="fp-block-coordinates">${[['x','Across (%)',P.w],['z','Down (%)',P.h]].map(([key,label,span])=>html`<${EditorNumberField} key=${key} label=${label} value=${Math.round(b[key]/span*100000)/1000} min=${0} max=${100} step=${1} onCommit=${value=>setP(p=>({...p,blocks:p.blocks.map(x=>x.id===b.id?{...x,[key]:value*span/100}:x)}))}/>`)}</div>
            ${['w','d','h'].map(kk=>html`<input key=${kk} className="field num" style=${{height:32}} type="number" step="0.05" min="0.05" title=${{w:'Width',d:'Depth',h:'Height'}[kk]+' ('+uLab+')'} aria-label=${{w:'Width',d:'Depth',h:'Height'}[kk]} value=${+toU(b[kk]).toFixed(2)} onChange=${e=>{const v=fromU(+e.target.value);if(v>0)setP(p=>({...p,blocks:p.blocks.map(x=>x.id===b.id?{...x,[kk]:v}:x)}))}}/>`)}
            <button className="ib" aria-label="Remove" onClick=${()=>setP(p=>({...p,blocks:p.blocks.filter(x=>x.id!==b.id)}))}>${I('x',{width:14})}</button></div>`)}<//>`}
        </aside>
      </div>
      ${err&&html`<p role="alert" className="sx-note" style=${{color:'var(--bad)'}}>${err}</p>`}
      <div className="row" style=${{justifyContent:'space-between',gap:8,flexWrap:'wrap'}}>
        ${doc.zones?.length?html`<button className="lnk" onClick=${()=>onApply(null)}>Go back to a rectangular room</button>`:html`<span></span>`}
        <span className="row" style=${{gap:8}}><button className="btn btn-line btn-sm" onClick=${onClose}>Cancel</button><button className="btn btn-cog btn-sm" disabled=${!P.zones.length} onClick=${apply}>Use this plan</button></span></div>
    </div></div><//>`;
}

// A dimensioned plan PDF: every room with its wall lengths, each piece, rug and block labelled, a
// seat count per room, then a piece list per room and the bundle link.
async function planPdf(doc,{title,units,link,products=BY_ID}){
  const byId=studioGeometry(products).product;const {extents:plExt}=plannerGeometry(products);
  const {PDFDocument,StandardFonts,rgb,PDFName,PDFString}=await import('pdf-lib');
  const pdf=await PDFDocument.create();pdf.setTitle(title+' plan');const serif=await pdf.embedFont(StandardFonts.TimesRomanItalic),sans=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink=rgb(.17,.13,.1),mute=rgb(.44,.39,.34),cog=rgb(.65,.37,.17),line=rgb(.8,.76,.7);
  const zones=roomZones(doc);const b=polyBounds(zones.map(z=>z.poly));const PW=792,PH=612,M=40;const sc=Math.min((PW-2*M)/(b.maxX-b.minX+1.2),(PH-2*M-50)/(b.maxZ-b.minZ+1.2));
  const X=x=>M+(x-b.minX+.6)*sc,Y=z=>PH-M-40-(z-b.minZ+.6)*sc;const u=units==='ft'?'ft':'m';const L=m=>fmtLen(m,units).replace('′',"'").replace('″','"').replace('½','.5');
  const page=pdf.addPage([PW,PH]);page.drawText(`${title} · floor plan`,{x:M,y:PH-M-10,size:18,font:serif,color:ink});
  const seatsIn=z=>doc.items.filter(it=>!it.hang&&inPoly([it.x,it.z],z.poly)).reduce((s,it)=>s+byId(it).seats,0);
  for(const z of zones){const p=z.poly;p.forEach((a,i)=>{const c=p[(i+1)%p.length];page.drawLine({start:{x:X(a[0]),y:Y(a[1])},end:{x:X(c[0]),y:Y(c[1])},thickness:2.2,color:ink});
      const len=Math.hypot(c[0]-a[0],c[1]-a[1]);if(len>.3){const t=L(len);const cw=polyArea(p)>0;const ux=(c[0]-a[0])/len,uz=(c[1]-a[1])/len;const nx=cw?uz:-uz,nz=cw?-ux:ux;page.drawText(t,{x:X((a[0]+c[0])/2+nx*.35)-sans.widthOfTextAtSize(t,7)/2,y:Y((a[1]+c[1])/2+nz*.35)-2,size:7,font:sans,color:mute})}});
    const c=polyCentre(p);const t=`${z.name} · ${seatsIn(z)} seats`;page.drawText(t,{x:X(c[0])-serif.widthOfTextAtSize(t,11)/2,y:Y(c[1]),size:11,font:serif,color:cog})}
  for(const bk of doc.blocks||[])page.drawRectangle({x:X(bk.x-bk.w/2),y:Y(bk.z+bk.d/2),width:bk.w*sc,height:bk.d*sc,color:rgb(.9,.87,.82),borderColor:mute,borderWidth:.6});
  for(const r of doc.rugs||[]){if(r.round)page.drawEllipse({x:X(r.x),y:Y(r.z),xScale:r.w/2*sc,yScale:r.w/2*sc,borderColor:line,borderWidth:.8,borderDashArray:[3,2]});else{const [ex,ez]=rugExt(r);page.drawRectangle({x:X(r.x-ex),y:Y(r.z+ez),width:2*ex*sc,height:2*ez*sc,borderColor:line,borderWidth:.8,borderDashArray:[3,2]})}}
  for(const it of doc.items){const p=byId(it);const [ex,ez]=plExt(it);page.drawRectangle({x:X(it.x-ex),y:Y(it.z+ez),width:2*ex*sc,height:2*ez*sc,color:rgb(.93,.88,.8),borderColor:ink,borderWidth:.5,opacity:it.hang?.4:1});
    page.drawText(p.name,{x:X(it.x)-sans.widthOfTextAtSize(p.name,6.5)/2,y:Y(it.z)-2,size:6.5,font:sans,color:ink})}
  page.drawText(`Measurements in ${u === 'ft' ? 'feet and inches' : 'metres'}. Walls ${fmtCm((doc.wallT||.12)*100,units)} thick, ceiling ${L(doc.H)}.`,{x:M,y:M-14,size:8,font:sans,color:mute});
  const addLink=(pg,x,y,w,h,url)=>{const ref=pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[x,y,x+w,y+h],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of(url)}}));const a=pg.node.lookup(PDFName.of('Annots'));if(a)a.push(ref);else pg.node.set(PDFName.of('Annots'),pdf.context.obj([ref]))};
  // Piece list per room
  let pg=pdf.addPage([612,792]),y=792-M-20;pg.drawText('Pieces by room',{x:M,y,size:20,font:serif,color:ink});y-=16;if(link){pg.drawText(link,{x:M,y,size:9,font:sans,color:cog});addLink(pg,M,y-3,532,13,link)}y-=26;
  const rows=[...zones.map(z=>({z,items:doc.items.filter(it=>inPoly([it.x,it.z],z.poly))})),{z:{name:'Elsewhere'},items:doc.items.filter(it=>!zones.some(z=>inPoly([it.x,it.z],z.poly)))}].filter(r=>r.items.length);
  for(const {z,items} of rows){if(y<M+80){pg=pdf.addPage([612,792]);y=792-M}const seats=items.filter(i=>!i.hang).reduce((s,i)=>s+byId(i).seats,0);const sub=items.reduce((s,i)=>s+byId(i).price,0);
    pg.drawText(`${z.name} · ${seats} seats · ${fmt(sub)} retail`,{x:M,y,size:12,font:bold,color:ink});y-=16;
    for(const r of editorSelections(items,products)){const p=byId(r);if(y<M){pg=pdf.addPage([612,792]);y=792-M}pg.drawText(`${r.qty} × ${p.name} — ${p.line}`.slice(0,90),{x:M+10,y,size:10,font:sans,color:ink});const t=fmt(p.price*r.qty);pg.drawText(t,{x:572-M-sans.widthOfTextAtSize(t,10),y,size:10,font:sans,color:ink});y-=14}y-=10}
  return new Blob([await pdf.save()],{type:'application/pdf'});
}

// Team review queue for trade applications (admin accounts only).
/* ================= 3D MODELS ================= */
// Path tracing needs a real GPU: phones and software WebGL (SwiftShader, llvmpipe) get the raster still instead.
function canTrace(r){if(window.__forceTrace)return true;if(matchMedia('(pointer:coarse)').matches)return false;try{const gl=r.getContext();const ext=gl.getExtension('WEBGL_debug_renderer_info');const name=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'';return !/swiftshader|llvmpipe|software|basic render/i.test(String(name))}catch(e){return true}}





// One partner's ledger, transfers and manual adjustments (opened on demand).

// Products or categories that never earn commission.

// The last 12 months of commission as a CSV file.

// Setting a tier by hand holds it (with a reason, until an optional end date); the nightly update leaves it alone until then.



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
      <div className="qopts">${Object.keys(MAT).map(m=>html`<button key=${m} className=${'qopt'+(mats.includes(m)?' on':'')} onClick=${()=>tog(mats,setMats,m,3)} aria-pressed=${mats.includes(m)}><div className="im" style=${{backgroundImage:`url(${PRODUCTS.find(p=>p.mat===m)?.img||'/trade/unavailable.svg'})`}}></div><div className="t"><b>${MAT[m]}</b></div></button>`)}</div>
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
export {Studio,Room,ShareSheet,Quiz};
