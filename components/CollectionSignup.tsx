import { useId, useRef, useState, type FormEvent } from 'react';
import { useNewsletter } from '../contexts/NewsletterContext';

/** Category interest is acknowledged only after the subscription command succeeds. */
export function CollectionSignup({ category }: { category: string }) {
  const { addSubscriberWithTags } = useNewsletter();
  const id = useId();
  const pending = useRef(false);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending.current || status === 'success' || !email.trim()) return;
    pending.current = true;
    setStatus('pending');
    const tag = `category:${category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
    try {
      const accepted = await addSubscriberWithTags(email.trim(), 'Guest', ['vip', 'early-access', tag]);
      if (!accepted) { setStatus('error'); return; }
      setStatus('success');
      setEmail('');
    } catch {
      setStatus('error');
    } finally {
      pending.current = false;
    }
  };
  return <form onSubmit={submit} aria-label={`Early access to ${category}`} className="w-full max-w-sm mx-auto flex flex-col gap-4 mt-6 text-white">
    <label htmlFor={id} className="text-sm text-left">Email address</label>
    <input id={id} name="email" type="email" autoComplete="email" required value={email}
      disabled={status === 'pending' || status === 'success'}
      aria-describedby={`${id}-status`}
      onChange={event => { setEmail(event.target.value); if (status === 'error') setStatus('idle'); }}
      placeholder="Email Address"
      className="w-full rounded-lg bg-stone-950 text-white border border-white/70 p-3 text-base placeholder:text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white" />
    <button type="submit" disabled={status === 'pending' || status === 'success'}
      className="min-h-11 w-full bg-white text-stone-900 py-4 text-xs uppercase tracking-widest rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:opacity-80">
      {status === 'pending' ? 'Requesting access…' : status === 'success' ? 'Access requested' : 'Request early access'}
    </button>
    <p id={`${id}-status`} role="status" aria-live="polite" className="text-sm leading-relaxed min-h-6">
      {status === 'error' ? 'We could not confirm your request. Your email is saved here; please try again.' : status === 'success' ? `Thank you. You’re on the list for ${category} updates.` : status === 'pending' ? 'Submitting your request…' : ''}
    </p>
  </form>;
}
