import React from 'react';
import { useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../convex/_generated/api';

type Props = {
  me: FunctionReturnType<typeof api.holm.me>;
  onNavigate: (route: string) => void;
  onSignOut: () => void;
};
const statusLabels: Record<string, string> = { approved: 'Verified', pending: 'In review', needs_info: 'More information needed', rejected: 'Not approved', none: 'Not applied' };

/** Account membership is server-owned; anonymous visitors never request application details. */
export function TradeAccount({ me, onNavigate, onSignOut }: Props) {
  const application = useQuery(api.holm.myApplication, me.signedIn ? {} : 'skip');
  if (!me.signedIn) return <main className="wrap"><div className="empty" style={{ padding: '80px 0' }}>
    <h1>Sign in to manage your account</h1>
    <button className="btn btn-ink" onClick={() => onNavigate('welcome')}>Sign in</button>
  </div></main>;
  return <main className="wrap"><div className="acct">
    <nav aria-label="Account settings">
      <button className="on" aria-current="page">Account</button>
      <button onClick={() => onNavigate('hub')}>Quotes and trade pass</button>
      <button onClick={onSignOut}>Log out</button>
    </nav>
    <section className="acct-sec">
      <h1>Your account</h1>
      <dl className="specs">
        <div><dt>Email</dt><dd>{me.email}</dd></div>
        <div><dt>Business</dt><dd>{me.businessName || application?.businessName || 'Not added yet'}</dd></div>
        <div><dt>Trade status</dt><dd style={me.verified ? { color: 'var(--ok)' } : undefined}>{statusLabels[me.tradeStatus] || 'Not applied'}</dd></div>
        <div><dt>Pricing</dt><dd>{me.verified ? 'Trade, with project pricing' : 'Retail'}</dd></div>
      </dl>
      {!me.verified && me.tradeStatus !== 'pending' && <button className="btn btn-ink" style={{ justifySelf: 'start' }} onClick={() => onNavigate('trade')}>Apply for trade pricing</button>}
      {me.admin && <button className="btn btn-line" style={{ justifySelf: 'start' }} onClick={() => onNavigate('admin')}>Review trade applications</button>}
      <p className="help">To change your email, add a resale certificate after approval or close your account, email withlove@louiemae.com from the address on this account.</p>
    </section>
  </div></main>;
}
