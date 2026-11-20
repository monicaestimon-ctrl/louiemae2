/* eslint-disable */
// @ts-nocheck
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
import { area as polyArea, inside as inPoly, centroid as polyCentre, bounds as polyBounds, setWallLength } from '../lib/holmPlan';

export const html = htm.bind(React.createElement);


/* ================= data ================= */
const MAT = {leather:'Leather',velvet:'Velvet',boucle:'Bouclé',rattan:'Rattan',brass:'Brass',wood:'Wood'};

const TYPE = {sofa:'Sofas',sectional:'Sectionals',ottoman:'Ottomans',bench:'Benches',lighting:'Lighting',chair:'Chairs',stool:'Stools',table:'Tables'};

// The catalog comes from the live House listings (see catalog.ts). Curated pieces keep
// their numeric ids so hero films, scenes and cutouts stay attached to the right product.
const byId = (id: number): HolmProduct => displayProduct(BY_ID, id);

const has = (id: number) => BY_ID.has(id);

const tp = (p: HolmProduct) => p.trade ?? p.price;

const pr = (p: HolmProduct, mode: string) => (mode === 'trade' ? tp(p) : p.price);

// A piece's seamless cutout when it has one (from its asset record, or the curated studio set), else its photo.
const cut = (id: number) => byId(id).cutout || byId(id).img;

const pinItUrl=(media,desc,link='https://www.louiemae.com/retail-furniture')=>`https://www.pinterest.com/pin/create/button/?url=${encodeURIComponent(link)}&media=${encodeURIComponent(media)}&description=${encodeURIComponent(desc)}`;

// three.js loads on demand, the first time a 3D view mounts, so other pages never pay for it.
let threeP=null;

const loadThree=()=>window.THREE?Promise.resolve(window.THREE):(threeP||=import('three').then(m=>(window.THREE=m),e=>{threeP=null;throw e}));

// Light values below were tuned in three's legacy units; r155+ lights are physical, so they scale by pi.
const LX=Math.PI;

function useThree(){const [T,setT]=useState(()=>window.THREE||null);const [failed,setFailed]=useState(false);
  useEffect(()=>{if(T)return;let live=true;loadThree().then(m=>live&&setT(m),()=>live&&setFailed(true));return()=>{live=false}},[]);return [T,failed]}


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

const load=(k,d)=>{try{const v=localStorage.getItem('hol:'+k);return v?JSON.parse(v):d}catch(e){return d}};

const store=(k,v)=>{try{localStorage.setItem('hol:'+k,JSON.stringify(v))}catch(e){}};

const hex2rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));

const cdist=(a,b)=>{const[x,y,z]=hex2rgb(a),[p,q,r]=hex2rgb(b);return Math.hypot(x-p,y-q,z-r)};

const uid=()=>Math.random().toString(36).slice(2,9);

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

function useOutside(ref,fn){useEffect(()=>{const h=e=>{if(ref.current&&!ref.current.contains(e.target))fn()};document.addEventListener('pointerdown',h);return()=>document.removeEventListener('pointerdown',h)},[fn])}


function SaveMenu({ctx,product,onDone,returnFocus,align='right'}){
  return html`<${SaveBoardMenu} boards=${ctx.boards} catalog=${BY_ID} product=${product}
    onSave=${(selected,boardId)=>ctx.saveTo(selected.id,boardId,false,selected)}
    onCreate=${(title,selected)=>ctx.createBoard(title,selected.id,false,selected)}
    onClose=${onDone} returnFocus=${returnFocus} align=${align}/>`;
}


/** Typed controls delegate to the existing source/variant-aware owner operations. */
function PinCard({p,ctx}){
  const available=ctx.savedProducts?ctx.savedProducts.get(p.id)?.lid===p.lid:has(p.id);
  return html`<${CatalogProductCard} product=${p} boards=${ctx.boards} mode=${ctx.mode} available=${available}
    pinterestUrl=${pinItUrl(p.img,p.name+' '+p.line+' · Louie Mae',pieceShareUrl(shareOrigin(),p.id,ctx.me.refCode,'pin'))}
    icons=${{down:I('down',{width:14}),pinterest:I('pint'),studio:I('brush'),add:I('plus')}}
    onOpen=${identity=>ctx.openPin(identity.pid,identity)}
    onSave=${(selected,boardId)=>ctx.saveTo(selected.id,boardId,false,selected)}
    onStudio=${identity=>ctx.toStudio([identity])}
    onAdd=${(selected,image)=>ctx.addToTray(selected.id,1,image,false,selected)}
    renderSaveMenu=${(close,trigger)=>html`<${SaveMenu} ctx=${ctx} product=${p} align="left" onDone=${close} returnFocus=${trigger}/>`}/>`;
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
  const out=[];items.forEach((p,i)=>{out.push(html`<${PinCard} key=${projectItemKey({pid:p.id,lid:p.lid,vid:p.vid})} p=${p} ctx=${ctx}/>`);if(mixBoards?.length&&i%5===2){const b=mixBoards[Math.floor(i/5)%mixBoards.length];out.push(html`<${BoardPin} key=${'b'+b.id+i} b=${b} ctx=${ctx}/>`)}});
  return html`<div className=${'wall '+(density==='compact'?'compact':density==='wide'?'wide':'')}>${out}</div>`;
}


/* ================= ROOM HERO ================= */
const GLOW_AT={8:[50,80],11:[82,10],12:[50,92]};

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

// Metres one floor texture covers. The oak texture holds 8 boards across, so 1.44 m gives 18 cm boards.
const FLOOR_TILE={herring:1.3,herringDark:1.3,oak:1.44,oakDark:1.44,oakLight:1.44,oakGrey:1.44,oakWhite:1.44,terrazzo:1.8,marble:2.6,marbleLight:2.6,concrete:2.6,tile:1.2,checker:1.2,carpet:1.5};


/* ================= STUDIO & PLANNER SHELL ================= */
// Both pages share one quiet shell: a 56px top bar, a rail of icons that opens one drawer at a time,
// a full-bleed canvas, a selection bar beside whatever is selected, and a bottom pill for the total.
const PAGES=[['square','Square 1:1',1,1],['portrait','Portrait 4:5',4,5],['story','Story 9:16',9,16],['landscape','Landscape 16:9',16,9],['letter','Letter',8.5,11],['a4','A4',210,297]];

const pageOf=k=>PAGES.find(p=>p[0]===k)||PAGES[1];

const borderOf=e=>e.border===true||e.border==null?'white':e.border===false?'none':e.border;

const POLY0=[[.04,.03],[.96,.06],[.97,.95],[.03,.97]];

const BW=1000,boardH=page=>{const P=pageOf(page);return BW*P[3]/P[2]};

// The board's outline as one SVG path in a W × H box. The canvas mask, its edge and every export draw from it.
function boardPath(shape,W,H,poly){
  const f=n=>+n.toFixed(1);
  if(shape==='rounded'){const r=Math.min(W,H)*.06;return `M${r} 0H${W-r}A${r} ${r} 0 0 1 ${W} ${r}V${H-r}A${r} ${r} 0 0 1 ${W-r} ${H}H${r}A${r} ${r} 0 0 1 0 ${H-r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`}
  if(shape==='arch'){const r=W/2,t=Math.min(r,H);return `M0 ${H}V${t}A${r} ${t} 0 0 1 ${W} ${t}V${H}Z`}
  if(shape==='circle'){const r=Math.min(W,H)/2,cx=W/2,cy=H/2;return `M${cx-r} ${cy}A${r} ${r} 0 1 1 ${cx+r} ${cy}A${r} ${r} 0 1 1 ${cx-r} ${cy}Z`}
  if(shape==='oval')return `M0 ${H/2}A${W/2} ${H/2} 0 1 1 ${W} ${H/2}A${W/2} ${H/2} 0 1 1 0 ${H/2}Z`;
  if(shape==='scallop'){const s=W/28;const side=(x0,y0,x1,y1)=>{const L=Math.hypot(x1-x0,y1-y0),n=Math.max(1,Math.round(L/(2*s))),r=L/n/2;let d='';for(let i=1;i<=n;i++)d+=`A${f(r)} ${f(r)} 0 0 1 ${f(x0+(x1-x0)*i/n)} ${f(y0+(y1-y0)*i/n)}`;return d};
    return `M${s} ${s}${side(s,s,W-s,s)}${side(W-s,s,W-s,H-s)}${side(W-s,H-s,s,H-s)}${side(s,H-s,s,s)}Z`}
  if(shape==='torn'){const R=rnd(7);const pts=[];const m=Math.min(W,H)*.02;const edge=(x0,y0,x1,y1,nx,ny)=>{const n=Math.max(4,Math.round(Math.hypot(x1-x0,y1-y0)/(W/70)));for(let i=0;i<n;i++){const t=i/n,j=m*(.25+R()*.75);pts.push([x0+(x1-x0)*t+nx*j,y0+(y1-y0)*t+ny*j])}};
    edge(0,0,W,0,0,1);edge(W,0,W,H,-1,0);edge(W,H,0,H,0,-1);edge(0,H,0,0,1,0);return 'M'+pts.map(p=>f(p[0])+' '+f(p[1])).join('L')+'Z'}
  if(shape==='poly')return 'M'+(poly&&poly.length>2?poly:POLY0).map(([x,y])=>f(x*W)+' '+f(y*H)).join('L')+'Z';
  return `M0 0H${W}V${H}H0Z`;
}

const maskOf=(shape,W,H,poly)=>{if(!shape||shape==='rect')return {};const u=`url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${H}' preserveAspectRatio='none'><path d='${boardPath(shape,W,H,poly)}'/></svg>`)}")`;
  return {WebkitMaskImage:u,maskImage:u,WebkitMaskSize:'100% 100%',maskSize:'100% 100%',WebkitMaskRepeat:'no-repeat',maskRepeat:'no-repeat'}};

// Three ways to lay out a composed board, so Compose can offer drafts to choose between.
const LAYOUTS=[
  [[6,8,52,-3,'arch'],[52,4,42,2,'rect'],[44,40,34,-1.5,'circle'],[6,54,40,2.5,'rect'],[60,66,30,-2,'pill'],[30,74,24,3,'rect']],
  [[6,4,42,0,'rect'],[52,4,42,0,'rect'],[6,40,42,0,'rect'],[52,40,42,0,'rect'],[70,75,14,0,'circle'],[54,75,14,0,'circle']],
  [[22,3,56,0,'arch'],[4,52,30,-2,'circle'],[66,52,30,2,'circle'],[37,63,26,0,'rect'],[84,4,12,0,'pill'],[4,4,12,0,'pill']],
];

const SLOTS=LAYOUTS[0];

function mkImg(reference,i=0,mode='collage',L=SLOTS,style){const identity=typeof reference==='number'?{pid:reference,...(has(reference)?{lid:byId(reference).lid,vid:byId(reference).vid}:{})}:{pid:reference.pid,lid:reference.lid,vid:reference.vid};const s=L[i%L.length];const st=style||(mode==='room'?'room':'framed');return {id:uid(),kind:'img',...identity,x:s[0],y:s[1],w:s[2],rot:st==='framed'?s[3]:0,shape:s[4],border:'white',style:st,shadow:st==='room'?'floor':'soft',flip:false,motion:false,tone:'none',locked:false,hidden:false}}

function mkText(t,x=8,y=84,size=7.5){return {id:uid(),kind:'text',text:t,x,y,w:70,rot:0,size,font:'display',color:'#2B211A',locked:false,hidden:false}}

const toneF={none:'none',warm:'sepia(.25) saturate(1.1)',mono:'grayscale(1) contrast(1.05)',dusk:'brightness(.85) sepia(.3) hue-rotate(-8deg)'};

// What an item looks like on a board. Sizes are in container units, so the same markup draws the canvas and its previews.
const cropStyle=c=>c?{objectPosition:`${c.x}% ${c.y}%`,transform:`scale(${c.z})`,transformOrigin:`${c.x}% ${c.y}%`}:{};

function ElView({e,products=BY_ID}){
  const geometry=studioGeometry(products);const elAR=geometry.elementAspect;
  if(e.kind==='img'){const p=geometry.product(e);const st=styleOf(e);
    if(st==='framed')return html`<div className=${'cut shape-'+e.shape+' bd-'+borderOf(e)+(e.motion?' float':'')} style=${{aspectRatio:elAR(e)}}><img src=${p.img} alt=${p.name} draggable="false" style=${{filter:toneF[e.tone],...cropStyle(e.crop)}}/></div>`;
    return html`<div className=${'cutout sh-'+(e.shadow||(st==='room'?'floor':'soft'))+(geometry.hasCutout(e)?'':' nocut')+(e.motion?' float':'')} style=${{aspectRatio:elAR(e)}}><img src=${p.cutout||p.img} alt=${p.name} draggable="false" style=${{filter:toneF[e.tone],transform:e.flip?'scaleX(-1)':undefined}}/></div>`}
  if(e.kind==='inspo')return html`<div className=${'cut shape-'+e.shape+' bd-'+borderOf(e)+(e.motion?' float':'')} style=${{aspectRatio:elAR(e)}}><img src=${e.src} alt=${e.title} draggable="false" style=${{filter:toneF[e.tone],...cropStyle(e.crop)}}/></div>`;
  if(e.kind==='text')return html`<div className="tx" style=${{fontFamily:`var(--${e.font})`,fontStyle:e.font==='display'?'italic':'normal',color:e.color,fontSize:e.size+'cqw',textTransform:e.font==='mono'?'uppercase':'none',letterSpacing:e.font==='mono'?'.08em':'-.01em'}}>${e.text}</div>`;
  return html`<div className="sw-shape" style=${{background:e.color,borderRadius:'50%',boxShadow:'0 0 0 .6cqw #FFFDF9'}}></div>`;
}

// A photo without a true cutout multiplies onto the board, so its white studio ground disappears.
const blends=(e,products=BY_ID)=>e.kind==='img'&&styleOf(e)!=='framed'&&!studioGeometry(products).hasCutout(e);

const elStyle=(e,i,bg,products=BY_ID)=>({left:e.x+'%',top:e.y+'%',width:e.kind==='text'?'auto':studioGeometry(products).width(e,bg)+'%',maxWidth:e.kind==='text'?'88%':'none',transform:`rotate(${e.rot}deg)`,zIndex:i});

const bgStyle=bg=>bg.img?{backgroundImage:`url(${bg.img})`}:{backgroundColor:bg.color};

// A read-only board, for Compose drafts and Ideas previews.
function BoardPreview({els,bg,page,shape,poly,products=BY_ID}){const P=pageOf(page);
  return html`<div className=${'canvas sx-preview'+(bg.grid&&!bg.img?' grid':'')} style=${{...bgStyle(bg),aspectRatio:`${P[2]}/${P[3]}`,...maskOf(shape,BW,boardH(page),poly)}}>${els.map((e,i)=>e.hidden?null:html`<div key=${e.id} className=${'el'+(blends(e,products)?' blend':'')} style=${elStyle(e,i,bg,products)}><${ElView} e=${e} products=${products}/></div>`)}</div>`;
}

// Partner links: a visitor id stays on this device; a partner code is remembered for 30 days.
// visitorId, activeRef and the saved partner code live in lib/partnerLink.ts, shared with the storefront.
const errText=e=>e?.data||String(e?.message||'').replace(/^.*Uncaught Error: /,'').split('\n')[0]||'Something went wrong. Try again.';

const dataUrlBlob=async src=>(await fetch(src)).blob();

// Dimensions from a listing's facts, "Overall dimensions (W × D × H): 92.5 × 39 × 26.4 in".
function dimsText(p){const m=String(p.facts||'').match(/(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)(?:\s*[×x]\s*(\d+(?:\.\d+)?))?\s*(in|cm)/i);if(!m)return '';const u=m[4].toLowerCase();return `${m[1]} × ${m[2]}${m[3]?' × '+m[3]:''} ${u}`}


// Share links: one stable link per board and mode, tagged with the route it left through.
const bundleUrl=(slug,ch)=>`${location.origin}/b/${slug}?c=${ch}`;

// GLB pieces load on demand with Draco, Meshopt and KTX2 support, then are scaled to the
// catalog's W × D × H exactly (whatever units the file was made in) with their base on the floor.
let gltfP=null;

function gltfLoader(renderer){return gltfP||=Promise.all([loadThree(),import('three/examples/jsm/loaders/GLTFLoader.js'),import('three/examples/jsm/loaders/DRACOLoader.js'),import('three/examples/jsm/loaders/KTX2Loader.js'),import('three/examples/jsm/libs/meshopt_decoder.module.js')]).then(([T,{GLTFLoader},{DRACOLoader},{KTX2Loader},{MeshoptDecoder}])=>{
  const l=new GLTFLoader();const draco=new DRACOLoader();draco.setDecoderPath('/trade/decoders/draco/');l.setDRACOLoader(draco);l.setMeshoptDecoder(MeshoptDecoder);
  if(renderer){const k=new KTX2Loader();k.setTranscoderPath('/trade/decoders/basis/');k.detectSupport(renderer);l.setKTX2Loader(k)}return l})}

const glbCache=new Map();

async function loadGLB(url,renderer){if(!glbCache.has(url))glbCache.set(url,gltfLoader(renderer).then(l=>l.loadAsync(url)).catch(e=>{glbCache.delete(url);throw e}));const g=await glbCache.get(url);return g.scene.clone(true)}

// Scale a model so its bounding box is exactly w × d × h metres, centred, standing on y = 0.
function fitToDims(T,obj,dims){const box=new T.Box3().setFromObject(obj);const size=box.getSize(new T.Vector3());
  if(size.x>0&&size.y>0&&size.z>0)obj.scale.multiply(new T.Vector3(dims.w/100/size.x,dims.h/100/size.y,dims.d/100/size.z));
  const b2=new T.Box3().setFromObject(obj);const c=b2.getCenter(new T.Vector3());obj.position.x-=c.x;obj.position.z-=c.z;obj.position.y-=b2.min.y;
  obj.traverse(o=>{if(o.isMesh){o.castShadow=o.receiveShadow=true}});return obj}
export { MAT, TYPE, byId, has, tp, pr, cut, pinItUrl, threeP, loadThree, LX, useThree, SPACES, SPACE_KEYS, COMMUNITY, load, store, hex2rgb, cdist, uid, copyText, COLOR_WORDS, matchPrompt, ICONS, I, useOutside, SaveMenu, PinCard, BoardPin, Wall, GLOW_AT, ROOMS, TEX, rnd, texture, STUDY, FLOOR_TILE, PAGES, pageOf, borderOf, POLY0, BW, boardH, boardPath, maskOf, LAYOUTS, SLOTS, mkImg, mkText, toneF, cropStyle, ElView, blends, elStyle, bgStyle, BoardPreview, errText, dataUrlBlob, dimsText, bundleUrl, gltfP, gltfLoader, glbCache, loadGLB, fitToDims };
