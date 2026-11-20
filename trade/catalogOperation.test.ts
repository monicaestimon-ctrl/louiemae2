import { expect, it } from 'vitest';
import { catalogOperationGuard } from './catalogOperation';
it('rejects an export when a product disappears during generation, including restoration', async () => {
  let generation = 1;
  const ids = new Set([1, 2]);
  const check = catalogOperationGuard(generation, () => generation, [1, 2], id => ids.has(id));
  check();
  await Promise.resolve();
  ids.delete(2); generation++;
  expect(check).toThrow('catalog changed');
  ids.add(2); generation++;
  expect(check).toThrow('catalog changed');
});
it('requires every requested product even without a generation change', () => {
  expect(catalogOperationGuard(1, () => 1, [1, 2], id => id === 1)).toThrow('catalog changed');
});
