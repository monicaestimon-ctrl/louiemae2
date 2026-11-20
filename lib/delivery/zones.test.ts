import { describe, expect, it } from 'vitest';
import { deliveryZone, deliveryLanes } from './zones';
describe('source-bound delivery zones', () => {
  const config = { zip3Zones: { '941': 'broad' }, modeledZip5Zones: { '94103': 'sample' } };
  it('uses exact ZIP coverage for modeled lanes without widening to the prefix', () => {
    expect(deliveryZone(config, ' 94103-1234 ')).toBe('sample');
    expect(deliveryZone(config, '94104')).toBeUndefined();
    expect(deliveryZone({ ...config, modeledZip5Zones: {} }, '94103')).toBeUndefined();
  });
  it('preserves legacy prefix lanes and reports exact scope to operators', () => {
    expect(deliveryZone({ zip3Zones: config.zip3Zones }, '94104')).toBe('broad');
    expect(deliveryLanes(config)).toEqual([{ prefix: '94103', zone: 'sample', match: 'exact_zip', controlPrefix: '941' }]);
    expect(deliveryLanes({ zip3Zones: config.zip3Zones })).toEqual([{ prefix: '941', zone: 'broad', match: 'zip_prefix', controlPrefix: '941' }]);
    expect(deliveryLanes(null)).toEqual([]);
    expect(deliveryZone(undefined, '94103')).toBeUndefined();
  });
});
