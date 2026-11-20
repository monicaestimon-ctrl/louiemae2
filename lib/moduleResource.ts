import { loadModule } from './moduleRecovery';

/** One bounded import shared by direct-route preloading and Suspense rendering. */
export function createModuleResource<T>(load: () => Promise<T>) {
  let state: 'idle' | 'pending' | 'ready' | 'failed' = 'idle';
  let value: T;
  let failure: unknown;
  let pending: Promise<void>;
  function start() {
    if (state === 'idle') {
      state = 'pending';
      pending = loadModule(load).then(
        (result) => {
          value = result;
          state = 'ready';
        },
        (error) => {
          failure = error;
          state = 'failed';
          throw error;
        }
      );
    }
    return pending;
  }
  return {
    preload() {
      void start().catch(() => {
        /* The route boundary displays this failure on read. */
      });
    },
    read(): T {
      if (state === 'ready') return value;
      if (state === 'failed') throw failure;
      throw start();
    },
  };
}
