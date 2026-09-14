import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { LandingPage } from './LandingPage';
import './style.css';

const Admin = lazy(() => import('./Admin'));
const isAdmin = ['/admin', '/waitlist-admin'].includes(window.location.pathname.replace(/\/+$/, '')) || window.location.hash === '#admin';
if (isAdmin) {
  const robots = document.createElement('meta');
  robots.name = 'robots';
  robots.content = 'noindex, nofollow';
  document.head.appendChild(robots);
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isAdmin ? <Suspense fallback={<p className="lm-loading">Opening your workspace…</p>}><Admin /></Suspense> : <LandingPage />}
  </React.StrictMode>,
);
