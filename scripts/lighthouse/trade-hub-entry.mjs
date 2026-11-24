/* global window, document */
import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
const built=await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{LiveShell}from'./trade/LiveShell';const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<LiveShell/>);window.render();`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'isolated-hub',setup(b){
 b.onResolve({filter:/^convex\/react$/},()=>({path:'convex',namespace:'fixture'}));
 b.onResolve({filter:/^@convex-dev\/auth\/react$/},()=>({path:'auth',namespace:'fixture'}));
 b.onResolve({filter:/useRecoverableQuery$/},()=>({path:'recovery',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'js',resolveDir:process.cwd(),contents:{
 auth:`export const useAuthToken=()=>null;export const useAuthActions=()=>({signIn:()=>{window.commands++;throw Error('Forbidden auth command')},signOut:()=>{window.commands++;throw Error('Forbidden auth command')}});`,
 convex:`import{getFunctionName}from'convex/server';export const useQueries=()=>{throw Error('Unexpected saved catalog subscription')};export const useConvexAuth=()=>({isLoading:false,isAuthenticated:window.me.signedIn});export const useQuery=(ref,args)=>{const name=getFunctionName(ref);window.reads.push({name,skip:args==='skip'});if(name.startsWith('holm:catalog'))window.catalogReads++;return name==='holm:me'?window.me:name==='holm:signInOptions'?{google:true}:null};export const usePaginatedQuery=()=>{window.catalogReads++;return{results:[],status:'Exhausted',loadMore(){throw Error('Catalog must not load')}}};export const useMutation=()=>()=>{window.commands++;throw Error('Forbidden mutation')};export const useAction=useMutation;`,
 recovery:`import{getFunctionName}from'convex/server';export const useRecoverableQuery=(ref,args)=>{const name=getFunctionName(ref);window.reads.push({name,skip:args==='skip'});const data={'holm:myQuoteRequests':[{reference:'Q-FIXTURE',projectName:'Saved fixture project',subtotal:100000,status:'requested'}],'holm:myClientQuotes':[],'holm:myApplication':null,'v2Admin:publicFlags':{creatorEnrollment:false}};return{status:args==='skip'?'idle':window.fixtureStatus,data:args==='skip'||window.fixtureStatus!=='ready'?undefined:data[name],retry(){window.retries++;window.fixtureStatus='ready';window.render()}}};`,
 }[path]}));
}}]});
const names=await readdir('dist/assets'),css=(await Promise.all(['main','trade'].map(prefix=>readFile('dist/assets/'+names.find(n=>n.startsWith(prefix+'-')&&n.endsWith('.css')),'utf8')))).join('\n');
const browser=await puppeteer.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'})}),results=[];
try{for(const width of [390,844,1440])for(const scenario of ['anonymous','member','loading','error','role-loss']){
 const page=await browser.newPage();await page.setViewport({width,height:900});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);page.on('request',r=>r.isNavigationRequest()?r.respond({status:200,contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>Trade Hub fixture</title></head><body><div id="root"></div></body></html>'}):r.abort());
 await page.goto('https://fixture.test/trade/#hub');await page.addStyleTag({content:css});
 await page.evaluate(s=>{window.commands=0;window.catalogReads=0;window.reads=[];window.retries=0;window.fixtureStatus=s==='loading'?'loading':s==='error'?'unavailable':'ready';window.me=s==='anonymous'?{signedIn:false}:{signedIn:true,email:'fixture@example.test',displayName:'Fixture Studio',businessName:'Fixture Studio',verified:true,tradeStatus:'approved',partner:false,admin:false};},scenario);
 await page.addScriptTag({content:built.outputFiles[0].text});
 const expected=scenario==='anonymous'?'Sign in to see your quotes':scenario==='loading'?'Loading your quotes and membership':scenario==='error'?'temporarily unavailable':'Saved fixture project';
 await page.waitForFunction(s=>document.body.textContent.includes(s),{},expected);
 if(scenario==='error'){
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Try Hub again').focus());await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.body.textContent.includes('Saved fixture project'));assert.equal(await page.evaluate(()=>window.retries),4);
 }
 if(scenario==='role-loss'){
  await page.evaluate(()=>{window.me={signedIn:false};window.render()});
  await page.waitForFunction(()=>document.body.textContent.includes('Sign in to see your quotes'));
  assert.equal(await page.evaluate(()=>document.body.textContent.includes('Saved fixture project')),false);
 }
 if(scenario==='anonymous')assert.equal(await page.evaluate(()=>window.reads.some(r=>['holm:myQuoteRequests','holm:myClientQuotes','holm:myApplication'].includes(r.name)&&!r.skip)),false);
 assert.equal(await page.evaluate(()=>window.catalogReads),0);assert.equal(await page.evaluate(()=>window.commands),0);
 assert.equal(await page.evaluate(()=>document.body.textContent.includes('on for every piece')),false);
 await page.addScriptTag({content:axe.source});const violations=await page.evaluate(async()=>(await window.axe.run()).violations.map(v=>v.id));
 assert.deepEqual(violations,[],`${width}/${scenario}`);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false);
 results.push({width,scenario,violations,catalogReads:0,commands:0});await page.close();
}
 await mkdir('artifacts/lighthouse',{recursive:true});await writeFile('artifacts/lighthouse/trade-hub-entry-browser.json',JSON.stringify({scope:'Actual LiveShell, account entry and Hub with isolated identity and query responses. No actual authentication, payments, enrollment, account edits or production writes. External assets blocked; built CSS used.',results},null,2));console.log(`${results.length} independent Hub cases passed`);
}finally{await browser.close();}
