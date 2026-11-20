import {afterEach,expect,it,vi} from 'vitest';
import {readPendingStudioSeed,savePendingStudioSeed,reloadEditor} from './pendingStudioSeed';
afterEach(()=>{vi.restoreAllMocks();savePendingStudioSeed(null);sessionStorage.clear();});
it('retains full variant identity and local photo through reload, then clears on consumption',()=>{
  const seed={ids:[{pid:7,lid:'supplier-record',vid:'nondefault-finish'}],bg:'data:image/png;base64,private',title:'Project'};
  savePendingStudioSeed(seed);expect(readPendingStudioSeed()).toEqual(seed);
  savePendingStudioSeed(null);expect(readPendingStudioSeed()).toBeNull();
});
it('does not restore malformed or unsupported pending work',()=>{
  sessionStorage.setItem('hol:pending-studio',JSON.stringify({version:2,seed:{ids:[7]}}));
  expect(readPendingStudioSeed()).toBeNull();
  sessionStorage.setItem('hol:pending-studio','bad-json');expect(readPendingStudioSeed()).toBeNull();
});
it('asks before a reload would discard an unsaved selection or local photo',()=>{
  vi.spyOn(window.Storage.prototype,'setItem').mockImplementation(()=>{throw Error('Quota exceeded');});
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
  savePendingStudioSeed({bg:'data:image/png;base64,private'});reloadEditor();
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Reloading will discard it'));
});
