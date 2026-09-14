import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { LandingPage } from './LandingPage';
import { prelaunchEntry } from './routes';
import './style.css';

const Admin = lazy(() => import('./Admin'));
const entry = prelaunchEntry(window.location.pathname, window.location.hash);
const isAdmin = entry === 'admin' || entry === 'waitlist-admin';
if (entry === 'legacy-admin') window.location.replace('/admin');
if (isAdmin) {
  const robots = document.createElement('meta');
  robots.name = 'robots';
  robots.content = 'noindex, nofollow';
  document.head.appendChild(robots);
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {entry === 'legacy-admin' ? <p className="lm-loading">Opening your workspace…</p> : isAdmin ? <Suspense fallback={<p className="lm-loading">Opening your workspace…</p>}><Admin /></Suspense> : <LandingPage />}
  </React.StrictMode>,
);
