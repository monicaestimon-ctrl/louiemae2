import React, { useId, useRef, useState } from 'react';
import { profileFieldProblems } from '../../lib/enrollment';
import { useFormValidation } from '../forms/useFormValidation';
import { ValidationSummary } from '../forms/ValidationSummary';
import '../delivery/forms.css';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { FunctionReturnType } from 'convex/server';
import { customerMessage } from '../../lib/errors';
import { LEDGER_STATE_LABEL, TIER_LABEL } from '../../lib/vocabulary';

// v2 partner portal (spec S33/S34, v2 §20). One component serves the Creator Hub on louiemae.com
// and the Referrals & Earnings section of the House of Louie Mae Trade Hub: one login, one
// beneficiary, one ledger. Plain markup with inline layout so it renders on both sites.

const money = (minor: number) =>
  `${minor < 0 ? '−' : ''}$${(Math.abs(minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;
const box: React.CSSProperties = {
  border: '1px solid rgba(0,0,0,0.12)',
  borderRadius: 8,
  padding: 16,
  display: 'grid',
  gap: 10,
  minWidth: 0,
};
const btn: React.CSSProperties = {
  padding: '10px 16px',
  border: '1px solid currentColor',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 12,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  justifySelf: 'start',
};
const input: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid rgba(0,0,0,0.2)',
  fontSize: 14,
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
};

const PAGES: [string, string][] = [
  ['/', 'Louie Mae home'],
  ['/#shop', 'Shop'],
  ['/#collection/furniture', 'Furniture'],
  ['/#collection/decor', 'Home décor'],
  ['/#new-arrivals', 'New arrivals'],
];
const CHANNELS: [string, string][] = [
  ['story', 'Instagram Story'],
  ['pin', 'Pinterest'],
  ['post', 'Social post'],
  ['link', 'Link in bio or blog'],
  ['share', 'Message or email'],
  ['qr', 'QR code'],
];

function Status({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" aria-live="polite" style={{ margin: 0, fontSize: 14 }}>
      {children}
    </p>
  );
}

/** Collect validated profile details and explicit terms acceptance without duplicate membership commands. */
function Enrollment({ site }: { site: 'creators' | 'trade' }) {
  const programs = useQuery(api.prgMemberships.myPrograms);
  const start = useMutation(api.prgMemberships.creatorStart);
  const saveProfile = useMutation(api.prgMemberships.creatorProfile);
  const accept = useMutation(api.prgMemberships.creatorAcceptTerms);
  const activateTrade = useMutation(api.prgMemberships.activateTradeReferrals);
  const [name, setName] = useState('');
  const [urls, setUrls] = useState('');
  const [agree, setAgree] = useState(false);
  const id = useId();
  const pending = useRef(false);
  const feedback = useFormValidation<'name' | 'urls' | '_form'>();
  const summary = <ValidationSummary summaryRef={feedback.summaryRef} entries={[{label:'Name or handle',fieldId:`${id}-name`,message:feedback.errors.name},{label:'Profiles or website',fieldId:`${id}-urls`,message:feedback.errors.urls},{message:feedback.errors._form}]} />;
  const [busy, setBusy] = useState(false);
  if (programs === undefined) return <Status>Loading your programs…</Status>;
  if (programs === null) return <Status>Sign in to join the Creator Program or turn on referrals for your trade account.</Status>;
  const run = async (fn: () => Promise<unknown>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    feedback.reset();
    try {
      await fn();
    } catch (e) {
      feedback.report({_form:customerMessage(e)});
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const creator = programs.creator;
  const trade = programs.trade;
  const termsReady = !!programs.creatorTerms && !!programs.referralTerms;
  // Approved trade members turn on referrals in the same account (no creator account needed).
  if (site === 'trade' && trade?.state === 'approved' && !trade.referralActivated && !creator) {
    return (
      <section className="delivery-ui" style={box} aria-labelledby="ref-on">
        <h3 id="ref-on" style={{ margin: 0 }}>Earn on retail referrals</h3>
        <p style={{ margin: 0 }}>Share Louie Mae retail links with your clients and followers. Your trade purchases keep their trade pricing; referral commission is earned only on retail orders placed through your links.</p>
        <label style={{ display: 'flex', gap: 8, alignItems: 'start' }}>
          <input type="checkbox" disabled={busy} checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            I accept the <a href="/trade#partner-terms">retail referral terms</a> (version {programs.referralTerms?.version ?? '—'}) and will label posts with my link, for example "#ad".
          </span>
        </label>
        <button style={btn} disabled={!agree || busy || !programs.referralTerms} onClick={() => run(() => activateTrade({ referralTermsId: programs.referralTerms!._id }))}>
          Turn on referrals
        </button>
        {summary}
      </section>
    );
  }
  if (!creator && site === 'creators')
    return (
      <section className="delivery-ui" style={box} aria-labelledby="join">
        <h3 id="join" style={{ margin: 0 }}>Join the Creator Program</h3>
        <p style={{ margin: 0 }}>Free to join. No follower minimum. You earn commission on eligible retail orders placed through your links. Trade pricing is separate and needs a verified business.</p>
        <button style={btn} disabled={busy} onClick={() => run(() => start({}))}>
          Start
        </button>
        {summary}
      </section>
    );
  if (!creator) return null;
  if (creator.state === 'email_unverified') return <Status>Verify your email address to continue. We sent you a link.</Status>;
  if (creator.state === 'profile')
    return (
      <form
        style={box}
        className="delivery-ui"
        noValidate
        aria-busy={busy}
        aria-labelledby={`${id}-profile`}
        onSubmit={(e) => {
          e.preventDefault();
          const profile={displayName:name,urls:urls.split(/\s+/).filter(Boolean)};
          const problems=profileFieldProblems(profile);
          if(problems.name.length||problems.urls.length){feedback.report({...(problems.name.length?{name:problems.name.join(' ')}:{}),...(problems.urls.length?{urls:problems.urls.join(' ')}:{})});return;}
          void run(() => saveProfile(profile));
        }}
      >
        <h3 id={`${id}-profile`} style={{ margin: 0 }}>About you</h3>
        {summary}
        <div><label htmlFor={`${id}-name`}>Name or handle</label>
          <input id={`${id}-name`} style={input} required maxLength={80} disabled={busy} value={name} onChange={(e) => {setName(e.target.value);feedback.clear('name');feedback.clear('_form');}} autoComplete="name" aria-invalid={!!feedback.errors.name} aria-describedby={feedback.errors.name?`${id}-name-error`:undefined}/>
          {feedback.errors.name&&<p id={`${id}-name-error`} className="delivery-error">{feedback.errors.name}</p>}
        </div>
        <div><label htmlFor={`${id}-urls`}>Your profiles or site (one per line)</label>
          <textarea id={`${id}-urls`} style={{ ...input, minHeight: 70 }} required disabled={busy} value={urls} onChange={(e) => {setUrls(e.target.value);feedback.clear('urls');feedback.clear('_form');}} aria-invalid={!!feedback.errors.urls} aria-describedby={`${id}-urls-help${feedback.errors.urls?` ${id}-urls-error`:''}`} />
          <p id={`${id}-urls-help`} className="delivery-note">Add up to five full web links, including https://.</p>
          {feedback.errors.urls&&<p id={`${id}-urls-error`} className="delivery-error">{feedback.errors.urls}</p>}
        </div>
        <button style={btn} type="submit" disabled={busy}>
          Continue
        </button>
      </form>
    );
  if (creator.state === 'terms')
    return (
      <section className="delivery-ui" style={box} aria-labelledby="terms">
        <h3 id="terms" style={{ margin: 0 }}>Program terms</h3>
        {!termsReady && <Status>The program terms are being finalized. Enrollment opens when they are published.</Status>}
        <label style={{ display: 'flex', gap: 8, alignItems: 'start' }}>
          <input type="checkbox" disabled={busy} checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            I accept the <a href="/trade#partner-terms">Creator Program and retail referral terms</a> and will disclose my links, for example "#ad — I earn a commission".
          </span>
        </label>
        <button style={btn} disabled={!agree || busy || !termsReady} onClick={() => run(() => accept({ creatorTermsId: programs.creatorTerms!._id, referralTermsId: programs.referralTerms!._id }))}>
          Join
        </button>
        {summary}
      </section>
    );
  if (creator.state === 'review') return <Status>Thanks — we review some new accounts by hand and will email you shortly.</Status>;
  if (creator.state === 'suspended' || creator.state === 'closed') return <Status>Your creator account isn't active. Contact withlove@louiemae.com.</Status>;
  return null;
}

function LinkBuilder() {
  const create = useMutation(api.prgLinks.create);
  const catalog = useQuery(api.retailLaunch.storefrontPage, {
    paginationOpts: { numItems: 100, cursor: null },
  });
  const [target, setTarget] = useState<string>('/');
  const [channel, setChannel] = useState('link');
  const [out, setOut] = useState<{
    url: string;
    label: string;
    rate?: number;
    note?: string | null;
    disclosure: string;
  } | null>(null);
  const feedback = useFormValidation<'_form'>();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const headingId = useId();
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const products = (catalog?.page ?? []).flatMap((p) =>
    (p.variants ?? []).map((v) => ({
      key: `p:${p._id}:${v.id}`,
      label: `${p.name}${v.name && v.name !== 'Default Title' ? ` — ${v.name}` : ''}`,
    }))
  );
  const build = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    feedback.reset();
    setOut(null);
    setCopied(false);
    try {
      if (target.startsWith('p:')) {
        const [, productId, variantId] = target.split(':');
        const r = await create({ productId: productId as never, variantId, channelTag: channel });
        setOut({
          url: r.url,
          label: r.destination,
          rate: 'applicableRateBps' in r ? r.applicableRateBps : undefined,
          note: 'exceptionNote' in r ? r.exceptionNote : null,
          disclosure: r.disclosureExample,
        });
      } else {
        const r = await create({ path: target, channelTag: channel });
        setOut({ url: r.url, label: r.destination, disclosure: r.disclosureExample });
      }
    } catch (e) {
      feedback.report({ _form: customerMessage(e) });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <section style={box} className="delivery-ui" aria-labelledby={headingId}>
      <h3 id={headingId} style={{ margin: 0 }}>
        Copy retail referral link
      </h3>
      <label>
        Link to
        <select
          style={input}
          disabled={busy || copying}
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            setOut(null);
            setCopied(false);
            feedback.reset();
          }}
        >
          <optgroup label="Pages">
            {PAGES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </optgroup>
          {products.length > 0 && (
            <optgroup label="Pieces">
              {products.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <label>
        Where you'll share it
        <select
          style={input}
          disabled={busy || copying}
          value={channel}
          onChange={(e) => {
            setChannel(e.target.value);
            setOut(null);
            setCopied(false);
            feedback.reset();
          }}
        >
          {CHANNELS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <button style={btn} disabled={busy || copying} onClick={build}>
        {busy ? 'Making link…' : 'Make link'}
      </button>
      <ValidationSummary
        summaryRef={feedback.summaryRef}
        entries={[{ message: feedback.errors._form }]}
      />
      <div aria-live="polite">
        {out && (
          <div style={{ display: 'grid', gap: 6 }}>
            <code style={{ wordBreak: 'break-all' }}>{out.url}</code>
            <span>Goes to: {out.label}</span>
            {out.rate !== undefined && (
              <span>
                Your rate on this piece: {pct(out.rate)}
                {out.note ? ` · ${out.note}` : ''}
              </span>
            )}
            <span>
              Disclosure example: “{out.disclosure}” — use it on posts, Stories and video.
            </span>
            <button
              style={btn}
              disabled={busy || copying}
              onClick={async () => {
                if (pending.current) return;
                pending.current = true;
                setCopying(true);
                setCopied(false);
                feedback.reset();
                try {
                  await navigator.clipboard.writeText(out.url);
                  setCopied(true);
                } catch {
                  feedback.report({
                    _form: 'Clipboard access is unavailable. Select and copy the link above.',
                  });
                } finally {
                  pending.current = false;
                  setCopying(false);
                }
              }}
            >
              {copying ? 'Copying…' : copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function Earnings() {
  const tier = useQuery(api.prgTiers.myTier);
  const earnings = useQuery(api.ldgCommissions.myEarnings);
  const credit = useQuery(api.ldgCredits.myCreditV2);
  if (earnings === undefined || tier === undefined) return <Status>Loading earnings…</Status>;
  if (!earnings) return null;
  const t = earnings.totals;
  return (
    <section style={box} aria-labelledby="earnings">
      <h3 id="earnings" style={{ margin: 0 }}>
        Referrals & earnings
      </h3>
      {tier && (
        <p style={{ margin: 0 }}>
          Tier: <b>{TIER_LABEL[tier.tier]}</b>
          {tier.next
            ? ` · ${money(tier.toNextMinor)} more in eligible sales to reach ${TIER_LABEL[tier.next]}`
            : ' · Top of the program'}
        </p>
      )}
      <div
        role="region"
        aria-label="Your balances"
        tabIndex={0}
        style={{ overflowX: 'auto', minWidth: 0 }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <caption style={{ textAlign: 'left', fontSize: 12, color: 'inherit' }}>
            Your balances
          </caption>
          <tbody>
            {(
              [
                ['pending', t.pending],
                ['held', t.held],
                ['cleared', t.cleared],
                ['reserved', t.reserved + t.submitted],
                ['transferred', t.transferred],
              ] as const
            ).map(([k, v]) => (
              <tr key={k}>
                <th scope="row" style={{ textAlign: 'left', fontWeight: 400, padding: '4px 0' }}>
                  {LEDGER_STATE_LABEL[k]}
                </th>
                <td style={{ textAlign: 'right' }}>{money(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: 'inherit' }}>
        Commission clears 30 days after payment. Cleared balances of $50 or more are sent on the
        15th to your connected Stripe account; Stripe then pays your bank on its own schedule.
      </p>
      {earnings.entries.length === 0 ? (
        <p style={{ margin: 0 }}>No attributed orders yet. Share a link to get started.</p>
      ) : (
        <div
          role="region"
          aria-label="Orders through your links"
          tabIndex={0}
          style={{ overflowX: 'auto', minWidth: 0 }}
        >
          <table style={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', fontSize: 13 }}>
            <caption style={{ textAlign: 'left', fontSize: 12, color: 'inherit' }}>
              Orders through your links (no buyer details are shown)
            </caption>
            <thead>
              <tr>
                <th scope="col" style={{ textAlign: 'left' }}>
                  Order
                </th>
                <th scope="col" style={{ textAlign: 'left' }}>
                  Date
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Rate
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Earned
                </th>
                <th scope="col" style={{ textAlign: 'left' }}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {earnings.entries.map((e, i) => (
                <tr key={i}>
                  <td>{e.ref}</td>
                  <td>{new Date(e.paidAt).toLocaleDateString()}</td>
                  <td style={{ textAlign: 'right' }}>{e.rateBps ? pct(e.rateBps) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{money(e.amountMinor)}</td>
                  <td>{LEDGER_STATE_LABEL[e.state] ?? e.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ margin: 0, fontSize: 12, color: 'inherit' }}>
        Click counts are informational; only paid, eligible orders earn commission.
      </p>
      {credit && (credit.availableMinor > 0 || credit.pendingAwardMinor > 0) && (
        <p style={{ margin: 0 }}>
          Store credit: {money(credit.availableMinor)} available
          {credit.pendingAwardMinor ? `, ${money(credit.pendingAwardMinor)} pending` : ''}.{' '}
          {credit.terms}
        </p>
      )}
    </section>
  );
}

function Payouts({ site }: { site: 'creators' | 'trade' }) {
  const programs = useQuery(api.prgMemberships.myPrograms);
  const start = useAction(api.holmConnect.startPayoutSetup);
  const feedback = useFormValidation<'_form'>();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const b = programs?.beneficiary;
  if (!b) return null;
  const label = {
    not_started: 'Not set up',
    pending: 'Finishing setup with Stripe',
    ready: 'Ready',
    restricted: 'Stripe needs more details',
  }[b.payoutReadiness];
  return (
    <section style={box} className="delivery-ui" aria-labelledby="payouts">
      <h3 id="payouts" style={{ margin: 0 }}>
        Payouts and tax
      </h3>
      <p style={{ margin: 0 }}>
        Payout account: {label}. Stripe collects your tax details and bank account; we never see or
        store bank details.
      </p>
      {b.payoutReadiness !== 'ready' && (
        <button
          style={btn}
          disabled={busy}
          onClick={async () => {
            if (pending.current) return;
            pending.current = true;
            setBusy(true);
            feedback.reset();
            try {
              window.location.href = await start({ returnTo: site });
            } catch (e) {
              feedback.report({ _form: customerMessage(e) });
            } finally {
              pending.current = false;
              setBusy(false);
            }
          }}
        >
          {busy ? 'Opening payout setup…' : 'Set up payouts'}
        </button>
      )}
      <ValidationSummary
        summaryRef={feedback.summaryRef}
        entries={[{ message: feedback.errors._form }]}
      />
      <p style={{ margin: 0, fontSize: 12 }}>
        Terms: <a href="/trade#partner-terms">partner terms</a> · Support:{' '}
        <a href="mailto:withlove@louiemae.com">withlove@louiemae.com</a>
      </p>
    </section>
  );
}

/** The whole v2 program area for a signed-in person. */
export default function ProgramHubV2({ site }: { site: 'creators' | 'trade' }) {
  const flags = useQuery(api.v2Admin.publicFlags);
  const programs = useQuery(api.prgMemberships.myPrograms);
  if (flags === undefined || programs === undefined) return <Status>Loading…</Status>;
  const active =
    programs?.creator?.state === 'active' ||
    (programs?.trade?.state === 'approved' && programs.trade.referralActivated);
  return (
    <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
      <Enrollment site={site} />
      {active && flags.retailLinks && <LinkBuilder />}
      {active && !flags.retailLinks && (
        <Status>Retail referral links open soon. Your account is ready.</Status>
      )}
      {active && flags.ledger && <Earnings />}
      {active && <Payouts site={site} />}
    </div>
  );
}

type Organization = FunctionReturnType<typeof api.prgMemberships.myOrganizations>[number];

/** Keep each business draft and command state isolated across team memberships. */
function OrganizationTeam({ organization: o }: { organization: Organization }) {
  const invite = useMutation(api.prgMemberships.inviteMember);
  const setRole = useMutation(api.prgMemberships.setMemberRole);
  const [email, setEmail] = useState('');
  const [role, setRoleSel] = useState<'purchasing' | 'readonly'>('purchasing');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const id = useId();
  const feedback = useFormValidation<'email' | '_form'>();
  const run = async (command: () => Promise<unknown>, success: string) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setNotice('');
    feedback.reset();
    try {
      await command();
      setNotice(success);
    } catch (error) {
      feedback.report({ _form: customerMessage(error) });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <section style={box} className="delivery-ui" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`} style={{ margin: 0 }}>
        {o.name} · your role:{' '}
        {o.role === 'owner'
          ? 'Owner'
          : o.role === 'purchasing'
            ? 'Purchasing member'
            : 'Read-only collaborator'}
      </h3>
      <ValidationSummary
        summaryRef={feedback.summaryRef}
        entries={[
          { label: 'Invite by email', fieldId: `${id}-email`, message: feedback.errors.email },
          { message: feedback.errors._form },
        ]}
      />
      {o.role === 'owner' && (
        <>
          <ul style={{ margin: 0, paddingLeft: 18, overflowWrap: 'anywhere' }}>
            {o.members.map((m) => (
              <li key={m.userId}>
                {m.email} — {m.role}
                {m.status === 'invited' ? ' (invited)' : ''}
                {m.role !== 'owner' && (
                  <button
                    style={{ ...btn, marginLeft: 8 }}
                    disabled={busy}
                    aria-label={`Remove ${m.email || 'team member'}`}
                    onClick={() =>
                      void run(
                        () =>
                          setRole({
                            organizationId: o.organizationId,
                            userId: m.userId,
                            role: 'removed',
                          }),
                        'Team member removed.'
                      )
                    }
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          <form
            noValidate
            aria-label={`Invite to ${o.name}`}
            onSubmit={(e) => {
              e.preventDefault();
              if (pending.current) return;
              if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
                feedback.report({ email: 'Enter a valid email address.' });
                return;
              }
              void run(async () => {
                await invite({ organizationId: o.organizationId, email: email.trim(), role });
                setEmail('');
              }, 'Invitation sent if that person has an account.');
            }}
          >
            <fieldset
              disabled={busy}
              style={{
                border: 0,
                padding: 0,
                minWidth: 0,
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <legend className="sr">Invite a team member</legend>
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                <label htmlFor={`${id}-email`}>Invite by email</label>
                <input
                  id={`${id}-email`}
                  style={input}
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  aria-invalid={!!feedback.errors.email}
                  aria-describedby={feedback.errors.email ? `${id}-email-error` : undefined}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    feedback.clear('email');
                    feedback.clear('_form');
                    setNotice('');
                  }}
                />
                {feedback.errors.email && (
                  <p id={`${id}-email-error`} className="delivery-error">
                    {feedback.errors.email}
                  </p>
                )}
              </div>
              <label>
                Role
                <select
                  style={input}
                  value={role}
                  onChange={(e) => setRoleSel(e.target.value as 'purchasing' | 'readonly')}
                >
                  <option value="purchasing">Purchasing member</option>
                  <option value="readonly">Read-only collaborator</option>
                </select>
              </label>
              <button style={btn} type="submit">
                {busy ? 'Working…' : 'Invite'}
              </button>
            </fieldset>
          </form>
        </>
      )}
      <div role="status">{notice}</div>
    </section>
  );
}

/** Trade Hub: owner-managed seats with independent drafts and accessible command feedback. */
export function TeamPanel() {
  const orgs = useQuery(api.prgMemberships.myOrganizations);
  return (
    <>
      {orgs?.map((o) => (
        <OrganizationTeam key={o.organizationId} organization={o} />
      ))}
    </>
  );
}
