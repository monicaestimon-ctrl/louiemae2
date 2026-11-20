import { useLayoutEffect, useRef, useState } from 'react';
import { useAuthActions } from '@convex-dev/auth/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../convex/_generated/api';
import { deferredFeature } from './deferredFeature';
const TradeAccount = deferredFeature(() => import('./TradeAccount').then(m => ({ default: m.TradeAccount })), 'Your account');
const TradeWelcome = deferredFeature(() => import('./TradeWelcome').then(m => ({ default: m.TradeWelcome })), 'Sign in');
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
  route: 'welcome' | 'account';
}) {
  const { signOut } = useAuthActions();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
      <a href="#home">House of Louie Mae</a>{' · '}<a href="/">Louie Mae retail</a>
    </nav>
    {route === 'welcome'
      ? <TradeWelcome signedIn={me.signedIn} afterSignIn={afterSignIn} onNavigate={resume} artwork={artwork} oauthRedirectTo="/trade/#welcome" />
      : <TradeAccount me={me} onNavigate={navigate} onSignOut={() => { void logOut(); }} signingOut={busy} />}
    {error && <p className="wrap" role="alert">{error}</p>}
  </>;
}
