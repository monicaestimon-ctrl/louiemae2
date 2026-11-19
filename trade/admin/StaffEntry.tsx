import { useLayoutEffect, useState } from 'react';
import { HouseStaffGate } from './HouseStaffGate';
import type { StaffProps } from './types';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { CredentialsForm } from '../../components/account/CredentialsForm';

function StaffSignIn() {
  const options = useQuery(api.holm.signInOptions);
  return <main className="wrap" style={{ maxWidth: 560, paddingBlock: 32 }}>
    <h1>Sign in to House management</h1>
    <CredentialsForm site="trade" googleEnabled={options?.google} afterSignIn="admin" oauthRedirectTo="/trade/#admin" />
  </main>;
}

/** Management must remain reachable when no products are currently sellable. */
export function StaffEntry({ admin, signedIn, Turntable }: Pick<StaffProps, 'admin' | 'Turntable'> & { signedIn: boolean }) {
  const [notice, setNotice] = useState('');
  const [signingIn, setSigningIn] = useState(false);
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
      {signingIn && !signedIn ? <StaffSignIn /> : <HouseStaffGate admin={admin} toast={setNotice} Turntable={Turntable} />}
      {!signedIn && !signingIn && <div className="wrap"><button className="btn btn-ink" onClick={() => setSigningIn(true)}>Sign in to staff account</button></div>}
      <div className="wrap" role="status" aria-live="polite">
        {notice}
      </div>
    </>
  );
}
