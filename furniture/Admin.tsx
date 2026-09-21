import React, { useEffect, useState } from 'react';
import { useAction, useConvexAuth, useMutation, useQuery } from 'convex/react';
import { useAuthActions } from '@convex-dev/auth/react';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import {
  blankFurniture,
  categories,
  estimate,
  range,
  supplierInquiry,
  type FurnitureDraft,
} from '../lib/furniture';
import { Brand } from './Catalog';
import { CommerceStudio } from '../components/CommerceStudio';
import { CommerceProjects } from '../components/CommerceProjects';

export default function Admin() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();
  const allowed = useQuery(api.furniture.access, isAuthenticated ? {} : 'skip');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    document.title = 'Furniture studio — House of Louie Mae';
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex,nofollow';
    document.head.append(meta);
    return () => meta.remove();
  }, []);
  return (
    <div className="fh">
      <header className="fh-header">
        <Brand />
        <nav>
          <a href="/furniture">View catalog ↗</a>
          {isAuthenticated && <button onClick={() => void signOut()}>Sign out</button>}
        </nav>
      </header>
      <main className="fh-shell fh-admin">
        <p className="fh-eyebrow">HOUSE OF LOUIE MAE / PRIVATE STUDIO</p>
        <h1>Furniture, thoughtfully gathered.</h1>
        {isLoading ? (
          <p>Checking your session…</p>
        ) : !isAuthenticated ? (
          <form
            className="fh-form fh-login"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await signIn('password', new FormData(e.currentTarget));
              } catch {
                setError('Sign-in failed. Use your existing authorized admin account.');
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2>Sign in to your studio</h2>
            <input type="hidden" name="flow" value="signIn" />
            <label>
              Email
              <input name="email" type="email" required autoComplete="username" />
            </label>
            <label>
              Password
              <input name="password" type="password" required autoComplete="current-password" />
            </label>
            {error && <p role="alert">{error}</p>}
            <button className="fh-primary" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : allowed === undefined ? (
          <p>Checking admin access…</p>
        ) : !allowed ? (
          <p role="alert">
            This account is not on the admin allowlist. Use the same authorized account as the
            existing store admin.
          </p>
        ) : (
          <Studio />
        )}
      </main>
    </div>
  );
}
function Studio() {
  const products = useQuery(api.furniture.adminProducts);
  const requests = useQuery(api.furniture.requests);
  const importUrl = useAction(api.furnitureImport.fromUrl);
  const save = useMutation(api.furniture.save);
  const updateStatus = useMutation(api.furniture.setStatus);
  const retry = useMutation(api.furniture.retryEmail);
  const [tab, setTab] = useState('shared');
  const [url, setUrl] = useState('');
  const [draft, setDraft] = useState<FurnitureDraft | null>(null);
  const [id, setId] = useState<Id<'furnitureProducts'> | undefined>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const edit = (p: FurnitureDraft & { _id: Id<'furnitureProducts'> }) => {
    const clean = Object.fromEntries(
      Object.keys(blankFurniture()).map((k) => [k, p[k as keyof FurnitureDraft]])
    ) as FurnitureDraft;
    setId(p._id);
    setDraft(clean);
    setWarnings([]);
    setNotice('');
  };
  const field = <K extends keyof FurnitureDraft>(key: K, value: FurnitureDraft[K]) =>
    setDraft((p) => (p ? { ...p, [key]: value } : p));
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setNotice('');
    try {
      await work();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="fh-filters">
        <button className={tab === 'shared' ? 'active' : ''} onClick={() => setTab('shared')}>Shared catalog & owner-managed imports</button>
        <button className={tab === 'projects' ? 'active' : ''} onClick={() => setTab('projects')}>Project quotes & fulfillment</button>
        <button className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}>
          Products ({products?.length || 0})
        </button>
        <button className={tab === 'quotes' ? 'active' : ''} onClick={() => setTab('quotes')}>
          Quote requests ({requests?.length || 0})
        </button>
      </div>
      <p className="fh-muted">
        This studio manages only the furniture page. Publishing here does not add products to the
        original store.
      </p>
      {notice && (
        <p className="fh-notice" role="status">
          {notice}
        </p>
      )}
      {tab === 'projects' ? <CommerceProjects /> : tab === 'shared' ? <CommerceStudio entry="house" /> : tab === 'products' ? (
        <>
          <form
            className="fh-import"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft && !confirm('Replace the current unsaved editor with a new import?'))
                return;
              void run(async () => {
                const result = await importUrl({ url });
                setDraft(result.product);
                setWarnings(result.warnings);
                setId(undefined);
              });
            }}
          >
            <label>
              Paste a supplier product URL
              <input
                type="url"
                required
                placeholder="https://detail.1688.com/offer/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <button className="fh-primary" disabled={busy}>
              {busy ? 'Working…' : 'Import draft'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (draft && !confirm('Discard unsaved edits?')) return;
                setDraft(blankFurniture());
                setId(undefined);
                setWarnings([]);
              }}
            >
              Add manually
            </button>
          </form>
          <p className="fh-muted">
            1688 imports use the existing API. Other public product pages are best-effort imports;
            account-only pricing must be entered manually. Import never publishes automatically.
          </p>
          {draft && (
            <form
              className="fh-editor fh-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await save({ id, product: draft });
                  setDraft(null);
                  setId(undefined);
                  setNotice(
                    draft.published
                      ? 'Product published to the furniture page.'
                      : 'Draft saved. It is not visible to customers.'
                  );
                });
              }}
            >
              <div className="fh-editor-heading">
                <h2>{id ? 'Edit piece' : 'Review imported piece'}</h2>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('Close without saving?')) setDraft(null);
                  }}
                >
                  Close editor
                </button>
              </div>
              {warnings.map((w) => (
                <p className="fh-notice" key={w}>
                  {w}
                </p>
              ))}
              <div className="fh-fields">
                <label>
                  Product name
                  <input
                    required
                    maxLength={200}
                    value={draft.name}
                    onChange={(e) => field('name', e.target.value)}
                  />
                </label>
                <label>
                  Furniture category
                  <select
                    value={draft.category}
                    onChange={(e) => field('category', e.target.value)}
                  >
                    {categories.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label className="fh-wide">
                  Customer description
                  <textarea
                    rows={4}
                    maxLength={8000}
                    value={draft.description}
                    onChange={(e) => field('description', e.target.value)}
                  />
                </label>
                <label>
                  Dimensions <small>Listing facts; do not infer from photos</small>
                  <input
                    value={draft.dimensions}
                    onChange={(e) => field('dimensions', e.target.value)}
                  />
                </label>
                <label>
                  Materials
                  <input
                    value={draft.materials}
                    onChange={(e) => field('materials', e.target.value)}
                  />
                </label>
              </div>
              <h3>Product images</h3>
              <div className="fh-admin-images">
                {draft.images.map((src, i) => (
                  <div key={`${src}-${i}`}>
                    <img src={src} alt={`Product image ${i + 1}`} />
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() =>
                        field('images', [src, ...draft.images.filter((_, n) => n !== i)])
                      }
                    >
                      {i === 0 ? 'Cover' : 'Make cover'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        field(
                          'images',
                          draft.images.filter((_, n) => n !== i)
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <label>
                Image URLs <small>One HTTPS URL per line; first image is the cover</small>
                <textarea
                  value={draft.images.join('\n')}
                  onChange={(e) =>
                    field(
                      'images',
                      e.target.value
                        .split('\n')
                        .map((s) => s.trim())
                        .filter(Boolean)
                    )
                  }
                />
              </label>
              <label className="fh-check">
                <input
                  type="checkbox"
                  checked={draft.imagePermission}
                  onChange={(e) => field('imagePermission', e.target.checked)}
                />{' '}
                I have permission to use these images.
              </label>
              <h3>Options & estimated prices</h3>
              <div className="fh-fields">
                <label>
                  Source currency
                  <input
                    value={draft.currency}
                    maxLength={3}
                    onChange={(e) => field('currency', e.target.value.toUpperCase())}
                  />
                </label>
                <label>
                  USD value of 1 source-currency unit
                  <input
                    type="number"
                    step="any"
                    min="0.000001"
                    required
                    value={draft.usdRate || ''}
                    onChange={(e) => field('usdRate', Number(e.target.value))}
                  />
                  <small>Enter your current rate. Saving timestamps this pricing snapshot.</small>
                </label>
              </div>
              <p className="fh-muted">
                Estimate = source cost × USD rate × 6, with $100 subtracted for the lower end. These
                are merchandise estimates only.
              </p>
              {draft.variants.map((variant, i) => {
                const prices = estimate(variant.cost, draft.usdRate);
                const change = (key: string, value: string | number) =>
                  field(
                    'variants',
                    draft.variants.map((v, n) => (n === i ? { ...v, [key]: value } : v))
                  );
                return (
                  <div className="fh-variant-editor" key={variant.id}>
                    <label>
                      Option
                      <input
                        value={variant.name}
                        required
                        onChange={(e) => change('name', e.target.value)}
                      />
                    </label>
                    <label>
                      Source cost
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={variant.cost}
                        onChange={(e) => change('cost', Number(e.target.value))}
                      />
                    </label>
                    <label>
                      Min. quantity
                      <input
                        type="number"
                        min="1"
                        max="9999"
                        value={variant.minimum}
                        onChange={(e) => change('minimum', Number(e.target.value))}
                      />
                    </label>
                    <span>{range(prices.lower, prices.upper)}</span>
                    <button
                      type="button"
                      disabled={draft.variants.length === 1}
                      onClick={() =>
                        field(
                          'variants',
                          draft.variants.filter((_, n) => n !== i)
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() =>
                  field('variants', [
                    ...draft.variants,
                    { id: window.crypto.randomUUID(), name: 'New option', cost: 0, minimum: 1 },
                  ])
                }
              >
                Add option
              </button>
              <details open>
                <summary>Private supplier & logistics profile</summary>
                <div className="fh-fields">
                  <label>
                    Supplier name
                    <input
                      value={draft.supplierName}
                      onChange={(e) => field('supplierName', e.target.value)}
                    />
                  </label>
                  <label>
                    Supplier contact
                    <input
                      value={draft.supplierContact}
                      onChange={(e) => field('supplierContact', e.target.value)}
                    />
                  </label>
                  <label className="fh-wide">
                    Source URL
                    <input
                      type="url"
                      value={draft.sourceUrl}
                      onChange={(e) => field('sourceUrl', e.target.value)}
                    />
                  </label>
                  <label className="fh-wide">
                    Packaging details{' '}
                    <small>
                      Each carton: dimensions, gross weight, contents, stackability; include
                      confirmation date
                    </small>
                    <textarea
                      rows={3}
                      value={draft.packaging}
                      onChange={(e) => field('packaging', e.target.value)}
                    />
                  </label>
                  <label className="fh-wide">
                    Supplier facts & notes{' '}
                    <small>
                      Record MOQ, lead time, warranty, commercial-use evidence and dated
                      confirmations here
                    </small>
                    <textarea
                      rows={5}
                      value={draft.supplierNotes}
                      onChange={(e) => field('supplierNotes', e.target.value)}
                    />
                  </label>
                </div>
                <details>
                  <summary>Message to supplier</summary>
                  <textarea
                    aria-label="Supplier inquiry message"
                    rows={10}
                    readOnly
                    value={supplierInquiry(draft)}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      void run(async () => {
                        await navigator.clipboard.writeText(supplierInquiry(draft));
                        setNotice('Supplier message copied.');
                      })
                    }
                  >
                    Copy message
                  </button>
                </details>
              </details>
              <label className="fh-check">
                <input
                  type="checkbox"
                  checked={draft.published}
                  onChange={(e) => field('published', e.target.checked)}
                />{' '}
                Publish on the furniture quote page
              </label>
              <button className="fh-primary" disabled={busy}>
                {busy ? 'Saving…' : draft.published ? 'Save & publish' : 'Save draft'}
              </button>
            </form>
          )}
          <div className="fh-product-list">
            {products === undefined ? (
              <p>Loading drafts…</p>
            ) : !products.length ? (
              <div className="fh-empty">
                <h2>Your first piece starts here.</h2>
                <p>Paste a supplier link above, or add a piece manually.</p>
              </div>
            ) : (
              products.map((p) => (
                <div className="fh-product-row" key={p._id}>
                  {p.images[0] && <img src={p.images[0]} alt="" />}
                  <div>
                    <strong>{p.name}</strong>
                    <small>
                      {p.category} · {p.published ? 'Published' : 'Draft'} · {p.variants.length}{' '}
                      option(s)
                    </small>
                    <small>
                      {p.supplierName || 'Supplier not recorded'} · Updated{' '}
                      {new Date(p.updatedAt).toLocaleDateString()}
                    </small>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (draft && !confirm('Discard unsaved edits?')) return;
                      edit(p);
                    }}
                  >
                    Edit
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        <div>
          {requests === undefined ? (
            <p>Loading requests…</p>
          ) : !requests.length ? (
            <div className="fh-empty">
              <h2>A place for your next project.</h2>
              <p>Submitted quote requests appear here, even if email delivery fails.</p>
            </div>
          ) : (
            requests.map((q) => (
              <article className="fh-request" key={q._id}>
                <div className="fh-editor-heading">
                  <h2>
                    {q.name} <small>#{q._id.slice(-8).toUpperCase()}</small>
                  </h2>
                  <select
                    aria-label={`Status for ${q.name}`}
                    value={q.status}
                    disabled={busy}
                    onChange={(e) =>
                      void run(() =>
                        updateStatus({
                          id: q._id,
                          status: e.target.value as 'new' | 'reviewing' | 'quoted' | 'closed',
                        })
                      )
                    }
                  >
                    {['new', 'reviewing', 'quoted', 'closed'].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <p>
                  {q.business} · {new Date(q.createdAt).toLocaleString()}
                </p>
                <p>
                  <a
                    href={`mailto:${q.email}?subject=${encodeURIComponent(`Your House of Louie Mae quote ${q._id.slice(-8).toUpperCase()}`)}`}
                  >
                    {q.email}
                  </a>{' '}
                  · {q.phone}
                </p>
                <p className="fh-description">{q.address}</p>
                <p>
                  {q.service} · {q.notes}
                </p>
                {q.items.map((i) => (
                  <p key={`${i.productId}:${i.variantId}`}>
                    {i.quantity} × {i.name} / {i.variant} — {range(i.lower, i.upper)} each
                  </p>
                ))}
                <strong>Merchandise estimate: {range(q.lower, q.upper)}</strong>
                <p>
                  <small>
                    Customer email: {q.customerEmailStatus} · Owner email: {q.ownerEmailStatus}
                  </small>
                </p>
                {(['customer', 'owner'] as const).map(
                  (a) =>
                    !['sent', 'pending', 'retrying'].includes(
                      a === 'customer' ? q.customerEmailStatus : q.ownerEmailStatus
                    ) && (
                      <button
                        key={a}
                        disabled={busy}
                        onClick={() => void run(() => retry({ id: q._id, audience: a }))}
                      >
                        Retry {a} email
                      </button>
                    )
                )}
              </article>
            ))
          )}
        </div>
      )}
    </>
  );
}
