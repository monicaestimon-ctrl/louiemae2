import React, { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { Modal } from './Modal';
import { ErrorBoundary } from './ErrorBoundary';
import { loadModule } from '../lib/moduleRecovery';
import { useNewsletter } from '../contexts/NewsletterContext';
const NewsletterPopupContent = lazy(() => loadModule(() => import('./NewsletterPopupContent')));
function PopupLoadState({
  failed = false,
  onDismiss,
}: {
  failed?: boolean;
  onDismiss: () => void;
}) {
  return (
    <div className="relative bg-earth p-8 pt-16 text-cream">
      <p role={failed ? 'alert' : 'status'}>
        {failed ? 'The newsletter form could not be loaded.' : 'Opening the newsletter form...'}
      </p>
      {failed && (
        <p className="mt-4">
          Visit{' '}
          <a className="underline" href="/#home" onClick={onDismiss}>
            our home page
          </a>{' '}
          and use “Join The Mae Letter” near the bottom.
        </p>
      )}
    </div>
  );
}

export const NewsletterPopup: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);
  const dismissedThisVisit = useRef(false);
  const rememberDismissal = () => {
    dismissedThisVisit.current = true;
    try {
      localStorage.setItem('lm_newsletter_dismissed', 'true');
    } catch {
      /* Keep current-visit dismissal when storage is blocked. */
    }
  };
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle');
  const [error, setError] = useState('');
  const { addSubscriber } = useNewsletter();

  useEffect(() => {
    // Check if already dismissed
    const dismissed = () => {
      if (dismissedThisVisit.current) return true;
      try {
        return !!localStorage.getItem('lm_newsletter_dismissed');
      } catch {
        return false;
      }
    };
    if (dismissed()) return;

    // Do not interrupt another dialog after the initial delay.
    const observer = new MutationObserver(() => showWhenFree());
    const showWhenFree = () => {
      if (dismissed() || document.querySelector('dialog[open], [role="dialog"]:not([hidden])'))
        return;
      observer.disconnect();
      document.removeEventListener('close', showWhenFree, true);
      setIsVisible(true);
    };
    const timer = setTimeout(() => {
      // Shared modals are direct body portals. Native close covers mounted dialogs.
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['open', 'hidden'],
      });
      document.addEventListener('close', showWhenFree, true);
      showWhenFree();
    }, 10000);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener('close', showWhenFree, true);
    };
  }, []);

  const handleDismiss = () => {
    setIsVisible(false);
    rememberDismissal();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setStatus('loading');
    setError('');
    try {
      const success = await addSubscriber(email.trim());

      if (success) {
        setStatus('success');
        rememberDismissal();
      } else {
        setStatus('idle'); // Existing subscriber
        setError("You're already on the list!");
      }
    } catch {
      setStatus('idle');
      setError('We could not save your signup. Please try again.');
    }
  };

  if (!isVisible) return null;

  return (
    <Modal
      open={isVisible}
      label="The Mae Letter newsletter"
      onClose={handleDismiss}
      className="flex items-center justify-center text-cream"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={handleDismiss}
      />
      <div
        data-newsletter-panel
        className="relative m-4 max-h-[calc(100dvh_-_2rem)] w-full max-w-3xl overflow-y-auto rounded-3xl bg-earth"
      >
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Close newsletter popup"
          className="absolute top-3 right-3 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-cream hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 transition-colors"
        >
          <span aria-hidden="true" className="text-2xl">
            ×
          </span>
        </button>
        <ErrorBoundary fallback={<PopupLoadState failed onDismiss={handleDismiss} />}>
          <Suspense fallback={<PopupLoadState onDismiss={handleDismiss} />}>
            <NewsletterPopupContent
              email={email}
              status={status}
              error={error}
              setEmail={setEmail}
              handleSubmit={handleSubmit}
              handleDismiss={handleDismiss}
            />
          </Suspense>
        </ErrorBoundary>
      </div>
    </Modal>
  );
};
