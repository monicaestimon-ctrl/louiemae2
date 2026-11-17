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
