import React, { StrictMode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AdminCatalogDemandContext, useAdminCatalog, useAdminCatalogDemand } from './AdminCatalogDemand';

afterEach(cleanup);

function Consumer({ enabled }: { enabled: boolean }) {
  useAdminCatalog(enabled);
  return null;
}

function Harness({ first = false, second = false, mounted = true }) {
  const { requested, register } = useAdminCatalogDemand();
  return <AdminCatalogDemandContext.Provider value={register}>
    <output>{requested ? 'admin' : 'public'}</output>
    {mounted && <Consumer enabled={first} />}
    <Consumer enabled={second} />
  </AdminCatalogDemandContext.Provider>;
}

describe('admin catalog subscription demand', () => {
  it('requests private catalog only while an active consumer needs it', () => {
    const view = render(<Harness />);
    expect(screen.getByRole('status')).toHaveTextContent('public');
    view.rerender(<Harness first />);
    expect(screen.getByRole('status')).toHaveTextContent('admin');
    view.rerender(<Harness first={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('public');
  });

  it('keeps another consumer subscribed when one navigates away', () => {
    const view = render(<Harness first second />);
    view.rerender(<Harness mounted={false} second />);
    expect(screen.getByRole('status')).toHaveTextContent('admin');
    view.rerender(<Harness mounted={false} second={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('public');
  });

  it('balances StrictMode setup and cleanup and restores demand on return', () => {
    const view = render(<StrictMode><Harness first /></StrictMode>);
    expect(screen.getByRole('status')).toHaveTextContent('admin');
    view.rerender(<StrictMode><Harness mounted={false} /></StrictMode>);
    expect(screen.getByRole('status')).toHaveTextContent('public');
    view.rerender(<StrictMode><Harness first /></StrictMode>);
    expect(screen.getByRole('status')).toHaveTextContent('admin');
  });
});
