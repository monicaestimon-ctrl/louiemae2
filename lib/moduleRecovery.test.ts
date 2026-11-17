import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadModule, ModuleLoadError, showStartupFailure } from './moduleRecovery';
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); localStorage.clear(); });

it('bounds a stalled module and clears its timer after success or rejection', async () => {
  await expect(loadModule(async () => 'loaded')).resolves.toBe('loaded');
  expect(vi.getTimerCount()).toBe(0);
  const original = new Error('network failure');
  await expect(loadModule(async () => { throw original; })).rejects.toMatchObject({ name: 'ModuleLoadError', cause: original });
  expect(vi.getTimerCount()).toBe(0);
  const stalled = loadModule(() => new Promise(() => {}));
  const rejected = expect(stalled).rejects.toBeInstanceOf(ModuleLoadError);
  await vi.advanceTimersByTimeAsync(10_000);
  await rejected;
});

it('provides non-React recovery without exposing diagnostics or clearing saved carts', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  document.body.innerHTML = '<section id="lm-shell"></section><main id="lm-product-document"></main><section id="holm-shell"></section><div id="root"></div>';
  const schema = document.createElement('script'); schema.id = 'lm-product-structured-data'; document.head.append(schema);
  localStorage.setItem('saved-cart', 'retained');
  showStartupFailure(new Error('private module diagnostic'));
  expect(document.querySelectorAll('main')).toHaveLength(1);
  expect(document.querySelector('button')?.textContent).toBe('Reload page');
  expect(document.getElementById('lm-shell')).toBeNull();
  expect(document.getElementById('lm-product-document')).toBeNull();
  expect(document.getElementById('lm-product-structured-data')).toBeNull();
  expect(document.body.textContent).not.toContain('private module diagnostic');
  expect(localStorage.getItem('saved-cart')).toBe('retained');
  expect(log).toHaveBeenCalledOnce();
});

it.each(['collection','page','journal'])('removes the %s initial document that would hide recovery',type=>{
 vi.spyOn(console,'error').mockImplementation(()=>undefined);
 document.body.innerHTML=`<style>#lm-${type}-document~#root{visibility:hidden}</style><main id="lm-${type}-document">Initial content</main><script id="lm-${type}-structured-data" type="application/ld+json">{}</script><script id="lm-product-bootstrap" type="application/json">{}</script><div id="root"></div>`;
 localStorage.setItem('saved-cart','retained');
 expect(getComputedStyle(document.getElementById('root')!).visibility).toBe('hidden');
 showStartupFailure(new Error('Synthetic module failure'));
 expect(getComputedStyle(document.getElementById('root')!).visibility).toBe('visible');
 expect(document.querySelectorAll('main')).toHaveLength(1);
 expect(document.querySelectorAll('[id$="structured-data"],#lm-product-bootstrap')).toHaveLength(0);
 expect(localStorage.getItem('saved-cart')).toBe('retained');
});
