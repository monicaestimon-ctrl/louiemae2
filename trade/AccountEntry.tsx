import { useLayoutEffect, useRef, useState } from 'react';
import { useAuthActions } from '@convex-dev/auth/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../convex/_generated/api';
import { deferredFeature } from './deferredFeature';
const TradeAccount = deferredFeature(() => import('./TradeAccount').then(m => ({ default: m.TradeAccount })), 'Your account');
const TradeWelcome = deferredFeature(() => import('./TradeWelcome').then(m => ({ default: m.TradeWelcome })), 'Sign in');
const TradeHub = deferredFeature(() => import('./app').then(m => ({ default: m.Hub })), 'Trade Hub');
const TradeApplication = deferredFeature(() => import('./TradeApplication').then(m => ({ default: m.TradeApplication })), 'Trade application');
import { usePrivateIndexing } from '../components/usePrivateIndexing';

const navigate = (route: string) => { window.location.hash = route; };
const artwork: string[][] = [];
function returnRoute() {
  try {
    const route = sessionStorage.getItem('hol:after');
    if (route && route !== 'welcome' && /^[a-z]+(?:\/[a-zA-Z0-9_-]+)?$/.test(route) && route.length < 160) return route;
  } catch { /* Account access must work with storage disabled. */ }
  return 'account';
}
const resume = (route: string) => {
  try { sessionStorage.removeItem('hol:after'); } catch { /* Optional storage. */ }
  navigate(route);
};

/** Authentication and account management do not depend on sellable inventory. */
export function AccountEntry({ me, route }: {
  me: FunctionReturnType<typeof api.holm.me>;
  route: 'welcome' | 'account' | 'hub' | 'trade';
}) {
  const { signOut } = useAuthActions();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [afterSignIn] = useState(returnRoute);
  usePrivateIndexing(true);
  useLayoutEffect(() => { document.getElementById('holm-shell')?.remove(); }, []);
  const logOut = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      await signOut();
      for (const key of ['tray', 'boards', 'collages', 'inspo']) {
        try { localStorage.removeItem(`hol:${key}`); } catch { /* Optional storage. */ }
      }
      navigate('welcome');
    } catch { setError('We could not sign you out. Please try again.'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <>
    <nav className="wrap" aria-label="Account navigation" style={{ paddingBlock: 16 }}>
      <a href="#home">House of Louie Mae</a>{' · '}<a href="#account" aria-current={route === 'account' ? 'page' : undefined}>My account</a>{' · '}<a href="#hub" aria-current={route === 'hub' ? 'page' : undefined}>Quotes and trade pass</a>{' · '}<a href="/">Louie Mae retail</a>
    </nav>
    {route === 'welcome'
      ? <TradeWelcome signedIn={me.signedIn} afterSignIn={afterSignIn} onNavigate={resume} artwork={artwork} oauthRedirectTo="/trade/#welcome" />
      : route === 'trade' ? <TradeApplication me={{ signedIn: me.signedIn, verified: Boolean(me.signedIn && me.verified) }} onNavigate={navigate} onSignIn={target => {
        try { sessionStorage.setItem('hol:after', target); } catch { /* Optional return intent. */ }
        navigate('welcome');
      }} />
      : route === 'hub' ? <TradeHub ctx={{ me, go: (target: string) => {
        if (target === 'welcome') {
          try { sessionStorage.setItem('hol:after', 'hub'); } catch { /* Optional return intent. */ }
        }
        navigate(target);
      }, toast: (message: string) => setNotice(message) }} />
      : <TradeAccount me={me} onNavigate={navigate} onSignOut={() => { void logOut(); }} signingOut={busy} />}
    {route === 'hub' && <p className="wrap" role="status">{notice}</p>}
    {error && <p className="wrap" role="alert">{error}</p>}
  </>;
}
