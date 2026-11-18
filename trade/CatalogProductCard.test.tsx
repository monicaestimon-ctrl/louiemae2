import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { HolmProduct } from './catalog';
import { CatalogProductCard } from './CatalogProductCard';
const p = {
  id: 42,
  lid: 'source',
  vid: 'walnut',
  name: 'Chair',
  line: 'Walnut',
  price: 199,
  trade: 179.1,
  img: '/chair.png',
  ar: 1,
} as HolmProduct;
const identity = { pid: p.id, lid: p.lid, vid: p.vid };
function setup(options: Partial<Parameters<typeof CatalogProductCard>[0]> = {}) {
  const props = {
    product: p,
    boards: [{ id: 'b1', title: 'Project', pins: [] }],
    mode: 'retail' as const,
    available: true,
    pinterestUrl: 'https://www.pinterest.com/pin/create/button/?fixture=true',
    icons: { down: null, pinterest: null, studio: null, add: null },
    onOpen: vi.fn(),
    onSave: vi.fn(),
    onStudio: vi.fn(),
    onAdd: vi.fn(),
    renderSaveMenu: (close: () => void) => (
      <div role="dialog" aria-label="Save to board">
        <button onClick={close}>Close picker</button>
      </div>
    ),
    ...options,
  };
  const view = render(<CatalogProductCard {...props} />);
  return { ...props, ...view };
}
describe('typed catalog product controls', () => {
  it('opens the exact source and variant only through its native detail button', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'View Chair Walnut' }));
    expect(props.onOpen).toHaveBeenCalledExactlyOnceWith(identity);
  });
  it('adds the selected variant and image independently of detail navigation', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add Chair to project tray' }));
    expect(props.onAdd).toHaveBeenCalledExactlyOnceWith(p, screen.getByRole('img'));
    expect(props.onOpen).not.toHaveBeenCalled();
  });
  it('places the selected variant in Studio without opening product detail', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Place Chair in Studio' }));
    expect(props.onStudio).toHaveBeenCalledExactlyOnceWith(identity);
    expect(props.onOpen).not.toHaveBeenCalled();
  });
  it('saves directly to the latest board only when this variant is not already saved', () => {
    const props = setup({
      boards: [{ id: 'b1', title: 'Project', pins: [{ ...identity, vid: 'oak' }] }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Chair to board' }));
    expect(props.onSave).toHaveBeenCalledExactlyOnceWith(p, 'b1');
  });
  it('opens the picker for an existing exact saved variant', () => {
    const props = setup({ boards: [{ id: 'b1', title: 'Project', pins: [identity] }] });
    fireEvent.click(screen.getByRole('button', { name: 'Saved Chair to board' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(props.onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Choose board for Chair' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close picker' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('opens the picker when no board exists', () => {
    const props = setup({ boards: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Save Chair to board' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(props.onSave).not.toHaveBeenCalled();
  });
  it('preserves the supplied approved-price mode', () => {
    const props = setup();
    expect(screen.getByText('$199')).toBeInTheDocument();
    props.rerender(<CatalogProductCard {...props} mode="trade" />);
    expect(screen.getByText('$179')).toBeInTheDocument();
  });
  it('retains unavailable saved records without actionable purchase or studio controls', () => {
    setup({ available: false });
    expect(screen.getByText(/Use Organize/)).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('link')).toBeNull();
  });
  it('preserves restock state and the supplied referral-aware Pinterest destination', () => {
    const props = setup({ product: { ...p, oos: true } });
    expect(screen.getByText('Restock on request')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Save Chair to Pinterest' })).toHaveAttribute(
      'href',
      props.pinterestUrl
    );
    expect(props.onOpen).not.toHaveBeenCalled();
  });
  it('closes a picker when its source is withdrawn and does not reopen it on recovery', () => {
    const props = setup({ boards: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Save Chair to board' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    props.rerender(<CatalogProductCard {...props} available={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    props.rerender(<CatalogProductCard {...props} available />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
