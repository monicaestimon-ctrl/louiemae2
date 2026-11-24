import { expect, it } from 'vitest';
import { decodeDiscoveryCursor, encodeDiscoveryCursor } from './holmDiscoveryCursor';
it('binds native continuation to the current request/viewer/version and color bucket', () => {
  const cursor = encodeDiscoveryCursor('current-request-viewer-version', 1, 'native');
  expect(decodeDiscoveryCursor(cursor, 'current-request-viewer-version', 3)).toMatchObject({ group: 1, cursor: 'native' });
  expect(() => decodeDiscoveryCursor(cursor, 'another-viewer', 3)).toThrow();
  expect(() => decodeDiscoveryCursor(cursor, 'current-request-viewer-version', 1)).toThrow();
  expect(decodeDiscoveryCursor(null, 'first', 1)).toMatchObject({ group: 0, cursor: null });
});
it('rejects malformed cursors and extra fields rather than trusting client pagination state', () => {
  for (const value of ['[]', '{}', 'bad', 'x'.repeat(16001), JSON.stringify({ version: 1, binding: 'b', group: -1, cursor: null }),
    JSON.stringify({ version: 1, binding: 'b', group: 0, cursor: null, trade: true })]) {
    expect(() => decodeDiscoveryCursor(value, 'b', 2)).toThrow();
  }
});
