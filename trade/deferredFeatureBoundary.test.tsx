import React from 'react';
import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {deferredFeature} from './deferredFeature';
afterEach(()=>{cleanup();vi.restoreAllMocks()});
it('keeps the fallback landmark local and removes it once the feature loads',async()=>{
 let done!: (module:{default:React.ComponentType<{title:string}>})=>void;
 const Tool=deferredFeature(()=>new Promise<{default:React.ComponentType<{title:string}>}>(r=>done=r),'Studio',(content,props)=><main><h1>{props.title}</h1>{content}</main>);
 render(<Tool title="Saved studio"/>);expect(screen.getByRole('main')).toHaveTextContent('Saved studio');expect(screen.getByRole('status')).toBeTruthy();
 await act(async()=>done({default:({title})=><main><h1>{title}</h1><p>Ready canvas</p></main>}));expect(screen.getAllByRole('main')).toHaveLength(1);expect(screen.queryByRole('status')).toBeNull();
});
it('wraps failure recovery while keeping existing project content available',async()=>{
 vi.spyOn(console,'error').mockImplementation(()=>{});
 const Tool=deferredFeature(()=>Promise.reject(new Error('Offline')),'Studio',(content)=><main aria-label="Workspace">{content}</main>);
 await act(async()=>{render(<><p>Saved project</p><Tool/></>)});
 expect(screen.getByRole('main',{name:'Workspace'})).toContainElement(screen.getByRole('alert'));expect(screen.getByText('Saved project')).toBeTruthy();expect(screen.getByRole('button',{name:'Reload page'})).toBeTruthy();
});
