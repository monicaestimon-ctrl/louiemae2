import React from 'react';
import type { PublicContentStatus } from '../contexts/usePublicSiteContent';

/** Do not turn an unavailable or unresolved custom page into a home-page redirect. */
export function ContentStatusPage({ status }: { status: PublicContentStatus }) {
  return <main className="min-h-screen bg-cream flex items-center justify-center p-8 text-earth">
    <div className="max-w-md text-center">
      <h1 className="font-serif text-3xl mb-6">{status === 'loading' ? 'Loading page…' : status === 'unavailable' ? 'Page temporarily unavailable' : 'Page not found'}</h1>
      <p role="status" className="mb-6">{status === 'loading' ? 'We are loading this page.' : status === 'unavailable' ? 'Please try again. Your saved cart has not been cleared.' : 'This page may have moved or is no longer available.'}</p>
      {status === 'unavailable' && <button onClick={() => window.location.reload()} className="border border-earth px-5 py-3 mr-4">Try again</button>}
      <a href="#shop" className="underline">Browse the shop</a>
    </div>
  </main>;
}
