/* global Storage, DOMException */
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewsletterPopup } from '../NewsletterPopup';
const subscribe = vi.hoisted(() => vi.fn());
vi.mock('../../contexts/NewsletterContext', () => ({ useNewsletter: () => ({ addSubscriber: subscribe }) }));
beforeAll(async () => { await import('../NewsletterPopupContent'); });
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  subscribe.mockReset();
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function openPopup() {
  render(<NewsletterPopup />);
  await act(async () => { vi.advanceTimersByTime(10000); });
}
describe('Newsletter popup', () => {
  it('waits for an existing dialog instead of interrupting the shopper', async () => {
    const existing = document.createElement('dialog'); existing.open = true; document.body.append(existing);
    render(<NewsletterPopup />);
    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(screen.queryByLabelText('The Mae Letter newsletter')).toBeNull();
    await act(async () => { existing.remove(); });
    expect(screen.getByLabelText('The Mae Letter newsletter')).toBeInTheDocument();
    existing.remove();
  });
  it('also resumes after a mounted native dialog closes', async () => {
    const existing = document.createElement('dialog'); existing.open = true; document.body.append(existing);
    render(<NewsletterPopup />);
    await act(async () => { vi.advanceTimersByTime(10000); });
    existing.open = false;
    fireEvent(existing, new Event('close'));
    expect(screen.getByLabelText('The Mae Letter newsletter')).toBeInTheDocument();
    existing.remove();
  });
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

it('does not interrupt a nested concierge dialog and resumes after it closes', async () => {
  const wrapper = document.createElement('section');
  const chat = document.createElement('div'); chat.setAttribute('role', 'dialog'); wrapper.append(chat); document.body.append(wrapper);
  render(<NewsletterPopup />);
  await act(async () => { vi.advanceTimersByTime(10000); });
  expect(screen.queryByLabelText('The Mae Letter newsletter')).toBeNull();
  await act(async () => { chat.remove(); });
  expect(screen.getByLabelText('The Mae Letter newsletter')).toBeInTheDocument();
  wrapper.remove();
});
it('survives denied storage and dismisses for the mounted visit', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
  await openPopup();
  fireEvent.click(screen.getByRole('button', { name: 'Close newsletter popup' }));
  await act(async () => { vi.advanceTimersByTime(30000); });
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('does not turn a successful subscription into an error when storage writes fail', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
  subscribe.mockResolvedValue(true);
  await openPopup();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'reader@example.com' } });
  await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Join the List' }).closest('form')!); });
  expect(screen.getByText("You're In.")).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});
