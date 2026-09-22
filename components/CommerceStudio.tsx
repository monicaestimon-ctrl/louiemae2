import React, { useState } from 'react';
import { useAction, useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import {
  type Channel,
  type CommerceDraft,
  priceFromCost,
  providerLabels,
  applyHouseEstimates,
} from '../lib/commerce';
import './commerce.css';

export function CommerceStudio({ entry }: { entry: Channel }) {
  const library = usePaginatedQuery(api.commerce.library, {}, { initialNumItems: 30 });
  const cj = usePaginatedQuery(api.commerce.cjLibrary, {}, { initialNumItems: 30 });
  const importer = useAction(api.commerceImport.fromUrl);
  const link = useMutation(api.commerce.linkCj);
  const [selected, select] = useState<Id<'commerceProducts'> | null>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="commerce-studio">
      <h2>Shared product studio</h2>
      <p>Prepare once. Publish to Louie Mae and House with separate customer estimates.</p>
      {error && <p role="alert">{error}</p>}
      {selected ? (
        <CommerceEditor key={selected} id={selected} onClose={() => select(null)} />
      ) : (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const result = await importer({
                  url,
                  entry,
                  provider: entry === 'retail' ? 'ashcroft' : 'owner_managed',
                });
                select(result.id);
              });
            }}
          >
            <label>
              {entry === 'retail'
                ? 'Import an Ashcroft product'
                : 'Import a House-only, owner-managed product'}
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
              />
            </label>
            <button disabled={busy}>Import draft</button>
          </form>
          <p>
            {entry === 'retail'
              ? 'Continue using the existing Import Studio for CJ sourcing. Ashcroft orders are placed manually in your dealer portal.'
              : 'This import never requests CJ sourcing. Add existing CJ and Ashcroft products from the shared library below.'}
          </p>
          <h3>Shared library</h3>
          {library.results.map((p) => (
            <button className="commerce-library-row" key={p._id} onClick={() => select(p._id)}>
              <strong>{p.draft.name}</strong>
              <span>
                {providerLabels[p.provider]} · Revision {p.revision}
              </span>
            </button>
          ))}
          {library.status === 'CanLoadMore' && (
            <button onClick={() => library.loadMore(30)}>Load more products</button>
          )}
          <details>
            <summary>Add an existing CJ product</summary>
            {cj.results.map((p) => (
              <button
                className="commerce-library-row"
                disabled={busy}
                key={p.id}
                onClick={() => void run(async () => select(await link({ id: p.id })))}
              >
                {p.name} <small>{p.ready ? 'Ready' : 'Sourcing/mapping review required'}</small>
              </button>
            ))}
            {cj.status === 'CanLoadMore' && (
              <button onClick={() => cj.loadMore(30)}>Load more CJ products</button>
            )}
          </details>
        </>
      )}
    </section>
  );
}

function CommerceEditor({ id, onClose }: { id: Id<'commerceProducts'>; onClose: () => void }) {
  const record = useQuery(api.commerce.get, { id });
  const save = useMutation(api.commerce.save);
  const refreshCj = useMutation(api.commerce.refreshCj);
  const publish = useMutation(api.commerce.publish);
  const hide = useMutation(api.commerce.unpublish);
  const [edited, setEdited] = useState<CommerceDraft | null>(null);
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [destinations, setDestinations] = useState<Channel[]>([]);
  const [rate, setRate] = useState('');
  const [method, setMethod] = useState<'markup' | 'margin'>('markup');
  const [pricingChannel, setPricingChannel] = useState<Channel>('house');
  const p = record?.product;
  if (!p) return <p>Loading product…</p>;
  const d = edited || p.draft;
  function change(next: CommerceDraft) {
    setBaseRevision(baseRevision ?? p!.revision);
    setEdited(next);
  }
  function field<K extends keyof CommerceDraft>(key: K, value: CommerceDraft[K]) {
    change({
      ...d,
      ...(['name', 'description', 'facts', 'conflicts'].includes(key)
        ? { factsApproved: false }
        : {}),
      ...(['images', 'variants'].includes(key) ? { imagesApproved: false } : {}),
      [key]: value,
    });
  }
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button
        onClick={() => {
          if (!edited || window.confirm('Discard unsaved changes?')) onClose();
        }}
      >
        ← Shared library
      </button>
      <p>
        {providerLabels[p.provider]} · Revision {p.revision}
        {edited ? ' · Unsaved changes' : ' · Saved'}
      </p>
      {p.provider === 'cj' && (
        <>
          <p>
            CJ retains its existing retail checkout. Manage retail names, imagery, and retail prices
            in the existing product editor; House estimates are independent here.
          </p>
          <button
            disabled={busy || !!edited}
            onClick={() =>
              void run(async () => {
                await refreshCj({ id, revision: p.revision });
                setMessage(
                  'CJ content and variant mappings refreshed. Review before republishing.'
                );
              })
            }
          >
            Refresh from retail product
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {record.listings.map((l) => (
        <p key={l._id}>
          {l.channel}: {l.published ? `Published revision ${l.revision}` : 'Hidden'}{' '}
          {l.published && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await hide({ id, channel: l.channel });
                  setMessage('Destination hidden.');
                })
              }
            >
              Hide {l.channel}
            </button>
          )}
        </p>
      ))}
      <label>
        Louie Mae name
        <input value={d.name} onChange={(e) => field('name', e.target.value)} />
      </label>
      <label>
        Category
        <input
          value={d.category}
          onChange={(e) => field('category', e.target.value)}
          placeholder="Chairs, Sofas, Tables…"
        />
      </label>
      <label>
        Description
        <textarea
          rows={5}
          value={d.description}
          onChange={(e) => field('description', e.target.value)}
        />
      </label>
      <label>
        Verified specifications
        <textarea rows={5} value={d.facts} onChange={(e) => field('facts', e.target.value)} />
      </label>
      <label>
        Source conflicts (one per line; resolve against evidence before clearing)
        <textarea
          value={d.conflicts.join('\n')}
          onChange={(e) => field('conflicts', e.target.value.split('\n').filter(Boolean))}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={d.factsApproved}
          onChange={(e) => field('factsApproved', e.target.checked)}
        />{' '}
        I have reviewed the name, copy, specifications and source conflicts.
      </label>
      <details>
        <summary>Private supplier details</summary>
        <a href={d.sourceUrl} target="_blank" rel="noreferrer">
          Open source listing
        </a>
        <label>
          Supplier
          <input value={d.supplierName} onChange={(e) => field('supplierName', e.target.value)} />
        </label>
        <label>
          Supplier contact
          <textarea
            value={d.supplierContact}
            onChange={(e) => field('supplierContact', e.target.value)}
          />
        </label>
        <label>
          Packaging
          <textarea value={d.packaging} onChange={(e) => field('packaging', e.target.value)} />
        </label>
      </details>
      <h3>Reference gallery</h3>
      <div className="commerce-gallery">
        {d.referenceImages.map((image, i) => (
          <a key={`${image}-${i}`} href={image} target="_blank" rel="noreferrer">
            <img src={image} alt={`Supplier reference ${i + 1}`} />
          </a>
        ))}
      </div>
      <label>
        <input
          type="checkbox"
          checked={d.referencePermission}
          onChange={(e) => field('referencePermission', e.target.checked)}
        />{' '}
        I have permission to use these references for image editing.
      </label>
      <GenerationPanel
        productId={id}
        revision={p.revision}
        references={d.referenceImages}
        disabled={!!edited}
      />
      {p.provider !== 'ashcroft' && (
        <button
          disabled={!d.referencePermission}
          onClick={() => field('images', [...d.referenceImages])}
        >
          Select supplier references for listing review
        </button>
      )}
      <h3>Approved listing gallery</h3>
      <p>
        These images are shared by both destinations. Ashcroft references are not published
        automatically.
      </p>
      <label>
        Approved image URLs (one per line; first is cover)
        <textarea
          value={d.images.join('\n')}
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
      <div className="commerce-gallery">
        {d.images.map((image, i) => (
          <img key={`${image}-${i}`} src={image} alt={`Listing view ${i + 1}`} />
        ))}
      </div>
      <label>
        <input
          type="checkbox"
          checked={d.imagesApproved}
          onChange={(e) => field('imagesApproved', e.target.checked)}
        />{' '}
        I have checked image rights and exact product/variant accuracy.
      </label>
      <h3>Variants and separate estimates</h3>
      <p>
        Customer estimates below are merchandise only, in USD. Delivery and tax are confirmed with
        the final quote.
      </p>
      <div className="commerce-fields">
        <label>
          Source currency
          <input
            value={d.currency}
            onChange={(e) => field('currency', e.target.value.toUpperCase())}
          />
        </label>
        <label>
          USD per source currency unit
          <input
            type="number"
            min="0"
            step="any"
            value={d.usdRate}
            onChange={(e) => field('usdRate', Number(e.target.value))}
          />
        </label>
      </div>
      {d.variants.map((v, i) => (
        <fieldset key={v.id}>
          <legend>{v.name}</legend>
          <small>
            Source ID: {v.id} · SKU: {v.sku || 'Not supplied'}
          </small>
          <div className="commerce-fields">
            {(['name', 'sku', 'image'] as const).map((k) => (
              <label key={k}>
                {k}
                <input
                  value={v[k] || ''}
                  onChange={(e) =>
                    field(
                      'variants',
                      d.variants.map((o, j) => (j === i ? { ...o, [k]: e.target.value } : o))
                    )
                  }
                />
              </label>
            ))}
            {(['cost', 'minimum', 'increment', 'retail', 'commercial'] as const).map((k) => (
              <label key={k}>
                {k === 'retail'
                  ? 'Retail estimate (USD)'
                  : k === 'commercial'
                    ? 'House estimate (USD)'
                    : k}
                <input
                  type="number"
                  min="0"
                  step={k === 'minimum' || k === 'increment' ? '1' : '0.01'}
                  value={k === 'retail' || k === 'commercial' ? v[k] / 100 : v[k]}
                  onChange={(e) =>
                    field(
                      'variants',
                      d.variants.map((o, j) =>
                        j === i
                          ? {
                              ...o,
                              [k]:
                                k === 'retail' || k === 'commercial'
                                  ? Math.round(Number(e.target.value) * 100)
                                  : Number(e.target.value),
                            }
                          : o
                      )
                    )
                  }
                />
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="commerce-fields">
        <label>
          Calculate estimates for
          <select
            value={pricingChannel}
            onChange={(e) => setPricingChannel(e.target.value as Channel)}
          >
            <option value="house">House</option>
            <option value="retail">Retail</option>
          </select>
        </label>
        {pricingChannel === 'retail' && (
          <>
            <label>
              Method
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as 'markup' | 'margin')}
              >
                <option value="markup">Markup on cost</option>
                <option value="margin">Gross margin</option>
              </select>
            </label>
            <label>
              Percentage
              <input type="number" value={rate} onChange={(e) => setRate(e.target.value)} />
            </label>
          </>
        )}
      </div>
      {pricingChannel === 'house' && (
        <p>
          House starting estimates: up to $50 ×6; over $50–$75 ×4.5; over $75–under $175 ×4;
          $175–under $250 ×3; $250+ ×2. Minimum prices prevent drops between tiers. Uses supplier
          cost converted to USD; delivery and tax are separate. Bulk, quantity, and large-invoice
          discounts are customized in the final quote after cost review.
        </p>
      )}
      <button
        disabled={pricingChannel === 'retail' && !rate}
        onClick={() => {
          try {
            if (pricingChannel === 'house') {
              field('variants', applyHouseEstimates(d).variants);
              return;
            }
            field(
              'variants',
              d.variants.map((v) => ({
                ...v,
                [pricingChannel === 'retail' ? 'retail' : 'commercial']: priceFromCost(
                  v.cost,
                  d.usdRate,
                  method,
                  Number(rate)
                ),
              }))
            );
          } catch (e) {
            setMessage(String(e));
          }
        }}
      >
        {pricingChannel === 'house'
          ? 'Apply House tiers & minimum prices'
          : 'Apply to draft estimates'}
      </button>
      <div className="commerce-actions">
        <button
          disabled={busy || !edited}
          onClick={() =>
            void run(async () => {
              await save({ id, revision: baseRevision ?? p.revision, draft: d });
              setEdited(null);
              setBaseRevision(null);
              setMessage('Draft saved. Live destinations are unchanged.');
            })
          }
        >
          Save draft
        </button>
      </div>
      <h3>Publishing destinations</h3>
      <p>Save and review the draft first. Publishing both is one operation.</p>
      {(['retail', 'house'] as Channel[]).map((c) => (
        <label key={c}>
          <input
            type="checkbox"
            disabled={c === 'retail' && p.provider === 'owner_managed'}
            checked={destinations.includes(c)}
            onChange={(e) =>
              setDestinations(
                e.target.checked ? [...destinations, c] : destinations.filter((v) => v !== c)
              )
            }
          />{' '}
          {c === 'retail' ? 'Louie Mae' : 'House of Louie Mae'}
        </label>
      ))}
      <button
        disabled={busy || !!edited || !destinations.length}
        onClick={() =>
          void run(async () => {
            await publish({ id, revision: p.revision, channels: destinations });
            setMessage('Published to selected destinations.');
          })
        }
      >
        Publish selected destinations
      </button>
    </div>
  );
}

function GenerationPanel({
  productId,
  revision,
  references,
  disabled,
}: {
  productId: Id<'commerceProducts'>;
  revision: number;
  references: string[];
  disabled: boolean;
}) {
  const jobs = useQuery(api.commerceGeneration.jobs, { productId });
  const queue = useMutation(api.commerceGeneration.queue);
  const approve = useMutation(api.commerceGeneration.approve);
  const reject = useMutation(api.commerceGeneration.reject);
  const preview = useAction(api.commerceAI.preview);
  const [instruction, setInstruction] = useState('');
  const [reference, setReference] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Generation request failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset>
      <legend>Name, description & Image Studio</legend>
      <p>
        Save changes before generating. Candidates persist here for review. Up to 12 requests per
        product per day; provider charges apply.
      </p>
      <label>
        Creative direction
        <textarea
          value={instruction}
          maxLength={2000}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Warm plaster room, soft daylight, restrained styling…"
        />
      </label>
      <label>
        Product angle
        <select value={reference} onChange={(e) => setReference(e.target.value)}>
          <option value="">Select a reference</option>
          {references.map((url, i) => (
            <option key={url} value={url}>
              Reference {i + 1}
            </option>
          ))}
        </select>
      </label>
      {(['copy', 'image'] as const).map((kind) => (
        <button
          key={kind}
          disabled={disabled || busy || (kind === 'image' && !reference)}
          onClick={() =>
            void run(async () => {
              await queue({
                productId,
                revision,
                kind,
                instruction,
                ...(kind === 'image' ? { reference } : {}),
                requestKey: window.crypto.randomUUID(),
              });
              setMessage('Generation queued. You can leave this page and return.');
            })
          }
        >
          {kind === 'copy' ? 'Generate name & description' : 'Generate environment for this angle'}
        </button>
      ))}
      {message && <p role="status">{message}</p>}
      {jobs?.map((job) => (
        <article key={job._id}>
          {['needs_review', 'uncertain', 'failed'].includes(job.status) && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await reject({ id: job._id });
                  setMessage(
                    'Candidate dismissed. Provider charges, if incurred, are not reversed.'
                  );
                })
              }
            >
              Dismiss this attempt
            </button>
          )}
          <strong>
            {job.kind} · {job.status} · revision {job.revision}
          </strong>
          {job.error && <p>{job.error}</p>}
          {job.result && <pre style={{ whiteSpace: 'pre-wrap' }}>{job.result}</pre>}
          {job.storageId && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const data = await preview({ id: job._id });
                  setPreviews((p) => ({ ...p, [job._id]: data }));
                })
              }
            >
              View private candidate
            </button>
          )}
          {previews[job._id] && (
            <img
              src={previews[job._id]}
              alt="Generated candidate awaiting product accuracy review"
              style={{ maxWidth: '100%', maxHeight: 480 }}
            />
          )}
          {job.status === 'needs_review' && (
            <button
              disabled={
                disabled ||
                busy ||
                job.revision !== revision ||
                (job.kind === 'image' && !previews[job._id])
              }
              onClick={() =>
                void run(async () => {
                  await approve({ id: job._id, revision });
                  setMessage(
                    'Candidate added to draft. Review details and gallery before publication.'
                  );
                })
              }
            >
              Accept into draft
            </button>
          )}
        </article>
      ))}
    </fieldset>
  );
}
