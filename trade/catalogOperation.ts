/** Invalidate asynchronous exports even if a removed product is later restored. */
export function catalogOperationGuard(generation: number, current: () => number, ids: number[], exists: (id: number) => boolean) {
  return () => {
    if (generation !== current() || ids.some(id => !exists(id))) {
      throw new Error('The catalog changed. Review your saved items and try again.');
    }
  };
}
