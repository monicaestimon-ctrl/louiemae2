import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NewsletterPopup } from '../NewsletterPopup';
vi.mock('../NewsletterPopupContent', () => new Promise(() => {}));
vi.mock('../../contexts/NewsletterContext', () => ({
  useNewsletter: () => ({ addSubscriber: vi.fn() }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it('opens a dismissible loading dialog and bounds a hung form import without clearing the cart', async () => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem('louiemae_ashcroft_cart_v1', 'saved-cart-proof');
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<NewsletterPopup />);
  expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(10000);
  });
  expect(screen.getByRole('status')).toHaveTextContent('Opening the newsletter form');
  expect(screen.getByRole('button', { name: 'Close newsletter popup' })).toBeEnabled();
  await act(async () => {
    vi.advanceTimersByTime(10000);
  });
  expect(screen.getByRole('alert')).toHaveTextContent('newsletter form could not be loaded');
  expect(screen.getByRole('alert')).toHaveTextContent('page footer');
  fireEvent.click(screen.getByRole('button', { name: 'Close newsletter popup' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(localStorage.getItem('louiemae_ashcroft_cart_v1')).toBe('saved-cart-proof');
});
