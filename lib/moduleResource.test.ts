import { expect, it, vi } from 'vitest';
import { createModuleResource } from './moduleResource';
import { ModuleLoadError } from './moduleRecovery';
it('shares one import and reads an already preloaded module synchronously', async () => {
  const load = vi.fn(async () => ({ page: 'ready' }));
  const resource = createModuleResource(load);
  resource.preload();
  let pending: Promise<void>;
  try {
    resource.read();
    throw Error('Expected suspension');
  } catch (value) {
    pending = value as Promise<void>;
  }
  await pending;
  expect(resource.read()).toEqual({ page: 'ready' });
  resource.preload();
  expect(load).toHaveBeenCalledTimes(1);
});
it('retains a preload rejection for the route boundary without starting retries', async () => {
  const cause = new Error('offline');
  const load = vi.fn(async () => {
    throw cause;
  });
  const resource = createModuleResource(load);
  resource.preload();
  let pending: Promise<void>;
  try {
    resource.read();
  } catch (value) {
    pending = value as Promise<void>;
  }
  await expect(pending).rejects.toBeInstanceOf(ModuleLoadError);
  expect(() => resource.read()).toThrow(ModuleLoadError);
  resource.preload();
  expect(load).toHaveBeenCalledTimes(1);
});
