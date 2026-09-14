import { useEffect, useState, type FormEvent } from 'react';
import { ConvexReactClient, useConvex, useConvexAuth, useMutation, usePaginatedQuery } from 'convex/react';
import { ConvexAuthProvider, useAuthActions } from '@convex-dev/auth/react';
import { api } from '../convex/_generated/api';
import { ErrorBoundary } from '../components/ErrorBoundary';
import App from '../App';
import originalHtml from '../index.html?raw';
import './admin.css';

const client = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

function OriginalAdmin() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!window.location.hash.startsWith('#admin')) window.history.replaceState(window.history.state, '', '#admin');
    const leaveAdmin = () => { if (!window.location.hash.startsWith('#admin')) window.location.replace('/'); };
    window.addEventListener('hashchange', leaveAdmin);
    // Reuse the original document's styling verbatim for the preserved admin.
    const head = new window.DOMParser().parseFromString(originalHtml, 'text/html').head;
    const nodes: HTMLElement[] = [];
    const add = (node: HTMLElement) => { document.head.appendChild(node); nodes.push(node); };
    for (const source of head.querySelectorAll('style, link[rel="stylesheet"]')) add(source.cloneNode(true) as HTMLElement);
    const tailwind = document.createElement('script');
    tailwind.src = 'https://cdn.tailwindcss.com';
    tailwind.onload = () => {
      for (const source of head.querySelectorAll('script:not([src]):not([type])')) {
        const node = document.createElement('script'); node.textContent = source.textContent; add(node);
      }
      setReady(true);
    };
    tailwind.onerror = () => setReady(true);
    add(tailwind);
    return () => { window.removeEventListener('hashchange', leaveAdmin); tailwind.onload = null; nodes.forEach(node => node.remove()); };
  }, []);
  return ready ? <><a className="lm-admin-shortcut" href="/waitlist-admin">Launch waitlist →</a><App /></> : <p>Opening your workspace…</p>;
}

function WaitlistRows() {
  const { results, status, loadMore } = usePaginatedQuery(api.waitlist.list, {}, {initialNumItems:50});
  const unsubscribe = useMutation(api.waitlist.unsubscribe);
  const convex = useConvex();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function exportCsv() {
    setBusy(true); setError('');
    try {
      let cursor: string | null = null;
      const rows = ['Email,Signup date,Status,Consent version'];
      for (;;) {
        const page = await convex.query(api.waitlist.list, { paginationOpts: {numItems:200, cursor} });
        for (const row of page.page) {
          // Prefix formula-leading spreadsheet cells to prevent CSV injection.
          const cell = (value: string) => `"${(/^[=+@\-\t\r]/.test(value) ? "'" + value : value).replaceAll('"','""')}"`;
          rows.push([row.email,new Date(row.createdAt).toISOString(),row.status,row.consentVersion].map(cell).join(','));
        }
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
      const url = URL.createObjectURL(new Blob([rows.join('\r\n')], {type:'text/csv;charset=utf-8'}));
      const link = document.createElement('a'); link.href=url; link.download=`louie-mae-waitlist-${new Date().toISOString().slice(0,10)}.csv`; link.click();
      setTimeout(() => URL.revokeObjectURL(url),1000);
    } catch { setError('Couldn’t export the waitlist. Please try again.'); }
    finally { setBusy(false); }
  }
  return <><button onClick={exportCsv} disabled={busy}>{busy ? 'Preparing export…' : 'Export all signups (CSV)'}</button>
    <p>{results.length} signups loaded{status === 'CanLoadMore' ? ' · more available' : ''}. Emails are also tagged “prelaunch-waitlist” in your existing subscriber list.</p>
    {error && <p role="alert">{error}</p>}
    <div className="lm-admin-table"><table><thead><tr><th>Email</th><th>Joined</th><th>Status</th><th>Manage</th></tr></thead><tbody>{results.map(row => <tr key={row._id}><td>{row.email}</td><td>{new Date(row.createdAt).toLocaleDateString()}</td><td>{row.status}</td><td>{row.status === 'active' && <button onClick={async () => { try { await unsubscribe({id:row._id}); } catch {setError('Couldn’t update this signup. Please try again.');} }}>Unsubscribe</button>}</td></tr>)}</tbody></table></div>
    {status === 'LoadingFirstPage' && <p role="status">Loading signups…</p>}
    {status === 'Exhausted' && results.length === 0 && <p>No signups yet. Your first chapter starts here.</p>}
    {status === 'CanLoadMore' && <button onClick={() => loadMore(50)}>Load more</button>}
  </>;
}

function WaitlistAdmin() {
  const {isAuthenticated,isLoading} = useConvexAuth();
  const {signIn,signOut} = useAuthActions();
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {const data=new FormData(event.currentTarget);data.set('flow','signIn');await signIn('password',data);}
    catch {setError('Unable to sign in. Use your existing Louie Mae administrator credentials.');}
    finally {setBusy(false);}
  }
  useEffect(() => {document.title='Launch waitlist | Louie Mae';},[]);
  return <main className="lm-admin"><nav><a href="/">Louie Mae home</a><a href="/admin">Store administration</a>{isAuthenticated && <button onClick={() => void signOut()}>Sign out</button>}</nav><h1>Launch waitlist</h1>
    {isLoading ? <p>Loading…</p> : isAuthenticated ? <WaitlistRows /> : <form onSubmit={login}><p>Sign in with your existing administrator account.</p><label>Email<input name="email" type="email" autoComplete="username" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" required /></label><button disabled={busy}>{busy?'Signing in…':'Sign in'}</button>{error && <p role="alert">{error}</p>}</form>}
  </main>;
}

export default function Admin() {
  return <ConvexAuthProvider client={client}><ErrorBoundary>{window.location.pathname.replace(/\/+$/,'') === '/waitlist-admin' ? <WaitlistAdmin /> : <OriginalAdmin />}</ErrorBoundary></ConvexAuthProvider>;
}
