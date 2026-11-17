import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../convex/_generated/api';
import { normalizeWaitlistEmail } from '../lib/waitlistValidation';

/** Only a confirmed server response can claim signup success. No subscriber list is read. */
export function TradeNewsletter() {
  const subscribe = useMutation(api.subscribers.create);
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [message, setMessage] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const active = useRef(false);
  const generation = useRef(0);
  const id = useId();
  useEffect(() => () => { generation.current++; }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (active.current) return;
    const normalized = normalizeWaitlistEmail(email);
    if (!normalized) {
      setInvalid(true);
      setMessage('Enter a valid email address.');
      input.current?.focus();
      return;
    }
    const attempt = ++generation.current;
    active.current = true;
    setPending(true);
    setInvalid(false);
    setMessage('Saving your signup…');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        subscribe({ email: normalized, tags: ['holm'] }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Confirmation timed out')), 10_000); }),
      ]);
      if (attempt !== generation.current) return;
      setMessage(result === null ? 'Your email is already on file. Contact support if you need to update your subscription preferences.' : 'You’re subscribed to Louie Mae updates.');
      if (result !== null) setEmail('');
    } catch {
      if (attempt === generation.current) setMessage('We could not confirm your signup. Please try again.');
    } finally {
      clearTimeout(timer);
      if (attempt === generation.current) {
        active.current = false;
        setPending(false);
      }
    }
  }
  return <form onSubmit={submit} noValidate style={{ marginTop: 16, maxWidth: 360 }} aria-busy={pending}>
    <label htmlFor={id} style={{ display: 'block', marginBottom: 6 }}>Email for new arrivals</label>
    <div className="row">
      <input ref={input} id={id} className="field" style={{ height: 44, minWidth: 0 }} type="email" autoComplete="email" maxLength={254} value={email} readOnly={pending} aria-required="true" aria-invalid={invalid || undefined} aria-describedby={`${id}-status`} onChange={event => { setEmail(event.target.value); setInvalid(false); setMessage(''); }} />
      <button type="submit" className="btn btn-ink btn-sm" style={{ minHeight: 44 }} disabled={pending}>{pending ? 'Saving…' : 'Subscribe'}</button>
    </div>
    <p id={`${id}-status`} role="status" style={{ fontSize: 14, marginTop: 8 }}>{message}</p>
  </form>;
}
