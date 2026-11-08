import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
}));
vi.mock('convex/react', () => ({
  useMutation: () => vi.fn(),
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
            status: 'proposed',
            kind: 'serviceLevel',
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
