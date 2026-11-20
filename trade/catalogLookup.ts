import type { HolmProduct } from './catalog';

/** Display-only placeholder. Never insert this into the purchasable catalog map. */
export function displayProduct(products: ReadonlyMap<number, HolmProduct>, id: number): HolmProduct {
  return products.get(id) ?? {
    id, lid: '', vid: '', variants: [], name: 'Unavailable item',
    line: `Saved item ${id} needs review`, full: `Unavailable saved item ${id}`,
    type: 'unavailable', mat: '', tone: '#E7DFD0', price: Number.NaN,
    trade: null, seats: 0, oos: true, note: 'This saved product is not currently available. Replace it or remove it.',
    facts: '', img: '/trade/unavailable.svg', imgs: [], ar: 1, sku: '', likes: 0,
    widthCm: null, dimsCm: null, dimsSource: null, cutout: null, cutAR: null,
    model: null, modelLow: null, hangs: false, mountCm: null, minimum: 1, increment: 1,
  };
}
