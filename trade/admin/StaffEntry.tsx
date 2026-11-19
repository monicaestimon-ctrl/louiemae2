import { useLayoutEffect, useState } from 'react';
import { HouseStaffGate } from './HouseStaffGate';
import type { StaffProps } from './types';

/** Management must remain reachable when no products are currently sellable. */
export function StaffEntry({ admin, Turntable }: Pick<StaffProps, 'admin' | 'Turntable'>) {
  const [notice, setNotice] = useState('');
  useLayoutEffect(() => {
    document.getElementById('holm-shell')?.remove();
  }, []);
  return (
    <>
      <nav className="wrap" aria-label="Staff navigation" style={{ paddingBlock: 16 }}>
        <a href="#home">House of Louie Mae</a>
        {' · '}
        <a href="/">Louie Mae retail</a>
      </nav>
      <HouseStaffGate admin={admin} toast={setNotice} Turntable={Turntable} />
      <div className="wrap" role="status" aria-live="polite">
        {notice}
      </div>
    </>
  );
}
