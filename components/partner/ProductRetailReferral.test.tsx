import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ProductRetailReferral from './ProductRetailReferral';

const mocks = vi.hoisted(() => ({ query: vi.fn(), create: vi.fn(), copy: vi.fn(), retry: vi.fn() }));
vi.mock('convex/react', () => ({ useMutation: () => mocks.create }));
vi.mock('../../contexts/useRecoverableQuery', () => ({ useRecoverableQuery: (...args: unknown[]) => mocks.query(...args) }));
const eligible = { status: 'eligible', category: 'decor', applicableRateBps: 800, productName: 'Arden Lamp', destinationUrl: 'https://www.louiemae.com/products/lamp?variant=brass', exceptionNote: 'Décor schedule', disclosureExample: '#ad — I earn a commission if you buy through my link.' };
const props = { productId: 'lamp', variantId: 'brass', viewerKey: 'one', onAccount: vi.fn() };
beforeEach(() => {
  mocks.query.mockReturnValue({ status: 'ready', data: eligible, retry: mocks.retry });
  mocks.create.mockResolvedValue({ url: 'https://www.louiemae.com/r/example' });
  mocks.copy.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mocks.copy } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

it('shows the current rate and retail destination, and only creates a link on request', async () => {
  render(<ProductRetailReferral {...props} />);
  expect(screen.getByText(/8% of eligible merchandise paid/)).toBeTruthy();
  expect(screen.getByText('Décor, including lighting')).toBeTruthy();
  expect(screen.getByRole('link').getAttribute('href')).toBe(eligible.destinationUrl);
  expect(mocks.create).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy retail referral link' })));
  expect(mocks.create).toHaveBeenCalledWith({ productId: 'lamp', variantId: 'brass', channelTag: 'share' });
  expect(mocks.copy).toHaveBeenCalledWith('https://www.louiemae.com/r/example');
  expect(screen.getByRole('textbox').getAttribute('value')).toBe('https://www.louiemae.com/r/example');
});

it('offers manual copy when clipboard access fails', async () => {
  mocks.copy.mockRejectedValue(new Error('Denied'));
  render(<ProductRetailReferral {...props} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy retail referral link' })));
  expect(screen.getByText('Your link is ready. Select and copy it below.')).toBeTruthy();
  expect(screen.getByRole('textbox')).toBeTruthy();
});

it('discards late commands after the selected option or account changes', async () => {
  let resolve!: (value: { url: string }) => void;
  mocks.create.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = render(<ProductRetailReferral {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy retail referral link' }));
  view.rerender(<ProductRetailReferral {...props} variantId="silver" viewerKey="two" />);
  await act(async () => resolve({ url: 'https://www.louiemae.com/r/old' }));
  expect(mocks.copy).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('does not expose a link action for unavailable products or failed queries', () => {
  mocks.query.mockReturnValue({ status: 'ready', data: { status: 'unavailable', message: 'Not available' }, retry: mocks.retry });
  const view = render(<ProductRetailReferral {...props} />);
  expect(screen.queryByRole('button', { name: /Copy retail/ })).toBeNull();
  mocks.query.mockReturnValue({ status: 'unavailable', data: undefined, retry: mocks.retry });
  view.rerender(<ProductRetailReferral {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(mocks.retry).toHaveBeenCalledOnce();
});

it('refreshes time-dependent server eligibility without creating links', () => {
  vi.useFakeTimers();
  render(<ProductRetailReferral {...props} />);
  const token = mocks.query.mock.lastCall![1].refreshToken;
  act(() => vi.advanceTimersByTime(30_000));
  expect(mocks.query.mock.lastCall![1].refreshToken).toBeGreaterThan(token);
  expect(mocks.create).not.toHaveBeenCalled();
});
