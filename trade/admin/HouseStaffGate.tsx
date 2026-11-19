import React from 'react';
import { deferredFeature } from '../deferredFeature';
import type { StaffProps } from './types';
const Staff = deferredFeature(() => import('./HouseStaff'), 'House staff tools');
export function HouseStaffGate({ admin, toast, Turntable }: StaffProps) {
  if (!admin)
    return (
      <main className="wrap">
        <div className="empty" style={{ padding: '80px 0' }}>
          <h1>Team only</h1>
          <p>Sign in with an admin account to manage House of Louie Mae.</p>
        </div>
      </main>
    );
  return <Staff ctx={{ me: { admin }, toast, Turntable }} />;
}
