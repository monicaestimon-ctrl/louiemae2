import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { MessageSquare, X } from 'lucide-react';
import { loadModule } from '../lib/moduleRecovery';
import { ErrorBoundary } from './ErrorBoundary';
import { usePrivateIndexing } from './usePrivateIndexing';
const Panel = lazy(() =>
  loadModule(() => import('./ConciergePanel')).then((module) => ({
    default: module.ConciergePanel,
  }))
);
function LoadState({ failed = false, onClose }: { failed?: boolean; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
  }, []);
  return (
    <section
      role="dialog"
      aria-label="Louie Mae concierge"
      className="fixed z-50 bottom-20 right-4 w-[calc(100vw-2rem)] sm:w-96 p-6 bg-cream text-earth shadow-lg rounded-2xl"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <p role="status">
        {failed
          ? 'The concierge could not be opened. Please reload to try again.'
          : 'Opening the concierge...'}
      </p>
      <button ref={close} className="min-h-11 underline" onClick={onClose}>
        Close concierge
      </button>
      {failed && (
        <button className="min-h-11 underline ml-3" onClick={() => window.location.reload()}>
          Reload page
        </button>
      )}
    </section>
  );
}
/** Keep the trigger available while the optional panel loads. */
export function AiConcierge() {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const previous = useRef(false);
  usePrivateIndexing(open);
  useEffect(() => {
    if (!open && previous.current) trigger.current?.focus();
    previous.current = open;
  }, [open]);
  const close = () => setOpen(false);
  return (
    <>
      {opened && (
        <ErrorBoundary fallback={open ? <LoadState failed onClose={close} /> : <></>}>
          <Suspense fallback={open ? <LoadState onClose={close} /> : null}>
            <Panel open={open} onClose={close} />
          </Suspense>
        </ErrorBoundary>
      )}
      <button
        ref={trigger}
        onClick={() => {
          setOpened(true);
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        aria-label={open ? 'Close the concierge' : 'Ask the Louie Mae concierge'}
        className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 md:bottom-6 md:right-6 z-50 flex items-center justify-center w-[52px] h-[52px] md:w-14 md:h-14 bg-earth text-white rounded-full shadow-lg"
      >
        {open ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
      </button>
    </>
  );
}
