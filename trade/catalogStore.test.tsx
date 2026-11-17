import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useState } from 'react';
import { products, productsById, setProducts, useCatalogRevision } from './catalogStore';
import { displayProduct } from './catalogLookup';

afterEach(() => { cleanup(); setProducts([]); });
it('re-renders catalog consumers without losing local project state and removes withdrawn products', () => {
  function Consumer() {
    useCatalogRevision();
    const [name, setName] = useState('');
    return <><input aria-label="Project" value={name} onChange={event => setName(event.target.value)} /><p>{products.map(product => product.name).join(',')}</p><output>{productsById.size}</output></>;
  }
  setProducts([{ ...displayProduct(new Map(), 1), name: 'First' }]);
  render(<Consumer />);
  fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'Keep me' } });
  act(() => setProducts([{ ...displayProduct(new Map(), 2), name: 'Second' }]));
  expect(screen.queryByText('First')).toBeNull();
  expect(screen.getByText('Second')).toBeTruthy();
  expect(productsById.has(1)).toBe(false);
  expect(screen.getByLabelText('Project')).toHaveValue('Keep me');
});

it('keeps verified curated references outside browse results and clears both on viewer teardown', () => {
  const first={...displayProduct(new Map(),31),lid:'browse',name:'First page'};
  const reference={...displayProduct(new Map(),1),lid:'curated',name:'Curated reference'};
  setProducts([first],[reference]);
  expect(products.map(p=>p.id)).toEqual([31]);
  expect(productsById.get(1)?.lid).toBe('curated');
  setProducts([first],[]);expect(productsById.has(1)).toBe(false);
  setProducts([first],[reference]);setProducts([]);expect(productsById.size).toBe(0);
});
