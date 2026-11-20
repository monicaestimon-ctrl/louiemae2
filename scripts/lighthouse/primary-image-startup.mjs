/* global window, performance */
import {Buffer} from 'node:buffer';
import {build}from'esbuild';import puppeteer from'puppeteer-core';import assert from'node:assert/strict';import{mkdir,writeFile}from'node:fs/promises';
const compiled=await build({stdin:{contents:"import{startAfterVisibleContent}from'./lib/visibleStartup';window.boots=0;window.deadlineFired=false;const realSetTimeout=window.setTimeout.bind(window);window.setTimeout=(callback,delay,...args)=>{if(delay===1500){window.releaseDeadline=()=>{window.deadlineFired=true;callback(...args)};return 0}return realSetTimeout(callback,delay,...args)};startAfterVisibleContent(()=>window.boots++);",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife'});
const browser=await puppeteer.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),headless:true}),results=[];
try{for(const mode of ['load','error','interaction','timeout']){
 const page=await browser.newPage();let pending;
 await page.setRequestInterception(true);page.on('request',request=>{if(request.url().endsWith('/hero.gif'))pending=request;else if(request.isNavigationRequest())request.respond({status:200,contentType:'text/html',body:`<!doctype html><html lang="en"><title>Startup fixture</title><body><main id="lm-page-document"><h1>Server content</h1><img src="/hero.gif" fetchpriority="high" loading="eager" alt="Fixture" width="100" height="100"></main><script>${compiled.outputFiles[0].text}</script></body></html>`});else request.abort()});
 await page.goto('http://fixture.invalid/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>performance.getEntriesByName('first-contentful-paint').length>0);assert.ok(pending);assert.equal(await page.evaluate(()=>window.boots),0);
 if(mode==='timeout')await page.evaluate(()=>window.releaseDeadline());
 if(mode==='interaction')await page.keyboard.press('Tab');else if(mode==='load')await pending.respond({status:200,contentType:'image/gif',body:Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64')});else if(mode==='error')await pending.respond({status:404,body:''});
 await page.waitForFunction(()=>window.boots===1);if(mode==='interaction'||mode==='timeout')await pending.respond({status:404,body:''});
 assert.equal(await page.evaluate(()=>window.deadlineFired),mode==='timeout');
 assert.equal(await page.evaluate(()=>window.boots),1);results.push({mode,visibleContentBeforeBoot:true,bootCount:1});await page.close();
}await mkdir('artifacts/lighthouse',{recursive:true});await writeFile('artifacts/lighthouse/primary-image-startup-browser.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));}finally{await browser.close()}
