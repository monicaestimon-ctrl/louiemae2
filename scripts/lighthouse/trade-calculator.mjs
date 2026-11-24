/* global window, document */
import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
const built=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Calculator from './components/delivery/TradeDeliveryCalculator';const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<main><h1>House of Louie Mae</h1><section><h2>Built for the trade.</h2><Calculator/></section></main>);window.render();`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'read-only-calculator',setup(b){
 b.onResolve({filter:/useRecoverableQuery$/},()=>({path:'query',namespace:'fixture'}));
 b.onResolve({filter:/^convex\/react$/},()=>({path:'convex',namespace:'fixture'}));
 b.onResolve({filter:/useDeliveryRequest$/},()=>({path:'request',namespace:'fixture'}));
 b.onResolve({filter:/\/(CheckoutV2|DeliveryQuoteRequest)$/},()=>({path:'checkout',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'js',contents:{
 query:`export const useRecoverableQuery=()=>({status:window.fixture.status,data:window.fixture.status==='ready'?window.fixture.settings:undefined,retry(){window.retries++;window.fixture.status='ready';window.render()}});`,
 convex:`export const useQuery=()=>undefined;export const usePaginatedQuery=()=>({results:[],status:window.fixture.page,loadMore(n){window.pages.push(n);window.fixture.page='Exhausted';window.render()}});`,
 request:`export const useDeliveryRequest=()=>()=>{window.commands++;throw Error('Business command prohibited')};`,
 checkout:`export const DeliveryCheckout=()=>null;export default function Quote(){return null;}`,
 }[path]}));
}}]});
const names=await readdir('dist/assets'),css=await readFile('dist/assets/'+names.find(n=>/^main-.*\.css$/.test(n)),'utf8');
const browser=await puppeteer.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'})}),results=[];
try{for(const width of [320,844,1440])for(const scenario of ['loading','unavailable','disabled','unapproved','first-page','more-pages','empty']){
 const page=await browser.newPage();await page.setViewport({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);page.on('request',r=>r.abort());
 await page.setContent('<!doctype html><html lang="en"><head><title>Project delivery</title></head><body><div id="root"></div></body></html>');
 await page.addStyleTag({content:css});
 await page.evaluate(s=>{window.commands=0;window.retries=0;window.pages=[];window.fixture={status:s==='loading'?'loading':s==='unavailable'?'unavailable':'ready',settings:{enabled:s!=='disabled',approvedTrade:s!=='unapproved'},page:s==='first-page'?'LoadingFirstPage':s==='more-pages'?'CanLoadMore':'Exhausted'};},scenario);
 await page.addScriptTag({content:built.outputFiles[0].text});
 const expected={loading:'Loading calculator',unavailable:'temporarily unavailable',disabled:'request confirmed merchandise',unapproved:'after trade approval','first-page':'Loading approved products','more-pages':'Load more products',empty:'No products are currently eligible'}[scenario];
 await page.waitForFunction(s=>document.body.textContent.includes(s),{},expected);
 if(scenario==='unavailable'){
  await page.focus('button');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.body.textContent.includes('No products are currently eligible'));
  assert.equal(await page.evaluate(()=>window.retries),1);
 }
 if(scenario==='more-pages'){
  assert.equal(await page.evaluate(()=>document.body.textContent.includes('No products are currently eligible')),false);
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Load more products').click());
  await page.waitForFunction(()=>document.body.textContent.includes('No products are currently eligible'));
  assert.deepEqual(await page.evaluate(()=>window.pages),[20]);
 }
 if(['first-page','more-pages','empty','unavailable'].includes(scenario)){
  assert.equal(await page.$eval('select',e=>e.disabled),true);
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Estimate project delivery').disabled),true);
 }
 await page.addScriptTag({content:axe.source});
 const violations=await page.evaluate(async()=>(await window.axe.run(document.querySelector('main'))).violations.map(v=>v.id));
 assert.deepEqual(violations,[],`${width}/${scenario}`);assert.deepEqual(errors,[]);
 assert.equal(await page.evaluate(()=>window.commands),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false);
 results.push({width,scenario,violations,commands:0});await page.close();
}
 await mkdir('artifacts/lighthouse',{recursive:true});await writeFile('artifacts/lighthouse/trade-calculator-browser.json',JSON.stringify({scope:'Actual calculator with isolated read-only settings/pagination; checkout and quote children excluded. Not authenticated production acceptance or a financial test.',results},null,2));console.log(`${results.length} calculator recovery cases passed`);
}finally{await browser.close();}
