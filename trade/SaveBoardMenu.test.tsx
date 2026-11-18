import { fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HolmProduct } from './catalog';
import { SaveBoardMenu } from './SaveBoardMenu';

vi.mock('./useSavedBoardShelf', () => ({ useSavedBoardShelf: () => ({ productFor: () => null }) }));
const selected = { id: 42, lid: 'selected-source', vid: 'walnut', name: 'Chair' } as HolmProduct;
const boards = [
  { id: 'b1', title: 'Living room', pins: [{ pid: 42, lid: 'selected-source', vid: 'oak' }] },
  { id: 'b2', title: 'Secret project', secret: true, pins: [] },
];
let opener: HTMLButtonElement;
beforeEach(() => {
  opener = document.createElement('button');
  opener.textContent = 'Open picker';
  document.body.append(opener);
  opener.focus();
});
afterEach(() => opener.remove());
function setup(options: Partial<Parameters<typeof SaveBoardMenu>[0]> = {}) {
  const props = {
    boards,
    catalog: new Map<number, HolmProduct>(),
    product: selected,
    onSave: vi.fn(),
    onCreate: vi.fn((): string | null => 'new-board'),
    onClose: vi.fn(),
    ...options,
  };
  const view = render(<SaveBoardMenu {...props} />);
  return { ...view, ...props };
}
describe('typed board picker', () => {
  it('focuses search and saves the exact selected source and variant', () => {
    const props = setup();
    expect(screen.getByRole('textbox', { name: 'Search your boards' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: /Living room/ }));
    expect(props.onSave).toHaveBeenCalledExactlyOnceWith(selected, 'b1');
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
    expect(boards[0].pins[0].vid).toBe('oak');
  });
  it('filters boards without losing saved references', () => {
    setup();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'SECRET' } });
    expect(screen.queryByRole('button', { name: /Living room/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Secret project/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'absent' } });
    expect(screen.getByRole('status')).toHaveTextContent('No boards match');
    expect(screen.getByRole('button', { name: 'Create board' })).toBeEnabled();
  });
  it('announces empty boards and keeps creation available', () => {
    setup({ boards: [] });
    expect(screen.getByRole('status')).toHaveTextContent('Create a board');
  });
  it('creates with trimmed name and the selected variant', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Create board' }));
    expect(screen.getByRole('textbox', { name: 'Board name' })).toHaveFocus();
    fireEvent.change(screen.getByRole('textbox', { name: 'Board name' }), {
      target: { value: '  Kitchen  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create and save' }));
    expect(props.onCreate).toHaveBeenCalledExactlyOnceWith('Kitchen', selected);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
  });
  it('keeps validation failures open and exposes an associated message', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Create board' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create and save' }));
    expect(props.onCreate).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    const input = screen.getByRole('textbox', { name: 'Board name' });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-describedby', screen.getByRole('alert').id);
    fireEvent.change(input, { target: { value: 'Valid' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('does not close when creation authority rejects the product', () => {
    const props = setup({ onCreate: vi.fn(() => null) });
    fireEvent.click(screen.getByRole('button', { name: 'Create board' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Board name' }), {
      target: { value: 'Kitchen' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create and save' }));
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('needs review');
  });
  it('returns from create to the existing search without saving', () => {
    const props = setup();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Living' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create board' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('textbox', { name: 'Search your boards' })).toHaveValue('Living');
    expect(screen.getByRole('textbox')).toHaveFocus();
    expect(props.onCreate).not.toHaveBeenCalled();
  });
  it('closes once on Escape and restores the trigger', () => {
    const props = setup();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
  });
  it('dismisses on outside pointer without stealing destination focus', () => {
    const props = setup();
    fireEvent.pointerDown(opener);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox')).toHaveFocus();
  });
  it('dismisses on focus leaving without a focus trap', () => {
    const props = setup();
    opener.focus();
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
  });
  it('removes document listeners when unmounted', () => {
    const props = setup();
    props.unmount();
    fireEvent.pointerDown(opener);
    opener.focus();
    expect(props.onClose).not.toHaveBeenCalled();
  });
  it('preserves the opener through StrictMode effect replay', () => {
    const close = vi.fn();
    render(
      <StrictMode>
        <SaveBoardMenu
          boards={boards}
          catalog={new Map()}
          product={selected}
          onSave={vi.fn()}
          onCreate={() => 'new'}
          onClose={close}
        />
      </StrictMode>
    );
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
  });
  it('returns to the explicit trigger after click-only activation', () => {
    opener.blur();
    const props = setup({ returnFocus: opener });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
  });
});
