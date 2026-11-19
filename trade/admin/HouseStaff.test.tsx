import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { getFunctionName, type FunctionReference } from 'convex/server';
import type { StaffProps } from './types';
const state = vi.hoisted(() => ({
  status: 'loading' as 'loading' | 'ready' | 'unavailable',
  rows: [] as unknown[],
  data: {} as Record<string, unknown>,
  query: vi.fn(),
  retry: vi.fn(),
  mutation: vi.fn(),
  cutout: vi.fn(),
}));
vi.mock('../../contexts/useRecoverableQuery', () => ({
  useRecoverableQuery: (...args: unknown[]) => {
    state.query(...args);
    return {
      status: state.status,
      data:
        state.status === 'ready'
          ? (state.data[getFunctionName(args[0] as FunctionReference<'query'>)] ?? state.rows)
          : undefined,
      retry: state.retry,
    };
  },
}));
vi.mock('convex/react', () => ({ useMutation: () => state.mutation }));
vi.mock('./media', async (original) => ({
  ...(await original<typeof import('./media')>()),
  cutoutFromPhoto: state.cutout,
}));
import { HouseStaffGate } from './HouseStaffGate';
import HouseStaff from './HouseStaff';
const props: StaffProps = { admin: false, toast: vi.fn(), Turntable: () => null };
const ctx = { me: { admin: true }, toast: props.toast, Turntable: props.Turntable };
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.status = 'loading';
  state.rows = [];
  state.data = {};
  state.mutation.mockReset();
});

it('does not subscribe for unauthorized visitors and unmounts subscriptions on role loss', async () => {
  const view = render(<HouseStaffGate {...props} />);
  expect(screen.getByRole('heading', { name: 'Team only' })).toBeTruthy();
  expect(state.query).not.toHaveBeenCalled();
  await act(async () => {
    view.rerender(<HouseStaffGate {...props} admin />);
  });
  expect(await screen.findByText('Loading staff information…')).toBeTruthy();
  expect(state.query).toHaveBeenCalled();
  state.query.mockClear();
  view.rerender(<HouseStaffGate {...props} />);
  expect(screen.getByRole('heading', { name: 'Team only' })).toBeTruthy();
  expect(state.query).not.toHaveBeenCalled();
  expect(screen.queryByRole('status')).toBeNull();
  expect(state.mutation).not.toHaveBeenCalled();
});

it('keeps staff navigation available during a subscription failure and retries explicitly', () => {
  state.status = 'unavailable';
  const view = render(<HouseStaff ctx={ctx} />);
  expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(state.retry).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Asset readiness' }));
  expect(screen.getByRole('alert')).toBeTruthy();
  state.status = 'ready';
  view.rerender(<HouseStaff ctx={ctx} />);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('With dimensions')).toBeTruthy();
  expect(state.mutation).not.toHaveBeenCalled();
});

it('preserves application notes across a data outage without submitting them', () => {
  state.status = 'ready';
  state.rows = [
    {
      _id: 'application-1',
      businessName: 'Test Studio',
      submittedAt: 1,
      businessType: 'interior_designer',
      status: 'pending',
      user: null,
    },
  ];
  const view = render(<HouseStaff ctx={ctx} />);
  const notes = screen.getByPlaceholderText(/Note to the applicant/i);
  fireEvent.input(notes, { target: { value: 'Verify certificate' } });
  state.status = 'unavailable';
  view.rerender(<HouseStaff ctx={ctx} />);
  expect(screen.getByRole('alert')).toBeTruthy();
  state.status = 'ready';
  view.rerender(<HouseStaff ctx={ctx} />);
  expect(screen.getByPlaceholderText(/Note to the applicant/i)).toHaveValue('Verify certificate');
  expect(state.mutation).not.toHaveBeenCalled();
});

it('discards an asynchronous cutout if staff switches products before it completes', async () => {
  state.status = 'ready';
  state.rows = ['first', 'second'].map((productId) => ({
    productId,
    name: productId,
    image: '/photo.png',
    dimsCm: null,
  }));
  let finish!: (value: { blob: Blob; url: string; aspect: number }) => void;
  state.cutout.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  render(<HouseStaff ctx={ctx} />);
  fireEvent.click(screen.getByRole('button', { name: 'Asset readiness' }));
  fireEvent.click(screen.getByRole('button', { name: 'first' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove the background' }));
  fireEvent.click(screen.getByRole('button', { name: 'second' }));
  await act(async () => finish({ blob: new Blob(), url: 'data:image/png;base64,AA==', aspect: 1 }));
  expect(screen.queryByAltText('Cutout preview')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Approve cutout' })).toBeNull();
  expect(state.mutation).not.toHaveBeenCalled();
});

it('preserves partner child drafts during recovery and blocks duplicate adjustment submissions', async () => {
  state.status = 'ready';
  state.data['holmPartners:adminPartners'] = [
    {
      userId: 'partner',
      name: 'Studio',
      tier: 'base',
      w9Status: 'none',
      payouts: { ready: false },
      unpaidCents: 0,
      clearedCents: 0,
    },
  ];
  state.data['holmAdmin:ledger'] = { rows: [], payouts: [] };
  const view = render(<HouseStaff ctx={ctx} />);
  fireEvent.click(screen.getByRole('button', { name: 'Partners' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open ledger and adjustments' }));
  fireEvent.input(screen.getByLabelText('Adjustment note'), {
    target: { value: 'Keep this note' },
  });
  fireEvent.input(screen.getByLabelText('Adjustment amount in dollars, negative to deduct'), {
    target: { value: '1' },
  });
  state.status = 'unavailable';
  view.rerender(<HouseStaff ctx={ctx} />);
  expect(screen.queryByRole('button', { name: 'Add adjustment' })).toBeNull();
  state.status = 'ready';
  view.rerender(<HouseStaff ctx={ctx} />);
  expect(screen.getByLabelText('Adjustment note')).toHaveValue('Keep this note');
  let reject!: (error: Error) => void;
  state.mutation.mockReturnValue(
    new Promise((_, r) => {
      reject = r;
    })
  );
  const button = screen.getByRole('button', { name: 'Add adjustment' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(state.mutation).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
  await act(async () => reject(Error('Isolated fixture failure')));
  expect(screen.getByLabelText('Adjustment note')).toHaveValue('Keep this note');
  expect(button).not.toBeDisabled();
});

it('clears a dimension override draft only after a successful reset', async () => {
  state.status = 'ready';
  state.rows = [
    {
      productId: 'chair',
      name: 'Chair',
      image: '/photo.png',
      dimsCm: { w: 50, d: 60, h: 70 },
      dimsSource: 'manual',
    },
  ];
  render(<HouseStaff ctx={ctx} />);
  fireEvent.click(screen.getByRole('button', { name: 'Asset readiness' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chair' }));
  fireEvent.input(screen.getByLabelText('Width (cm)'), { target: { value: '99' } });
  state.mutation.mockRejectedValueOnce(Error('failed'));
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: "Use the listing's dimensions" }))
  );
  expect(screen.getByLabelText('Width (cm)')).toHaveValue(99);
  state.mutation.mockResolvedValueOnce(null);
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: "Use the listing's dimensions" }))
  );
  expect(screen.getByLabelText('Width (cm)')).toHaveValue(50);
});

it('preserves newer sourcing edits on both the saved request and a different request', async () => {
  state.status = 'ready';
  state.rows = ['a', 'b'].map((_id) => ({
    _id,
    title: _id,
    status: 'received',
    options: [],
    imageUrls: [],
  }));
  render(<HouseStaff ctx={ctx} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }));
  const notes = screen.getAllByPlaceholderText(
    'Note to the requester (emailed when the status changes)'
  );
  fireEvent.input(notes[0], { target: { value: 'Submitted note' } });
  let finish!: () => void;
  state.mutation.mockReturnValue(
    new Promise<void>((r) => {
      finish = r;
    })
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
  fireEvent.input(notes[0], { target: { value: 'Newer note' } });
  fireEvent.input(notes[1], { target: { value: 'Other request note' } });
  await act(async () => finish());
  expect(notes[0]).toHaveValue('Newer note');
  expect(notes[1]).toHaveValue('Other request note');
  expect(screen.getAllByLabelText('Request status')).toHaveLength(2);
});
