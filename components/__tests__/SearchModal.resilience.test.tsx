import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SearchModal } from '../SearchModal';
const state = vi.hoisted(() => ({ result: undefined as unknown }));
vi.mock('convex/react', () => ({ useQueries: () => ({ result: state.result }) }));
beforeEach(() => { state.result = undefined; vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('keeps the shell and search text through failure and recovers without showing false empty results', () => {
  const close = vi.fn();
  const tree = () => <><header>Shopping navigation</header><SearchModal isOpen onClose={close} onProductClick={vi.fn()} /></>;
  const view = render(tree());
  const input = screen.getByRole('textbox', { name: 'Search products' });
  fireEvent.change(input, { target: { value: 'chair' } });
  state.result = new Error('private backend error');
  act(() => vi.advanceTimersByTime(250));
  expect(screen.getByRole('status')).toHaveTextContent('Search is temporarily unavailable');
  expect(screen.getByText('Shopping navigation')).toBeTruthy();
  expect(input).toHaveValue('chair');
  expect(screen.queryByText(/No products found/)).toBeNull();
  expect(screen.queryByText('private backend error')).toBeNull();
  state.result = []; view.rerender(tree());
  expect(screen.getByText(/No products found/)).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
});

it('gives each changed search its own timeout and allows a manual retry', () => {
  render(<SearchModal isOpen onClose={vi.fn()} onProductClick={vi.fn()} />);
  const input = screen.getByRole('textbox', { name: 'Search products' });
  fireEvent.change(input, { target: { value: 'chair' } });
  act(() => vi.advanceTimersByTime(250));
  act(() => vi.advanceTimersByTime(9_000));
  fireEvent.change(input, { target: { value: 'sofa' } });
  act(() => vi.advanceTimersByTime(250));
  act(() => vi.advanceTimersByTime(1_000));
  expect(screen.getByText('Searching...')).toBeTruthy();
  act(() => vi.advanceTimersByTime(9_000));
  expect(screen.getByRole('status')).toHaveTextContent('Search is temporarily unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(input).toHaveValue('sofa');
  expect(screen.getByText('Searching...')).toBeTruthy();
});
