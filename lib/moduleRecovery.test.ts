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
  document.body.innerHTML = '<section id="lm-shell"></section><section id="holm-shell"></section><div id="root"></div>';
  localStorage.setItem('saved-cart', 'retained');
  showStartupFailure(new Error('private module diagnostic'));
  expect(document.querySelectorAll('main')).toHaveLength(1);
  expect(document.querySelector('button')?.textContent).toBe('Reload page');
  expect(document.getElementById('lm-shell')).toBeNull();
  expect(document.body.textContent).not.toContain('private module diagnostic');
  expect(localStorage.getItem('saved-cart')).toBe('retained');
  expect(log).toHaveBeenCalledOnce();
});
