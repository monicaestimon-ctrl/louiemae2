import React, { useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { customerMessage } from '../../lib/errors';
import { LEDGER_STATE_LABEL, TIER_LABEL } from '../../lib/vocabulary';

// v2 partner portal (spec S33/S34, v2 §20). One component serves the Creator Hub on louiemae.com
// and the Referrals & Earnings section of the House of Louie Mae Trade Hub: one login, one
// beneficiary, one ledger. Plain markup with inline layout so it renders on both sites.

const money = (minor: number) => `${minor < 0 ? '−' : ''}$${(Math.abs(minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;
const box: React.CSSProperties = { border: '1px solid rgba(0,0,0,0.12)', borderRadius: 8, padding: 16, display: 'grid', gap: 10 };
const btn: React.CSSProperties = { padding: '10px 16px', border: '1px solid currentColor', background: 'transparent', cursor: 'pointer', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', justifySelf: 'start' };
const input: React.CSSProperties = { padding: '8px 10px', border: '1px solid rgba(0,0,0,0.2)', fontSize: 14, width: '100%' };

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

function Enrollment({ site }: { site: 'creators' | 'trade' }) {
  const programs = useQuery(api.prgMemberships.myPrograms);
  const start = useMutation(api.prgMemberships.creatorStart);
  const saveProfile = useMutation(api.prgMemberships.creatorProfile);
  const accept = useMutation(api.prgMemberships.creatorAcceptTerms);
  const activateTrade = useMutation(api.prgMemberships.activateTradeReferrals);
  const [name, setName] = useState('');
  const [urls, setUrls] = useState('');
  const [agree, setAgree] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (programs === undefined) return <Status>Loading your programs…</Status>;
  if (programs === null) return <Status>Sign in to join the Creator Program or turn on referrals for your trade account.</Status>;
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg(customerMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const creator = programs.creator;
  const trade = programs.trade;
  const termsReady = !!programs.creatorTerms && !!programs.referralTerms;
  // Approved trade members turn on referrals in the same account (no creator account needed).
  if (site === 'trade' && trade?.state === 'approved' && !trade.referralActivated && !creator) {
    return (
      <section style={box} aria-labelledby="ref-on">
        <h3 id="ref-on" style={{ margin: 0 }}>Earn on retail referrals</h3>
        <p style={{ margin: 0 }}>Share Louie Mae retail links with your clients and followers. Your trade purchases keep their trade pricing; referral commission is earned only on retail orders placed through your links.</p>
        <label style={{ display: 'flex', gap: 8, alignItems: 'start' }}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            I accept the <a href="/trade#partner-terms">retail referral terms</a> (version {programs.referralTerms?.version ?? '—'}) and will label posts with my link, for example "#ad".
          </span>
        </label>
        <button style={btn} disabled={!agree || busy || !programs.referralTerms} onClick={() => run(() => activateTrade({ referralTermsId: programs.referralTerms!._id }))}>
          Turn on referrals
        </button>
        {msg && <Status>{msg}</Status>}
      </section>
    );
  }
  if (!creator && site === 'creators')
    return (
      <section style={box} aria-labelledby="join">
        <h3 id="join" style={{ margin: 0 }}>Join the Creator Program</h3>
        <p style={{ margin: 0 }}>Free to join. No follower minimum. You earn commission on eligible retail orders placed through your links. Trade pricing is separate and needs a verified business.</p>
        <button style={btn} disabled={busy} onClick={() => run(() => start({}))}>
          Start
        </button>
        {msg && <Status>{msg}</Status>}
      </section>
    );
  if (!creator) return null;
  if (creator.state === 'email_unverified') return <Status>Verify your email address to continue. We sent you a link.</Status>;
  if (creator.state === 'profile')
    return (
      <form
        style={box}
        aria-labelledby="profile"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => saveProfile({ displayName: name, urls: urls.split(/\s+/).filter(Boolean) }));
        }}
      >
        <h3 id="profile" style={{ margin: 0 }}>About you</h3>
        <label>
          Name or handle
          <input style={input} required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
        <label>
          Your profiles or site (one per line)
          <textarea style={{ ...input, minHeight: 70 }} required value={urls} onChange={(e) => setUrls(e.target.value)} />
        </label>
        <button style={btn} type="submit" disabled={busy}>
          Continue
        </button>
        {msg && <Status>{msg}</Status>}
      </form>
    );
  if (creator.state === 'terms')
    return (
      <section style={box} aria-labelledby="terms">
        <h3 id="terms" style={{ margin: 0 }}>Program terms</h3>
        {!termsReady && <Status>The program terms are being finalized. Enrollment opens when they are published.</Status>}
        <label style={{ display: 'flex', gap: 8, alignItems: 'start' }}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            I accept the <a href="/trade#partner-terms">Creator Program and retail referral terms</a> and will disclose my links, for example "#ad — I earn a commission".
          </span>
        </label>
        <button style={btn} disabled={!agree || busy || !termsReady} onClick={() => run(() => accept({ creatorTermsId: programs.creatorTerms!._id, referralTermsId: programs.referralTerms!._id }))}>
          Join
        </button>
        {msg && <Status>{msg}</Status>}
      </section>
    );
  if (creator.state === 'review') return <Status>Thanks — we review some new accounts by hand and will email you shortly.</Status>;
  if (creator.state === 'suspended' || creator.state === 'closed') return <Status>Your creator account isn't active. Contact withlove@louiemae.com.</Status>;
  return null;
}

function LinkBuilder() {
  const create = useMutation(api.prgLinks.create);
  const catalog = useQuery(api.retailLaunch.storefrontPage, { paginationOpts: { numItems: 100, cursor: null } });
  const [target, setTarget] = useState<string>('/');
  const [channel, setChannel] = useState('link');
  const [out, setOut] = useState<{ url: string; label: string; rate?: number; note?: string | null; disclosure: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const products = (catalog?.page ?? []).flatMap((p) => (p.variants ?? []).map((v) => ({ key: `p:${p._id}:${v.id}`, label: `${p.name}${v.name && v.name !== 'Default Title' ? ` — ${v.name}` : ''}` })));
  const build = async () => {
    setMsg(null);
    setOut(null);
    setCopied(false);
    try {
      if (target.startsWith('p:')) {
        const [, productId, variantId] = target.split(':');
        const r = await create({ productId: productId as never, variantId, channelTag: channel });
        setOut({ url: r.url, label: r.destination, rate: 'applicableRateBps' in r ? r.applicableRateBps : undefined, note: 'exceptionNote' in r ? r.exceptionNote : null, disclosure: r.disclosureExample });
      } else {
        const r = await create({ path: target, channelTag: channel });
        setOut({ url: r.url, label: r.destination, disclosure: r.disclosureExample });
      }
    } catch (e) {
      setMsg(customerMessage(e));
    }
  };
  return (
    <section style={box} aria-labelledby="links">
      <h3 id="links" style={{ margin: 0 }}>Copy retail referral link</h3>
      <label>
        Link to
        <select style={input} value={target} onChange={(e) => setTarget(e.target.value)}>
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
        <select style={input} value={channel} onChange={(e) => setChannel(e.target.value)}>
          {CHANNELS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <button style={btn} onClick={build}>
        Make link
      </button>
      <div aria-live="polite">
        {msg && <p style={{ margin: 0 }}>{msg}</p>}
        {out && (
          <div style={{ display: 'grid', gap: 6 }}>
            <code style={{ wordBreak: 'break-all' }}>{out.url}</code>
            <span>Goes to: {out.label}</span>
            {out.rate !== undefined && <span>Your rate on this piece: {pct(out.rate)}{out.note ? ` · ${out.note}` : ''}</span>}
            <span>Disclosure example: “{out.disclosure}” — use it on posts, Stories and video.</span>
            <button
              style={btn}
              onClick={async () => {
                await navigator.clipboard.writeText(out.url).catch(() => undefined);
                setCopied(true);
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
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
      <h3 id="earnings" style={{ margin: 0 }}>Referrals & earnings</h3>
      {tier && (
        <p style={{ margin: 0 }}>
          Tier: <b>{TIER_LABEL[tier.tier]}</b>
          {tier.next ? ` · ${money(tier.toNextMinor)} more in eligible sales to reach ${TIER_LABEL[tier.next]}` : ' · Top of the program'}
        </p>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <caption style={{ textAlign: 'left', fontSize: 12, opacity: 0.7 }}>Your balances</caption>
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
      <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>Commission clears 30 days after payment. Cleared balances of $50 or more are sent on the 15th to your connected Stripe account; Stripe then pays your bank on its own schedule.</p>
      {earnings.entries.length === 0 ? (
        <p style={{ margin: 0 }}>No attributed orders yet. Share a link to get started.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <caption style={{ textAlign: 'left', fontSize: 12, opacity: 0.7 }}>Orders through your links (no buyer details are shown)</caption>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: 'left' }}>Order</th>
              <th scope="col" style={{ textAlign: 'left' }}>Date</th>
              <th scope="col" style={{ textAlign: 'right' }}>Rate</th>
              <th scope="col" style={{ textAlign: 'right' }}>Earned</th>
              <th scope="col" style={{ textAlign: 'left' }}>Status</th>
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
      )}
      <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>Click counts are informational; only paid, eligible orders earn commission.</p>
      {credit && (credit.availableMinor > 0 || credit.pendingAwardMinor > 0) && (
        <p style={{ margin: 0 }}>
          Store credit: {money(credit.availableMinor)} available{credit.pendingAwardMinor ? `, ${money(credit.pendingAwardMinor)} pending` : ''}. {credit.terms}
        </p>
      )}
    </section>
  );
}

function Payouts({ site }: { site: 'creators' | 'trade' }) {
  const programs = useQuery(api.prgMemberships.myPrograms);
  const start = useAction(api.holmConnect.startPayoutSetup);
  const [msg, setMsg] = useState<string | null>(null);
  const b = programs?.beneficiary;
  if (!b) return null;
  const label = { not_started: 'Not set up', pending: 'Finishing setup with Stripe', ready: 'Ready', restricted: 'Stripe needs more details' }[b.payoutReadiness];
  return (
    <section style={box} aria-labelledby="payouts">
      <h3 id="payouts" style={{ margin: 0 }}>Payouts and tax</h3>
      <p style={{ margin: 0 }}>Payout account: {label}. Stripe collects your tax details and bank account; we never see or store bank details.</p>
      {b.payoutReadiness !== 'ready' && (
        <button
          style={btn}
          onClick={async () => {
            try {
              window.location.href = await start({ returnTo: site });
            } catch (e) {
              setMsg(customerMessage(e));
            }
          }}
        >
          Set up payouts
        </button>
      )}
      {msg && <Status>{msg}</Status>}
      <p style={{ margin: 0, fontSize: 12 }}>
        Terms: <a href="/trade#partner-terms">partner terms</a> · Support: <a href="mailto:withlove@louiemae.com">withlove@louiemae.com</a>
      </p>
    </section>
  );
}

/** The whole v2 program area for a signed-in person. */
export default function ProgramHubV2({ site }: { site: 'creators' | 'trade' }) {
  const flags = useQuery(api.v2Admin.publicFlags);
  const programs = useQuery(api.prgMemberships.myPrograms);
  if (flags === undefined || programs === undefined) return <Status>Loading…</Status>;
  const active = programs?.creator?.state === 'active' || (programs?.trade?.state === 'approved' && programs.trade.referralActivated);
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Enrollment site={site} />
      {active && flags.retailLinks && <LinkBuilder />}
      {active && !flags.retailLinks && <Status>Retail referral links open soon. Your account is ready.</Status>}
      {active && flags.ledger && <Earnings />}
      {active && <Payouts site={site} />}
    </div>
  );
}

/** Trade Hub: business team seats (owner manages purchasing members and read-only collaborators). */
export function TeamPanel() {
  const orgs = useQuery(api.prgMemberships.myOrganizations);
  const invite = useMutation(api.prgMemberships.inviteMember);
  const setRole = useMutation(api.prgMemberships.setMemberRole);
  const [email, setEmail] = useState('');
  const [role, setRoleSel] = useState<'purchasing' | 'readonly'>('purchasing');
  const [msg, setMsg] = useState<string | null>(null);
  if (!orgs?.length) return null;
  return (
    <>
      {orgs.map((o) => (
        <section key={o.organizationId} style={box} aria-label={`${o.name} team`}>
          <h3 style={{ margin: 0 }}>{o.name} · your role: {o.role === 'owner' ? 'Owner' : o.role === 'purchasing' ? 'Purchasing member' : 'Read-only collaborator'}</h3>
          {o.role === 'owner' && (
            <>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {o.members.map((m) => (
                  <li key={m.userId}>
                    {m.email} — {m.role}
                    {m.status === 'invited' ? ' (invited)' : ''}
                    {m.role !== 'owner' && (
                      <button style={{ ...btn, marginLeft: 8, padding: '2px 8px' }} onClick={() => setRole({ organizationId: o.organizationId, userId: m.userId, role: 'removed' }).catch((e) => setMsg(customerMessage(e)))}>
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <form
                style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await invite({ organizationId: o.organizationId, email, role });
                    setMsg('Invitation sent if that person has an account.');
                    setEmail('');
                  } catch (err) {
                    setMsg(customerMessage(err));
                  }
                }}
              >
                <label style={{ flex: 1 }}>
                  Invite by email
                  <input style={input} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </label>
                <label>
                  Role
                  <select style={input} value={role} onChange={(e) => setRoleSel(e.target.value as 'purchasing' | 'readonly')}>
                    <option value="purchasing">Purchasing member</option>
                    <option value="readonly">Read-only collaborator</option>
                  </select>
                </label>
                <button style={btn} type="submit">
                  Invite
                </button>
              </form>
            </>
          )}
          {msg && <Status>{msg}</Status>}
        </section>
      ))}
    </>
  );
}
