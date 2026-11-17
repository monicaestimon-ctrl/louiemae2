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
