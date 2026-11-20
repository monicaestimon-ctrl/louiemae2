import React, { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { customerMessage } from '../lib/errors';
import { useFormValidation } from '../components/forms/useFormValidation';
import { ValidationSummary } from '../components/forms/ValidationSummary';
import {
  applicationErrors,
  BUSINESS_TYPES,
  REGISTRATION_STATES,
  type ApplicationField,
  type ApplicationValues,
} from './application';
import '../components/delivery/forms.css';

type Props = {
  me: { signedIn: boolean; verified: boolean };
  onNavigate: (route: string) => void;
  onSignIn: (route: string) => void;
};
const STEPS = [
  'Business type',
  'Business details',
  'Industry credential',
  'Tax exemption',
  'Review',
];
const BLANK: ApplicationValues = {
  type: '',
  name: '',
  state: 'New York',
  ein: '',
  web: '',
  cred: '',
  company: '',
  email: '',
  tax: false,
  cert: null,
};
const LABELS: Partial<Record<ApplicationField, string>> = {
  type: 'Business type',
  name: 'Legal business name',
  ein: 'EIN',
  web: 'Website or business Instagram',
  company: 'Company',
  email: 'Work email',
  cred: 'Industry credential',
  cert: 'Certificate',
};
/** Accessible step-based application. Validation precedes uploads; eligibility and approval stay server-owned. */
export function TradeApplication({ me, onNavigate, onSignIn }: Props) {
  const application = useQuery(api.holm.myApplication);
  const apply = useMutation(api.holm.applyTrade);
  const uploadUrl = useMutation(api.holm.uploadUrl);
  const [values, setValues] = useState<ApplicationValues>(BLANK);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const id = useId();
  const heading = useRef<React.ComponentRef<'h2'>>(null);
  const lastStep = useRef(step);
  const feedback = useFormValidation<ApplicationField>();
  const details = values.type ? BUSINESS_TYPES[values.type] : null;
  useEffect(() => {
    if (lastStep.current !== step) {
      heading.current?.focus();
      lastStep.current = step;
    }
  }, [step]);
  const fieldId = (field: ApplicationField) => `${id}-${field}`;
  const change = <K extends keyof ApplicationValues>(field: K, value: ApplicationValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
    feedback.clear(field);
    feedback.clear('_form');
  };
  const fieldProps = (field: ApplicationField) => ({
    id: fieldId(field),
    'aria-invalid': Boolean(feedback.errors[field]),
    'aria-describedby': feedback.errors[field] ? `${fieldId(field)}-error` : undefined,
  });
  const error = (field: ApplicationField) =>
    feedback.errors[field] && (
      <p id={`${fieldId(field)}-error`} className="delivery-error">
        {feedback.errors[field]}
      </p>
    );
  /** Guard duplicate dispatch and preserve the draft if upload or application submission fails. */
  const submit = async () => {
    if (pending.current || !values.type) return;
    pending.current = true;
    setBusy(true);
    feedback.reset();
    try {
      let certificateId: Id<'_storage'> | undefined;
      if (values.tax && values.cert) {
        const url = await uploadUrl({});
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': values.cert.type || 'application/octet-stream' },
          body: values.cert,
        });
        if (!response.ok) throw new Error('The certificate did not upload. Try again.');
        const result: unknown = await response.json();
        if (
          !result ||
          typeof result !== 'object' ||
          !('storageId' in result) ||
          typeof result.storageId !== 'string'
        )
          throw new Error('The certificate upload could not be confirmed. Try again.');
        certificateId = result.storageId as Id<'_storage'>;
      }
      await apply({
        businessType: values.type,
        businessName: values.name,
        state: values.state,
        ein: values.ein,
        website: values.web,
        credential: values.type === 'pm' ? '' : values.cred,
        company: values.type === 'pm' ? values.company : undefined,
        workEmail: values.type === 'pm' ? values.email : undefined,
        taxRequested: values.tax,
        certificateId,
      });
      setDone(true);
    } catch (cause) {
      feedback.report({ _form: customerMessage(cause) });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  /** Link validation to the active step and revalidate the complete draft before any external command. */
  const advance = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending.current) return;
    const errors = applicationErrors(values, step === 4 ? undefined : step);
    if (Object.keys(errors).length) {
      feedback.report(errors);
      return;
    }
    feedback.reset();
    if (step < 4) setStep(step + 1);
    else void submit();
  };
  const intro = (
    <div>
      <h1 style={{ fontSize: 'clamp(44px,5.6vw,76px)' }}>
        Trade pricing for <em style={{ color: 'var(--cognac)' }}>businesses that build rooms.</em>
      </h1>
      <p className="mute" style={{ marginTop: 18, maxWidth: '46ch', fontSize: 16 }}>
        One short check for everyone, plus one credential for your industry. Most applications are
        reviewed within a business day.
      </p>
      <ol className="steps" aria-label="Application progress">
        {STEPS.map((label, index) => (
          <li
            key={label}
            aria-current={index === step && !done ? 'step' : undefined}
            className={`stepi${index === step && !done ? ' on' : ''}${index < step || done ? ' done' : ''}`}
          >
            <i aria-hidden="true">{index + 1}</i>
            {label}
          </li>
        ))}
      </ol>
      <div className="note" style={{ marginTop: 20 }}>
        <span>
          Trade approval and tax exemption are separate. Approval gets you eligible trade pricing.
          Tax exemption needs a valid resale or exemption certificate; without one, sales tax is
          charged.
        </span>
      </div>
    </div>
  );
  const frame = (content: React.ReactNode) => (
    <main className="wrap">
      <div className="apply">
        {intro}
        {content}
      </div>
    </main>
  );
  if (!me.signedIn)
    return frame(
      <div className="formcard">
        <h2>Start with an account</h2>
        <p>
          Create an account or sign in, then apply. Your projects and quotes stay with your account.
        </p>
        <button className="btn btn-ink btn-lg" onClick={() => onSignIn('trade')}>
          Sign in or create an account
        </button>
      </div>
    );
  if (me.verified || application?.status === 'pending' || done)
    return frame(
      <div className="formcard" role="status">
        <h2>{me.verified ? 'You are verified' : 'Application received'}</h2>
        <p>
          {me.verified
            ? 'Your approved trade prices are available.'
            : `We're checking ${application?.businessName || values.name}. You'll hear from us by email, usually within one business day.`}
        </p>
        <button className="btn btn-ink" onClick={() => onNavigate('home')}>
          {me.verified ? 'Shop at trade' : 'Browse while you wait'}
        </button>
      </div>
    );
  return frame(
    <form
      className="formcard delivery-ui"
      noValidate
      onSubmit={advance}
      aria-labelledby={`${id}-heading`}
      aria-busy={busy}
    >
      <span className="mono mute">Step {step + 1} of 5</span>
      {application?.status === 'needs_info' && step === 0 && (
        <p className="note">
          {application.reviewNote ||
            'We need a little more information. Update your details and submit again.'}
        </p>
      )}
      <h2 id={`${id}-heading`} ref={heading} tabIndex={-1} style={{ fontSize: 36 }}>
        {
          [
            'What kind of business are you?',
            'Tell us about the business',
            `One credential for ${details?.l.toLowerCase() || 'your business'}`,
            'Tax exemption (optional)',
            'Review and submit',
          ][step]
        }
      </h2>
      <ValidationSummary
        summaryRef={feedback.summaryRef}
        entries={Object.entries(feedback.errors).map(([field, message]) => ({
          message,
          label: LABELS[field as ApplicationField],
          fieldId: field === '_form' ? undefined : fieldId(field as ApplicationField),
        }))}
      />
      <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
        <legend className="sr">
          Step {step + 1}: {STEPS[step]}
        </legend>
        {step === 0 && (
          <>
            <div
              className="types"
              role="group"
              aria-label="Business type"
              {...fieldProps('type')}
              tabIndex={-1}
            >
              {(Object.keys(BUSINESS_TYPES) as Array<keyof typeof BUSINESS_TYPES>).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`typec${values.type === type ? ' on' : ''}`}
                  aria-pressed={values.type === type}
                  onClick={() => change('type', type)}
                >
                  <b>{BUSINESS_TYPES[type].l}</b>
                  <small>{BUSINESS_TYPES[type].s}</small>
                </button>
              ))}
            </div>
            {error('type')}
          </>
        )}
        {step === 1 && (
          <>
            <div>
              <label className="lbl" htmlFor={fieldId('name')}>
                Legal business name
              </label>
              <input
                className="field"
                {...fieldProps('name')}
                autoComplete="organization"
                required
                maxLength={200}
                value={values.name}
                onChange={(e) => change('name', e.target.value)}
              />
              {error('name')}
            </div>
            <div className="g2f">
              <div>
                <label className="lbl" htmlFor={fieldId('state')}>
                  State of registration
                </label>
                <select
                  className="field"
                  {...fieldProps('state')}
                  autoComplete="address-level1"
                  value={values.state}
                  onChange={(e) => change('state', e.target.value)}
                >
                  {REGISTRATION_STATES.map((state) => (
                    <option key={state}>{state}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="lbl" htmlFor={fieldId('ein')}>
                  EIN
                </label>
                <input
                  className="field num"
                  {...fieldProps('ein')}
                  aria-describedby={`${fieldId('ein')}-help${feedback.errors.ein ? ` ${fieldId('ein')}-error` : ''}`}
                  inputMode="numeric"
                  autoComplete="off"
                  required
                  value={values.ein}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 9);
                    change(
                      'ein',
                      digits.length > 2 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : digits
                    );
                  }}
                />
                {error('ein')}
                <p id={`${fieldId('ein')}-help`} className="help">
                  9 digits, written 12-3456789. We keep only the last four digits.
                </p>
              </div>
            </div>
            <div>
              <label className="lbl" htmlFor={fieldId('web')}>
                Website or business Instagram
              </label>
              <input
                className="field"
                {...fieldProps('web')}
                required
                maxLength={300}
                value={values.web}
                onChange={(e) => change('web', e.target.value)}
                placeholder="yourbusiness.com or @yourbusiness"
              />
              {error('web')}
            </div>
          </>
        )}
        {step === 2 && details && (
          <>
            {values.type === 'pm' ? (
              <>
                <div>
                  <label className="lbl" htmlFor={fieldId('company')}>
                    Company you're buying for
                  </label>
                  <input
                    className="field"
                    {...fieldProps('company')}
                    autoComplete="organization"
                    required
                    value={values.company}
                    onChange={(e) => change('company', e.target.value)}
                  />
                  {error('company')}
                </div>
                <div>
                  <label className="lbl" htmlFor={fieldId('email')}>
                    Work email at that company
                  </label>
                  <input
                    className="field"
                    {...fieldProps('email')}
                    type="email"
                    autoComplete="email"
                    required
                    value={values.email}
                    onChange={(e) => change('email', e.target.value)}
                  />
                  {error('email')}
                </div>
              </>
            ) : (
              <div>
                <label className="lbl" htmlFor={fieldId('cred')}>
                  {details.cred}
                </label>
                <input
                  className="field"
                  {...fieldProps('cred')}
                  required
                  maxLength={500}
                  value={values.cred}
                  onChange={(e) => change('cred', e.target.value)}
                />
                {error('cred')}
              </div>
            )}
            <p className="note">{details.how}</p>
          </>
        )}
        {step === 3 && (
          <>
            <p className="mute">
              Only for businesses reselling the furniture, like designers billing clients or
              retailers. A restaurant furnishing its own dining room usually pays sales tax.
            </p>
            <label className="delivery-check">
              <input
                type="checkbox"
                checked={values.tax}
                onChange={(e) => change('tax', e.target.checked)}
              />
              <span>I have a resale or exemption certificate</span>
            </label>
            {values.tax && (
              <div>
                <label className="lbl" htmlFor={fieldId('cert')}>
                  Certificate (PDF or photo, up to 10 MB)
                </label>
                <input
                  {...fieldProps('cert')}
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    if (file && file.size > 10 * 1024 * 1024) {
                      e.target.value = '';
                      change('cert', null);
                      feedback.report({ cert: 'Use a certificate file no larger than 10 MB.' });
                    } else change('cert', file);
                  }}
                />
                {values.cert && <p className="help">Attached: {values.cert.name}</p>}
                {error('cert')}
              </div>
            )}
          </>
        )}
        {step === 4 && (
          <>
            <dl className="specs" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {[
                ['Business type', details?.l],
                ['Legal name', values.name],
                ['State', values.state],
                ['EIN', `••-•••${values.ein.slice(-4)}`],
                ['Online', values.web],
                [
                  'Credential',
                  values.type === 'pm' ? `${values.company} · ${values.email}` : values.cred,
                ],
                [
                  'Tax exemption',
                  values.tax
                    ? values.cert
                      ? 'Certificate attached'
                      : 'Certificate needed'
                    : 'Not requested',
                ],
                ['Pricing', 'Eligible trade pricing, once approved'],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="help">
              By submitting you agree to the trade terms. Orders ship and bill to the verified
              business.
            </p>
          </>
        )}
      </fieldset>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
        {step > 0 ? (
          <button
            type="button"
            className="btn btn-line"
            disabled={busy}
            onClick={() => {
              feedback.reset();
              setStep(step - 1);
            }}
          >
            Back
          </button>
        ) : (
          <span />
        )}
        <button className="btn btn-ink btn-lg" disabled={busy}>
          {busy ? 'Submitting…' : step === 4 ? 'Submit application' : 'Continue'}
        </button>
      </div>
    </form>
  );
}
