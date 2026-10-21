import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewsletterPopup } from '../NewsletterPopup';
const subscribe = vi.hoisted(() => vi.fn());
vi.mock('../../contexts/NewsletterContext', () => ({ useNewsletter: () => ({ addSubscriber: subscribe }) }));
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  subscribe.mockReset();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
async function openPopup() {
  render(<NewsletterPopup />);
  await act(async () => { vi.advanceTimersByTime(10000); });
}
describe('Newsletter popup', () => {
  it('opens a modal, locks background scrolling, and restores it on Escape dismissal', async () => {
    await openPopup();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
    expect(localStorage.getItem('lm_newsletter_dismissed')).toBe('true');
  });
  it('recovers from a rejected signup and permits retry', async () => {
    subscribe.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(true);
    await openPopup();
    fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), { target: { value: 'reader@example.com' } });
    await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Join the List' }).closest('form')!); });
    expect(screen.getByRole('alert')).toHaveTextContent('Please try again');
    expect(screen.getByRole('button', { name: 'Join the List' })).toBeEnabled();
    await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Join the List' }).closest('form')!); });
    expect(screen.getByText("You're In.")).toBeInTheDocument();
  });
  it('shows duplicate feedback inline without claiming a new signup', async () => {
    subscribe.mockResolvedValue(false);
    await openPopup();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'reader@example.com' } });
    await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Join the List' }).closest('form')!); });
    expect(screen.getByRole('alert')).toHaveTextContent('already on the list');
  });
});
