/* global Storage, DOMException */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AiConcierge } from '../AiConcierge';
const mocks = vi.hoisted(() => ({ action: vi.fn(), hook: vi.fn() }));
vi.mock('convex/react', () => ({
  useAction: () => {
    mocks.hook();
    return mocks.action;
  },
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  document.querySelectorAll('meta[name=robots]').forEach((node) => node.remove());
});
it('defers action setup, survives denied storage, keeps drafts and restores focus after Escape', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('Blocked', 'SecurityError');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Full', 'QuotaExceededError');
  });
  render(<AiConcierge />);
  expect(mocks.hook).not.toHaveBeenCalled();
  expect(document.querySelector('meta[name=robots]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Ask the Louie Mae concierge' }));
  const input = await screen.findByRole('textbox', { name: 'Ask the concierge' });
  // Opening resolves a lazy panel; focus is assigned by its effect after commit.
  await waitFor(() => expect(input).toHaveFocus());
  expect(input).toHaveAttribute('maxlength', '800');
  expect(document.querySelector('meta[name=robots]')?.getAttribute('content')).toContain('noindex');
  fireEvent.change(input, { target: { value: 'Preserved question' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: 'Ask the Louie Mae concierge' })).toHaveFocus();
  expect(document.querySelector('meta[name=robots]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Ask the Louie Mae concierge' }));
  expect(await screen.findByRole('textbox')).toHaveValue('Preserved question');
  expect(mocks.action).not.toHaveBeenCalled();
});
it('announces a synthetic reply and preserves the conversation across close/reopen', async () => {
  let finish!: (value: string) => void;
  mocks.action.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      })
  );
  render(<AiConcierge />);
  fireEvent.click(screen.getByRole('button', { name: 'Ask the Louie Mae concierge' }));
  const input = await screen.findByRole('textbox');
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  fireEvent.change(input, { target: { value: 'Synthetic question' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(mocks.action).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  await act(async () => finish('Synthetic response'));
  expect(screen.getByRole('log', { name: 'Conversation' })).toHaveAttribute('aria-live', 'polite');
  expect(screen.getByText('Synthetic response')).toBeInTheDocument();
  fireEvent.keyDown(input, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Ask the Louie Mae concierge' }));
  expect(screen.getByText('Synthetic response')).toBeInTheDocument();
});
it('keeps expected service failures within the conversation', async () => {
  mocks.action.mockRejectedValue(new Error('Synthetic unavailable'));
  render(<AiConcierge />);
  fireEvent.click(screen.getByRole('button', { name: 'Ask the Louie Mae concierge' }));
  const input = await screen.findByRole('textbox');
  fireEvent.change(input, { target: { value: 'Synthetic failure' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() =>
    expect(screen.getByText(/could not load a response/)).toBeInTheDocument()
  );
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('Synthetic failure');
});

it('preserves a newer draft when an earlier question fails', async () => {
  let reject!: (error: Error) => void;
  mocks.action.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  render(<AiConcierge />);fireEvent.click(screen.getByRole('button', {name:'Ask the Louie Mae concierge'}));
  const input = await screen.findByRole('textbox');
  fireEvent.change(input,{target:{value:'First question'}});fireEvent.click(screen.getByRole('button',{name:'Send'}));
  fireEvent.change(input,{target:{value:'New draft'}});
  await act(async()=>reject(new Error('Synthetic unavailable')));
  expect(input).toHaveValue('New draft');
});
