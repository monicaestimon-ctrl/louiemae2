import React, { useId, useRef, useState } from 'react';
import { useAuthActions } from '@convex-dev/auth/react';
import { useFormValidation } from '../forms/useFormValidation';
import { ValidationSummary } from '../forms/ValidationSummary';
import './credentials.css';

type Props = { site: 'creator' | 'trade'; googleEnabled?: boolean; afterSignIn?: string };
/** Shared credentials UI; account permissions and membership remain server-owned. */
export function CredentialsForm({ site, googleEnabled = false, afterSignIn = 'home' }: Props) {
  const { signIn } = useAuthActions();
  const id = useId();
  const [flow, setFlow] = useState<'signIn' | 'signUp'>(site === 'creator' ? 'signUp' : 'signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const feedback = useFormValidation<'email' | 'password' | '_form'>();
  /** Lock synchronously so rapid clicks cannot dispatch a second provider request. */
  const begin = () => {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    feedback.reset();
    return true;
  };
  const finish = () => {
    pending.current = false;
    setBusy(false);
  };
  /** Validate locally before dispatch; rejected credentials remain available for correction. */
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending.current) return;
    const errors: { email?: string; password?: string } = {};
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = 'Enter a valid email address.';
    if (password.length < 8) errors.password = 'Use a password of at least 8 characters.';
    if (Object.keys(errors).length) {
      feedback.report(errors);
      return;
    }
    if (!begin()) return;
    try {
      const data = new FormData();
      data.set('email', email.trim().toLowerCase());
      data.set('password', password);
      data.set('flow', flow);
      await signIn('password', data);
    } catch {
      feedback.report({
        _form:
          flow === 'signIn'
            ? `That email and password did not match. Try again.${googleEnabled ? ' If you signed in with Google before, use Continue with Google.' : ''}`
            : 'We could not create that account. If you already have one, sign in instead.',
      });
    } finally {
      finish();
    }
  };
  /** Preserve return intent when storage is available, without making it a prerequisite for OAuth. */
  const google = async () => {
    if (!begin()) return;
    try {
      sessionStorage.setItem(
        site === 'creator' ? 'lm:after' : 'hol:after',
        site === 'creator' ? '#creators' : afterSignIn
      );
    } catch {
      /* Authentication can continue without session storage. */
    }
    try {
      await signIn('google', { redirectTo: site === 'creator' ? '/' : '/trade/' });
    } catch {
      feedback.report({
        _form: 'Google sign-in is not available right now. Use your email instead.',
      });
    } finally {
      finish();
    }
  };
  const title =
    flow === 'signUp'
      ? site === 'creator'
        ? 'Create your account to join'
        : 'Create your account'
      : site === 'creator'
        ? 'Sign in to your Creator Hub'
        : 'Welcome back';
  return (
    <form
      className="credentials-ui"
      aria-labelledby={`${id}-title`}
      aria-busy={busy}
      noValidate
      onSubmit={submit}
    >
      <h2 id={`${id}-title`}>{title}</h2>
      {site === 'trade' && (
        <p>
          {flow === 'signIn'
            ? 'Sign in to your projects, client quotes and trade pricing.'
            : 'Save projects, request quotes and apply for trade pricing.'}
        </p>
      )}
      <ValidationSummary
        summaryRef={feedback.summaryRef}
        entries={[
          {
            label: site === 'trade' ? 'Work email' : 'Email',
            fieldId: `${id}-email`,
            message: feedback.errors.email,
          },
          { label: 'Password', fieldId: `${id}-password`, message: feedback.errors.password },
          { message: feedback.errors._form },
        ]}
      />
      {googleEnabled && (
        <button className="credentials-secondary" type="button" disabled={busy} onClick={google}>
          Continue with Google
        </button>
      )}
      <div className="credentials-field">
        <label htmlFor={`${id}-email`}>{site === 'trade' ? 'Work email' : 'Email'}</label>
        <input
          id={`${id}-email`}
          type="email"
          autoComplete="email"
          required
          disabled={busy}
          value={email}
          aria-invalid={Boolean(feedback.errors.email)}
          aria-describedby={feedback.errors.email ? `${id}-email-error` : undefined}
          onChange={(event) => {
            setEmail(event.target.value);
            feedback.clear('email');
            feedback.clear('_form');
          }}
        />
        {feedback.errors.email && (
          <p id={`${id}-email-error`} className="credentials-error">
            {feedback.errors.email}
          </p>
        )}
      </div>
      <div className="credentials-field">
        <label htmlFor={`${id}-password`}>Password</label>
        <input
          id={`${id}-password`}
          type="password"
          autoComplete={flow === 'signIn' ? 'current-password' : 'new-password'}
          required
          minLength={8}
          disabled={busy}
          value={password}
          aria-invalid={Boolean(feedback.errors.password)}
          aria-describedby={`${id}-password-help${feedback.errors.password ? ` ${id}-password-error` : ''}`}
          onChange={(event) => {
            setPassword(event.target.value);
            feedback.clear('password');
            feedback.clear('_form');
          }}
        />
        <p id={`${id}-password-help`} className="credentials-help">
          At least 8 characters.
        </p>
        {feedback.errors.password && (
          <p id={`${id}-password-error`} className="credentials-error">
            {feedback.errors.password}
          </p>
        )}
      </div>
      <button className="credentials-primary" disabled={busy}>
        {busy ? 'One moment…' : flow === 'signUp' ? 'Create account' : 'Sign in'}
      </button>
      <p>
        {flow === 'signUp' ? 'Already have an account? ' : 'New here? '}
        <button
          className="credentials-switch"
          type="button"
          disabled={busy}
          onClick={() => {
            setFlow(flow === 'signUp' ? 'signIn' : 'signUp');
            feedback.reset();
          }}
        >
          {flow === 'signUp' ? 'Sign in' : 'Create an account'}
        </button>
      </p>
      {site === 'trade' && (
        <p className="credentials-help">
          By continuing you agree to our{' '}
          <a href="/terms" target="_blank" rel="noopener">
            Terms of Service
          </a>{' '}
          and{' '}
          <a href="/privacy" target="_blank" rel="noopener">
            Privacy Policy
          </a>
          .
        </p>
      )}
    </form>
  );
}
