import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import CommerceV2Admin from './CommerceV2Admin';
const mock = vi.hoisted(() => ({
  permissions: {
    owner: false,
    support: true,
    operations: false,
    finance: false,
    approver: false,
    engineering: false,
  },
  reads: vi.fn(),
  release: vi.fn(),
  fixtureStatus: 'proposed',
}));
vi.mock('convex/react', () => ({
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => getFunctionName(ref) === 'sysConfig:approveDeliveryRelease' ? mock.release : vi.fn(),
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(ref);
    mock.reads(name, args);
    if (args === 'skip') return undefined;
    if (name === 'dlvAccess:permissions') return mock.permissions;
    if (name === 'sysConfig:list')
      return {
        flags: {},
        records: [
          {
            _id: 'fixture',
            status: mock.fixtureStatus,
            kind: 'deliveryLadder',
            key: 'fixture',
            version: 1,
            value: {},
          },
        ],
      };
    if (name === 'dlvAccess:integrations')
      return {
        flags: { delivery: false },
        gatewayConfigured: true,
        taxProviderConfigured: false,
        notificationProviderConfigured: false,
      };
    return [];
  },
}));
vi.mock('./DeliveryOperations', () => ({ default: () => <p>Scoped delivery workspace</p> }));
beforeEach(() => {
  mock.reads.mockClear();
  mock.release.mockReset();
  mock.fixtureStatus = 'proposed';
  Object.assign(mock.permissions, {
    owner: false,
    support: true,
    operations: false,
    finance: false,
    approver: false,
    engineering: false,
  });
});
afterEach(cleanup);
describe('staff console navigation', () => {
  it('shows only support delivery access and never mounts private owner sections', () => {
    render(<CommerceV2Admin />);
    expect(screen.getByRole('button', { name: 'Delivery & freight' })).toBeInTheDocument();
    for (const name of [
      'Decisions & flags',
      'Dealer orders',
      'Health & alerts',
      'Catalog & import',
      'Partners & payouts',
    ])
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    expect(mock.reads.mock.calls.map(([name]) => name)).toEqual(['dlvAccess:permissions']);
  });
  it('allows operations to propose but not approve, and hides financial exception reads', () => {
    mock.permissions.operations = true;
    render(<CommerceV2Admin />);
    fireEvent.click(screen.getByRole('button', { name: 'Decisions & flags' }));
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Dealer orders' }));
    expect(
      mock.reads.mock.calls
        .filter(([name]) => name === 'v2Admin:paidExceptions')
        .every(([, args]) => args === 'skip')
    ).toBe(true);
    expect(screen.queryByText(/Paid orders needing resolution/)).not.toBeInTheDocument();
  });
  it('submits only explicitly selected delivery settings and preserves selection after failure', async () => {
    Object.assign(mock.permissions, { operations: true, approver: true });
    mock.release.mockRejectedValueOnce(new Error('Refresh required')).mockResolvedValueOnce({ approved: 1 });
    render(<CommerceV2Admin />);
    fireEvent.click(screen.getByRole('button', { name: 'Decisions & flags' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include fixture v1 in delivery release' }));
    fireEvent.change(screen.getByLabelText('Delivery release note'), { target: { value: 'Approved delivery model' } });
    fireEvent.click(screen.getByRole('button', { name: /Approve selected delivery release/ }));
    await waitFor(() => expect(mock.release).toHaveBeenCalledWith({ ids: ['fixture'], note: 'Approved delivery model' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Approve selected delivery release/ })).toBeEnabled());
    expect(screen.getByRole('checkbox')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /Approve selected delivery release/ }));
    await screen.findByText('Released 1 delivery settings together');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
  it('removes a selected proposal when another decision makes it ineligible', async () => {
    Object.assign(mock.permissions, { operations: true, approver: true });
    const view = render(<CommerceV2Admin />);
    fireEvent.click(screen.getByRole('button', { name: 'Decisions & flags' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include fixture v1 in delivery release' }));
    mock.fixtureStatus = 'approved';
    view.rerender(<CommerceV2Admin />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve selected delivery release (0)' })).toBeDisabled());
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(mock.release).not.toHaveBeenCalled();
  });
  it('switches safely when roles change and gives engineers only integration readiness', () => {
    const view = render(<CommerceV2Admin />);
    Object.assign(mock.permissions, { support: false, engineering: true });
    view.rerender(<CommerceV2Admin />);
    expect(screen.getByRole('button', { name: 'Integration readiness' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delivery & freight' })).not.toBeInTheDocument();
    expect(screen.getByText('Request gateway: Configured')).toBeInTheDocument();
    Object.assign(mock.permissions, { engineering: false });
    view.rerender(<CommerceV2Admin />);
    expect(screen.getByRole('alert')).toHaveTextContent('No staff permissions');
  });
});
