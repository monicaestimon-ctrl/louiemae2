import React, { useEffect, useRef } from 'react';

/** Keep a failed or pending search module inside a dismissible overlay. */
export function SearchLoadState({ failed = false, onClose }: { failed?: boolean; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div role="dialog" aria-modal="true" aria-label="Search" className="fixed inset-0 z-[60] bg-earth text-cream flex flex-col items-center justify-center gap-6 p-8" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
    <h2 className="font-serif text-3xl">Search</h2>
    <p role="status">{failed ? 'Search could not be loaded. Please reload the page to try again.' : 'Opening search…'}</p>
    {failed && <button className="min-h-11 border border-cream px-5 py-3" onClick={() => window.location.reload()}>Reload page</button>}
    <button ref={close} className="min-h-11 underline" onClick={onClose}>Close search</button>
  </div>;
}
