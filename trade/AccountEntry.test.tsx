import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import type { ComponentProps } from 'react';
const mocks=vi.hoisted(()=>({signOut:vi.fn(),signIn:vi.fn(),ensure:vi.fn(),queries:vi.fn()}));
vi.mock('@convex-dev/auth/react',()=>({useAuthActions:()=>({signOut:mocks.signOut,signIn:mocks.signIn})}));
vi.mock('convex/react',()=>({useMutation:()=>mocks.ensure,useQuery:(ref:Parameters<typeof getFunctionName>[0],args:unknown)=>{mocks.queries(getFunctionName(ref),args);return getFunctionName(ref)==='holm:signInOptions'?{google:true}:null}}));
import { AccountEntry } from './AccountEntry';
const member:ComponentProps<typeof AccountEntry>['me']={signedIn:true,email:'member@example.test',displayName:'Member',businessName:'Studio',tradeStatus:'approved',verified:true,partner:false,partnerTier:null,refCode:null,admin:false};
beforeEach(()=>{vi.resetAllMocks();mocks.ensure.mockResolvedValue(null);window.history.replaceState(null,'','/trade/#account');sessionStorage.clear();localStorage.clear();});
afterEach(()=>cleanup());
it('offers anonymous account sign-in without private application or catalog reads',async()=>{
 render(<AccountEntry me={{signedIn:false}} route="account"/>);
 fireEvent.click(await screen.findByRole('button',{name:'Sign in'}));expect(location.hash).toBe('#welcome');
 expect(mocks.queries).toHaveBeenCalledWith('holm:myApplication','skip');
 expect(mocks.queries.mock.calls.some(([name])=>name.startsWith('holm:catalog'))).toBe(false);
});
it('keeps OAuth on the independent welcome route',async()=>{
 mocks.signIn.mockResolvedValue(null);render(<AccountEntry me={{signedIn:false}} route="welcome"/>);
 fireEvent.click(await screen.findByRole('button',{name:'Continue with Google'}));
 await waitFor(()=>expect(mocks.signIn).toHaveBeenCalledWith('google',{redirectTo:'/trade/#welcome'}));
});
it.each([['sourcing','sourcing'],['welcome','account'],['https://outside.example','account']])('resumes a safe stored intent %s',async(stored,expected)=>{
 sessionStorage.setItem('hol:after',stored);render(<AccountEntry me={member} route="welcome"/>);
 await waitFor(()=>{expect(location.hash).toBe('#'+expected);expect(sessionStorage.getItem('hol:after')).toBeNull();});
});
it('retains private drafts on failed sign-out and prevents duplicate requests',async()=>{
 let reject!:(error:Error)=>void;mocks.signOut.mockImplementation(()=>new Promise((_resolve,fail)=>{reject=fail}));localStorage.setItem('hol:tray','private draft');
 render(<AccountEntry me={member} route="account"/>);fireEvent.click(await screen.findByRole('button',{name:'Log out'}));
 expect(screen.getByRole('button',{name:'Signing out…'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Signing out…'}));expect(mocks.signOut).toHaveBeenCalledOnce();
 await act(async()=>reject(new Error('offline')));expect(screen.getByRole('alert')).toHaveTextContent('could not sign you out');expect(localStorage.getItem('hol:tray')).toBe('private draft');
});
it('clears private local project state only after successful sign-out',async()=>{
 mocks.signOut.mockResolvedValue(null);localStorage.setItem('hol:tray','private draft');localStorage.setItem('unrelated','keep');
 render(<AccountEntry me={member} route="account"/>);fireEvent.click(await screen.findByRole('button',{name:'Log out'}));
 await waitFor(()=>expect(location.hash).toBe('#welcome'));expect(localStorage.getItem('hol:tray')).toBeNull();expect(localStorage.getItem('unrelated')).toBe('keep');
});
