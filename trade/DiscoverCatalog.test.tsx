import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DiscoverCatalog } from './DiscoverCatalog';
import { displayProduct } from './catalogLookup';
const products = [
  { ...displayProduct(new Map(), 1), name: 'Sofa', line: 'Leather', type: 'sofa', mat: 'leather', tone: '#A0612F', price: 900, oos: false },
  { ...displayProduct(new Map(), 2), name: 'Lamp', line: 'Brass', type: 'lighting', mat: 'brass', tone: '#B58D52', price: 200, oos: true },
];
function setup(items = products, pricing: 'retail' | 'trade' = 'retail') {
  const onQuery = vi.fn();
  render(<DiscoverCatalog products={items} pricing={pricing} query="" imageQuery={null} types={{ sofa: 'Sofas', lighting: 'Lighting' }} materials={{ leather: 'Leather', brass: 'Brass' }} trends={[]} matchQuery={() => []} onQuery={onQuery} onClearImage={() => {}} onImage={() => {}} onTrend={() => {}} onSourcing={() => {}} renderProducts={items => <ul aria-label="Results">{items.map(item => <li key={item.id}>{item.name}</li>)}</ul>} />);
  return { onQuery };
}
afterEach(cleanup);
it('limits the combined swatch and photo selection to eight and explains how to change it', () => {
  render(<DiscoverCatalog products={products} query="" imageQuery={{ src: 'photo', pal: ['#123456'] }} types={{}} materials={{}} trends={[]} matchQuery={() => []} onQuery={() => {}} onClearImage={() => {}} onImage={() => {}} onTrend={() => {}} onSourcing={() => {}} renderProducts={() => null} />);
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  for (const name of ['Cognac', 'Tan', 'Espresso', 'Olive', 'Ivory', 'Stone', 'Black', 'Brass']) fireEvent.click(screen.getByRole('button', { name }));
  expect(screen.getByRole('button', { name: 'Filter by #123456' })).toBeDisabled();
  expect(screen.getByText('Up to eight tones can be selected. Remove a tone to choose another.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cognac' }));
  expect(screen.getByRole('button', { name: 'Filter by #123456' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Filter by #123456' }));
  expect(screen.getByRole('button', { name: 'Cognac' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Filter by #123456' })).toHaveAttribute('aria-pressed', 'true');
});
it('ranks text matches within a photo search and removes obsolete photo tones', () => {
  const props = { products, query: '', imageQuery: { src: 'photo', pal: ['#123456'] } as { src: string; pal: string[] } | null,
    types: {}, materials: {}, trends: [], matchQuery: () => [], onQuery: vi.fn(), onClearImage: vi.fn(), onImage: vi.fn(), onTrend: vi.fn(), onSourcing: vi.fn(),
    renderProducts: (items: typeof products) => <ul aria-label="Results">{items.map(item => <li key={item.id}>{item.name}</li>)}</ul> };
  const view = render(<DiscoverCatalog {...props} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'sofa' } });
  expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Sofa']);
  fireEvent.click(screen.getByRole('button', { name: 'Filter by #123456' }));
  expect(screen.queryByRole('listitem')).toBeNull();
  view.rerender(<DiscoverCatalog {...props} imageQuery={null} />);
  expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Sofa']);
});
it('combines type/material/stock filters and exposes their selected states', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Lighting' }));
  expect(screen.getByRole('button', { name: 'Lighting' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('list', { name: 'Results' })).toHaveTextContent('Lamp');
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  fireEvent.click(screen.getByRole('button', { name: 'In stock' }));
  expect(screen.queryByRole('list')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
});
it('sorts by price and keeps a typed search until explicit submission', () => {
  const { onQuery } = setup();
  fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'lo' } });
  expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Lamp', 'Sofa']);
  fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'leather' } });
  expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Sofa']);
  expect(onQuery).not.toHaveBeenCalled();
  fireEvent.submit(screen.getByRole('textbox', { name: 'Search' }).closest('form')!);
  expect(onQuery).toHaveBeenCalledWith('leather');
});
it('does not hide products over the old default price cap and clears an explicit cap', () => {
  setup([{ ...products[0], price: 5000 }, products[1]]);
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  expect(screen.getByRole('slider')).toHaveAttribute('max', '5000');
  expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', 'Any price');
  fireEvent.change(screen.getByRole('slider'), { target: { value: '1000' } });
  expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Lamp']);
  fireEvent.change(screen.getByRole('slider'), { target: { value: '5000' } });
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
});
it('sorts and filters by the approved price displayed in trade mode', () => {
  setup([{ ...products[0], trade: 150 }, { ...products[1], trade: 180 }], 'trade');
  fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'lo' } });
  expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Sofa', 'Lamp']);
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  fireEvent.change(screen.getByRole('slider'), { target: { value: '150' } });
  expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Sofa']);
});

it('keeps unavailable comparisons visible without treating them as zero in price sorting', () => {
  setup([{ ...products[0], price: Number.NaN }, products[1]]);
  for (const value of ['lo', 'hi']) {
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value } });
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Lamp', 'Sofa']);
  }
});

it('keeps unspecified pieces browsable without matching a known material or color', () => {
  setup([{ ...products[0], name: 'Quill', type: 'other', mat: 'unknown', tone: '' }, products[1]]);
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  fireEvent.click(screen.getByRole('button', { name: 'Leather' }));
  expect(screen.queryByRole('listitem')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Leather' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tan' }));
  // The existing distance threshold also admits this brass lamp. Unknown
  // colors must not match, even when another valid near-tone result exists.
  expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Lamp']);
  fireEvent.click(screen.getByRole('button', { name: 'Tan' }));
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
});
