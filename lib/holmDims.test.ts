import { describe, expect, it } from 'vitest';
import { parseDims } from './holmDims';

describe('parseDims', () => {
  it('reads W × D × H in inches and converts to centimetres', () => {
    expect(parseDims('Overall dimensions (W × D × H): 92.5 × 39 × 26.4 in')).toEqual({ w: 235, d: 99.1, h: 67.1 });
  });

  it('reads centimetres as they are', () => {
    expect(parseDims('Overall dimensions (W x D x H): 220 x 95 x 80 cm')).toEqual({ w: 220, d: 95, h: 80 });
  });

  it('follows the order the label gives', () => {
    expect(parseDims('Size (W × H × D): 100 × 75 × 50 cm')).toEqual({ w: 100, d: 50, h: 75 });
  });

  it('reads numbers tagged with their axis', () => {
    expect(parseDims('84" W x 38" D x 33" H')).toEqual({ w: 213.4, d: 96.5, h: 83.8 });
  });

  it('adds seat and arm heights when listed', () => {
    expect(parseDims('Overall dimensions (W × D × H): 84 × 38 × 33 in\nSeat height: 18 in\nArm height: 24 in')).toEqual({
      w: 213.4,
      d: 96.5,
      h: 83.8,
      seatH: 45.7,
      armH: 61,
    });
  });

  it('gives nothing when a dimension is missing', () => {
    expect(parseDims('Width 80 cm')).toBeNull();
    expect(parseDims('Overall dimensions: 220 x 95 x 80')).toBeNull();
    expect(parseDims('Made to order.')).toBeNull();
    expect(parseDims('')).toBeNull();
    expect(parseDims(undefined)).toBeNull();
  });
});
