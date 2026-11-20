import {expect,it,vi} from 'vitest';
import {calibrationScale,renderPlannerLabels,usingDisposable,withRestoredVisibility,renderAtRevision} from './editorSafety';
import {shareableBoard} from './shareableBoard';

it('renders room and product markup literally without creating executable elements',()=>{
  const container=document.createElement('div');
  renderPlannerLabels(container,[{className:'zone',x:10,y:20,text:'<img src=x onerror=alert(1)>'}]);
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toBe('<img src=x onerror=alert(1)>');
  expect(container.firstElementChild?.className).toBe('pl-lab zone');
  expect((container.firstElementChild as HTMLElement).style.left).toBe('10px');
});
it.each([[2,0],[Infinity,4],[2,NaN],[-2,4],[2,Number.MIN_VALUE]])('rejects invalid calibration %s / %s', (real,pixels)=>{
  expect(calibrationScale(real,pixels)).toBeNull();
});
it('calculates a finite positive scale',()=>expect(calibrationScale(2,100)).toBe(.02));
it.each(['setup','export'])('disposes rendering resources and restores visibility on %s failure',async stage=>{
  const hidden=[{visible:false}],dispose=vi.fn();
  await expect(withRestoredVisibility(hidden,()=>usingDisposable(()=>({dispose}),()=>{throw Error(stage);}))).rejects.toThrow(stage);
  expect(hidden[0].visible).toBe(true);expect(dispose).toHaveBeenCalledTimes(1);
});
it('restores a scene even when creating its renderer fails',async()=>{
  const hidden=[{visible:false}];
  await expect(withRestoredVisibility(hidden,()=>usingDisposable(()=>{throw Error('context unavailable');},()=>null))).rejects.toThrow('context unavailable');
  expect(hidden[0].visible).toBe(true);
});
it('keeps overlays hidden through raster fallback, then disposes and restores them',async()=>{
  const hidden=[{visible:false}],traceDispose=vi.fn(),rasterDispose=vi.fn();
  const value=await withRestoredVisibility(hidden,async()=>{
    try{return await usingDisposable(()=>({dispose:traceDispose}),()=>{throw Error('trace failed');});}
    catch{return usingDisposable(()=>({dispose:rasterDispose}),()=>{expect(hidden[0].visible).toBe(false);return 'raster';});}
  });
  expect(value).toBe('raster');expect(hidden[0].visible).toBe(true);expect(traceDispose).toHaveBeenCalledOnce();expect(rasterDispose).toHaveBeenCalledOnce();
});
it('filters local photos from hosted cover input without altering the local download document',()=>{
  const local={bg:{img:'data:image/png;base64,private',grid:true},els:[{src:'blob:private'},{src:'data:image/png;base64,private'},{src:'https://example.com/public.jpg'},{text:'Title'}]};
  const hosted=shareableBoard(local);
  expect(hosted.bg).toEqual({color:'#EFE6D8',grid:true});
  expect(hosted.els).toEqual([{src:'https://example.com/public.jpg'},{text:'Title'}]);
  expect(local.els).toHaveLength(4);expect(local.bg.img).toContain('private');
});
it('discards a completed image when the room changes during rendering, including edit then undo',async()=>{
  let revision=1,finish!:(value:string)=>void;
  const result=renderAtRevision(()=>revision,()=>new Promise<string>(resolve=>{finish=resolve;}));
  revision=3;finish('old scene');expect(await result).toBeNull();
  expect(await renderAtRevision(()=>revision,async()=>'current scene')).toBe('current scene');
});
