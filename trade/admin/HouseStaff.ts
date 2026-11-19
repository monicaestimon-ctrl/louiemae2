import './staff.css';
import React, { useState, useEffect, useRef } from 'react';
import htm from 'htm';
import { useMutation } from 'convex/react';
import { useRecoverableQuery } from '../../contexts/useRecoverableQuery';
import { StaffQueryState } from './StaffQueryState';
import type { FunctionArgs, FunctionReturnType } from 'convex/server';
import type { Id } from '../../convex/_generated/dataModel';
import { api } from '../../convex/_generated/api';
import { BUSINESS_TYPES as BTYPES } from '../application';
import { formatHolmPrice as fmt } from '../formatHolmPrice';
import { Plus, X } from 'lucide-react';
import type { StaffContext } from './types';
import { cutoutFromPhoto, loadImg, uploadBlob, saveBlob, errText, type CutoutDraft } from './media';
const html = htm.bind(React.createElement);
const I = (name: string, props: { width?: number } = {}) =>
  React.createElement(name === 'plus' ? Plus : X, { 'aria-hidden': true, ...props });
const SR_LABEL: Record<string, string> = {
  received: 'Received',
  sourcing: 'Sourcing',
  options_ready: 'Options ready',
  ordered: 'Ordered',
  closed: 'Closed',
};
type ValueEvent = { target: { value: string } };
type AssetFilter = 'all' | 'd' | 'c' | 'm';
type Dimensions = Partial<
  NonNullable<FunctionReturnType<typeof api.holmAssets.readiness>[number]['dimsCm']>
>;
type SourcingStatus = FunctionArgs<typeof api.holmSourcing.adminList>['status'];
type SourcingEdit = {
  status: SourcingStatus;
  note: string;
  options: { title: string; price: string; leadTime: string; note: string }[];
};
type ApplicationStatus = NonNullable<FunctionArgs<typeof api.holm.adminApplications>['status']>;
type ReviewArgs = FunctionArgs<typeof api.holm.reviewApplication>;
type Asset = FunctionReturnType<typeof api.holmAssets.readiness>[number];
type Pricing = FunctionReturnType<typeof api.holm.adminPricing>[number];
type Sourcing = FunctionReturnType<typeof api.holmSourcing.adminList>[number];
type Partner = FunctionReturnType<typeof api.holmPartners.adminPartners>[number];
type SetPartner = (
  args: FunctionArgs<typeof api.holmPartners.adminSetPartner>
) => Promise<FunctionReturnType<typeof api.holmPartners.adminSetPartner>>;
function AssetsAdmin({ ctx }: { ctx: StaffContext }) {
  const Turntable = ctx.Turntable;
  const query = useRecoverableQuery(api.holmAssets.readiness, {});
  const rows = query.data;
  const setDims = useMutation(api.holmAssets.setDims);
  const upUrl = useMutation(api.holmAssets.uploadUrl);
  const setCutout = useMutation(api.holmAssets.setCutout);
  const setModel = useMutation(api.holmAssets.setModel);
  const setMount = useMutation(api.holmAssets.setMount);
  const [f, setF] = useState<AssetFilter>('all');
  const [open, setOpen] = useState<Id<'commerceProducts'> | null>(null);
  const [draft, setDraft] = useState<CutoutDraft | null>(null);
  const [busy, setBusy] = useState('');
  const [dims, setD] = useState<Record<string, Dimensions>>({});
  const draftEpoch = useRef(0);
  const acting = useRef(false);
  useEffect(
    () => () => {
      draftEpoch.current++;
    },
    []
  );
  useEffect(
    () => () => {
      if (draft?.url.startsWith('blob:')) URL.revokeObjectURL(draft.url);
    },
    [draft]
  );
  const makeDraft = async (create: () => Promise<CutoutDraft>) => {
    const epoch = ++draftEpoch.current;
    const next = await create();
    if (epoch !== draftEpoch.current) {
      if (next.url.startsWith('blob:')) URL.revokeObjectURL(next.url);
      return;
    }
    setDraft(next);
  };
  if (rows === undefined) return html`<${StaffQueryState} query=${query} />`;
  const ok = {
    d: (r: Asset) => !!r.dimsCm,
    c: (r: Asset) => r.cutoutStatus === 'approved',
    m: (r: Asset) => r.modelStatus === 'approved',
  };
  const list = rows.filter((r) => f === 'all' || !ok[f](r));
  const count = (k: Exclude<AssetFilter, 'all'>) => rows.filter(ok[k]).length;
  const act = async (k: string, fn: () => Promise<unknown>) => {
    if (acting.current) return;
    acting.current = true;
    setBusy(k);
    try {
      await fn();
    } catch (e) {
      ctx.toast(errText(e));
    } finally {
      acting.current = false;
      setBusy('');
    }
  };
  const dot = (on: boolean, warn: boolean, label: string) =>
    html`<span className=${'rd' + (on ? ' on' : warn ? ' warn' : '')} title=${label}></span>`;
  return html`<section style=${{ display: 'grid', gap: 16, marginTop: 20 }}>
    <div className="kpis">
      ${[
        ['Products', rows.length],
        ['With dimensions', count('d')],
        ['With a cutout', count('c')],
        ['With a 3D model', count('m')],
      ].map(
        ([l, v]) =>
          html`<div key=${l} className="kpi">
            <span className="mono mute">${l}</span><b className="num">${v}</b>
          </div>`
      )}
    </div>
    <p className="help" style=${{ margin: 0 }}>
      The Studio offers products with dimensions and an approved cutout; 3D options appear only
      where a model is approved. Work in order: dimensions, then cutouts, then models for the
      curated pieces first.
    </p>
    <div className="seg">
      ${[
        ['all', 'All'],
        ['d', 'Missing dimensions'],
        ['c', 'Missing cutout'],
        ['m', 'Missing model'],
      ].map(
        ([k, l]) =>
          html`<button
            key=${k}
            className=${f === k ? 'on' : ''}
            onClick=${() => setF(k as AssetFilter)}
          >
            ${l}
          </button>`
      )}
    </div>
    <div className="rd-list">
      ${list.map((r) => {
        const isOpen = open === r.productId;
        const dv = dims[r.productId] || r.dimsCm || {};
        return html`<div key=${r.productId} className=${'rd-row' + (isOpen ? ' open' : '')}>
          <button
            className="rd-head"
            onClick=${() => {
              draftEpoch.current++;
              setOpen(isOpen ? null : r.productId);
              setDraft(null);
            }}
            aria-expanded=${isOpen}
          >
            <span className="rd-th"
              >${r.image && html`<img src=${r.image} alt="" loading="lazy" />`}</span
            ><span className="rd-name">${r.name}</span>
            <span className="rd-dots"
              >${dot(
                !!r.dimsCm,
                false,
                'Dimensions' + (r.dimsSource ? ' · ' + r.dimsSource : '')
              )}${dot(
                r.cutoutStatus === 'approved',
                r.cutoutStatus === 'draft',
                'Cutout' + (r.cutoutStatus ? ' · ' + r.cutoutStatus : '')
              )}${dot(
                r.modelStatus === 'approved',
                r.modelStatus === 'draft',
                '3D model · ' + r.modelStatus
              )}</span
            >
          </button>
          ${isOpen &&
          html`<div className="rd-body">
            <h3>${r.name}</h3>
            <div className="rd-sec">
              <h4>
                Dimensions
                <small className="mute"
                  >${r.dimsSource === 'parsed'
                    ? 'read from the listing'
                    : r.dimsSource
                      ? r.dimsSource
                      : 'needed'}</small
                >
              </h4>
              <div className="pl-dims">
                ${[
                  ['w', 'Width'],
                  ['d', 'Depth'],
                  ['h', 'Height'],
                  ['seatH', 'Seat height'],
                  ['armH', 'Arm height'],
                ].map(
                  ([k, l]) =>
                    html`<label key=${k}
                      ><span className="mono mute">${l} (cm)</span
                      ><input
                        className="field num"
                        type="number"
                        min="0"
                        step="0.5"
                        value=${dv[k as keyof Dimensions] ?? ''}
                        onInput=${(e: ValueEvent) =>
                          setD((o) => ({
                            ...o,
                            [r.productId]: {
                              ...dv,
                              [k]: e.target.value === '' ? undefined : +e.target.value,
                            },
                          }))}
                    /></label>`
                )}
              </div>
              <div className="row" style=${{ gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-ink btn-sm"
                  disabled=${busy === 'dims' ||
                  !((dv.w ?? 0) > 0 && (dv.d ?? 0) > 0 && (dv.h ?? 0) > 0)}
                  onClick=${() =>
                    act('dims', async () => {
                      await setDims({
                        productId: r.productId,
                        dimsCm: {
                          w: dv.w!,
                          d: dv.d!,
                          h: dv.h!,
                          ...(dv.seatH ? { seatH: dv.seatH } : {}),
                          ...(dv.armH ? { armH: dv.armH } : {}),
                        },
                      });
                      ctx.toast('Dimensions saved');
                    })}
                >
                  Save dimensions
                </button>
                ${r.dimsSource === 'manual' &&
                html`<button
                  className="lnk"
                  onClick=${() =>
                    act('dims', async () => {
                      const submitted = dims[r.productId];
                      await setDims({ productId: r.productId, dimsCm: null });
                      setD((current) => {
                        if (current[r.productId] !== submitted) return current;
                        const next = { ...current };
                        delete next[r.productId];
                        return next;
                      });
                    })}
                >
                  Use the listing's dimensions
                </button>`}
              </div>
              <label className="toggle" style=${{ maxWidth: 360 }}
                ><span>Hangs from the ceiling or wall</span
                ><input
                  type="checkbox"
                  className="sr"
                  checked=${r.hangs}
                  onChange=${(e: React.ChangeEvent<HTMLInputElement>) =>
                    act('mount', () =>
                      setMount({
                        productId: r.productId,
                        hangs: e.target.checked,
                        mountHeightCm: r.mountHeightCm ?? undefined,
                      })
                    )} /><span className=${'sw' + (r.hangs ? ' on' : '')}></span
              ></label>
            </div>
            <div className="rd-sec">
              <h4>
                Seamless cutout <small className="mute">${r.cutoutStatus || 'none yet'}</small>
              </h4>
              <div className="rd-pair">
                <figure>
                  <img src=${r.image} alt="Product photo" />
                  <figcaption className="mono mute">Product photo</figcaption>
                </figure>
                <figure className="checker">
                  ${draft?.url
                    ? html`<img src=${draft.url} alt="Cutout preview" />`
                    : r.cutoutUrl
                      ? html`<img src=${r.cutoutUrl} alt="Current cutout" />`
                      : html`<span className="sx-note">No cutout yet</span>`}
                  <figcaption className="mono mute">
                    ${draft ? 'Check the edges, then approve' : 'Cutout'}
                  </figcaption>
                </figure>
              </div>
              <div className="row" style=${{ gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-line btn-sm"
                  disabled=${!!busy}
                  onClick=${() => act('cut', () => makeDraft(() => cutoutFromPhoto(r.image)))}
                >
                  ${busy === 'cut' ? 'Removing background…' : 'Remove the background'}
                </button>
                <label className="btn btn-line btn-sm" style=${{ cursor: 'pointer' }}
                  >Upload a cutout<input
                    type="file"
                    accept="image/png,image/webp"
                    className="sr"
                    disabled=${!!busy}
                    onChange=${async (e: React.ChangeEvent<HTMLInputElement>) => {
                      const x = e.target.files?.[0];
                      if (!x) return;
                      e.target.value = '';
                      await act('cut', () =>
                        makeDraft(async () => {
                          const u = URL.createObjectURL(x);
                          try {
                            const im = await loadImg(u);
                            return { blob: x, url: u, aspect: im.width / im.height };
                          } catch (error) {
                            URL.revokeObjectURL(u);
                            throw error;
                          }
                        })
                      );
                    }}
                /></label>
                ${draft &&
                html`<button
                  className="btn btn-cog btn-sm"
                  disabled=${!!busy}
                  onClick=${() =>
                    act('save', async () => {
                      const epoch = draftEpoch.current;
                      const id = await uploadBlob(upUrl, draft.blob);
                      await setCutout({
                        productId: r.productId,
                        cutoutId: id,
                        aspect: draft.aspect,
                        status: 'approved',
                      });
                      if (epoch === draftEpoch.current) setDraft(null);
                      ctx.toast('Cutout approved for ' + r.name);
                    })}
                >
                  Approve cutout
                </button>`}
                ${r.cutoutStatus &&
                !draft &&
                html`<button
                  className="lnk"
                  style=${{ color: 'var(--bad)' }}
                  onClick=${() =>
                    act('rm', () => setCutout({ productId: r.productId, status: 'removed' }))}
                >
                  Remove cutout
                </button>`}
              </div>
            </div>
            <div className="rd-sec">
              <h4>
                3D model
                <small className="mute"
                  >${r.modelStatus}${r.modelBytes
                    ? ` · ${(r.modelBytes / 1048576).toFixed(1)} MB`
                    : ''}</small
                >
              </h4>
              ${r.modelUrl
                ? html`<div className="rd-pair">
                    <figure><img src=${r.image} alt="Product photo" /></figure>
                    <${Turntable} url=${r.modelUrl} dims=${r.dimsCm} />
                  </div>`
                : html`<p className="sx-note">
                    Generate a GLB from every angle of the product photos with an image-to-3D tool,
                    swap its painted texture for the shared ${'leather, bouclé, velvet or wood'}
                    material, compress it under 3 MB (Draco or Meshopt, KTX2 textures), then upload
                    it here. It is scaled to the listed W × D × H automatically.
                  </p>`}
              <div className="row" style=${{ gap: 8, flexWrap: 'wrap' }}>
                <label className="btn btn-line btn-sm" style=${{ cursor: 'pointer' }}
                  >${r.modelUrl ? 'Upload a new model' : 'Upload a GLB'}<input
                    type="file"
                    accept=".glb,model/gltf-binary"
                    className="sr"
                    disabled=${!!busy}
                    onChange=${(e: React.ChangeEvent<HTMLInputElement>) => {
                      const x = e.target.files?.[0];
                      if (!x) return;
                      e.target.value = '';
                      act('glb', async () => {
                        if (x.size > 3 * 1048576) throw new Error('Models must be under 3 MB.');
                        const id = await uploadBlob(upUrl, x);
                        const res = await setModel({
                          productId: r.productId,
                          modelId: id,
                          status: 'draft',
                        });
                        if (res && res.ok === false) throw new Error(res.error);
                        ctx.toast('Model uploaded for review');
                      });
                    }}
                /></label>
                ${r.modelUrl &&
                r.modelStatus !== 'approved' &&
                html`<button
                  className="btn btn-cog btn-sm"
                  disabled=${!r.dimsCm || !!busy}
                  title=${r.dimsCm ? '' : 'Add dimensions first'}
                  onClick=${() =>
                    act('ok', () => setModel({ productId: r.productId, status: 'approved' }))}
                >
                  Approve
                </button>`}
                ${r.modelUrl &&
                r.modelStatus !== 'rejected' &&
                html`<button
                  className="lnk"
                  style=${{ color: 'var(--bad)' }}
                  onClick=${() =>
                    act('no', () => setModel({ productId: r.productId, status: 'rejected' }))}
                >
                  Reject
                </button>`}
              </div>
            </div>
          </div>`}
        </div>`;
      })}
    </div>
  </section>`;
}

export default function AdminPage({ ctx }: { ctx: StaffContext }) {
  const [tab, setTab] = useState('apps');
  if (!ctx.me.admin)
    return html`<main className="wrap">
      <div className="empty" style=${{ padding: '80px 0' }}>
        <h3>Team only</h3>
        <p>Sign in with an admin account to manage House of Louie Mae.</p>
      </div>
    </main>`;
  return html`<main className="wrap house-staff" style=${{ paddingBottom: 60 }}>
    <h1>House management</h1>
    <div className="seg" style=${{ margin: '28px 0 0' }}>
      ${[
        ['apps', 'Trade applications'],
        ['sourcing', 'Sourcing'],
        ['partners', 'Partners'],
        ['pricing', 'Pricing'],
        ['assets', 'Asset readiness'],
      ].map(
        ([k, l]) =>
          html`<button key=${k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>
            ${l}
          </button>`
      )}
    </div>
    <h2>
      ${(
        {
          apps: 'Trade applications',
          sourcing: 'Sourcing',
          partners: 'Partners',
          pricing: 'Pricing',
          assets: 'Asset readiness',
        } as Record<string, string>
      )[tab]}
    </h2>
    ${tab === 'assets'
      ? html`<${AssetsAdmin} ctx=${ctx} />`
      : tab === 'apps'
        ? html`<${TradeAdmin} ctx=${ctx} />`
        : tab === 'sourcing'
          ? html`<${SourcingAdmin} ctx=${ctx} />`
          : tab === 'pricing'
            ? html`<${PricingAdmin} ctx=${ctx} />`
            : html`<${PartnersAdmin} ctx=${ctx} />`}
  </main>`;
}

function SourcingAdmin({ ctx }: { ctx: StaffContext }) {
  const [status, setStatus] = useState<SourcingStatus>('received');
  const query = useRecoverableQuery(api.holmSourcing.adminList, { status });
  const rows = query.data;
  const update = useMutation(api.holmSourcing.adminUpdate);
  const [edit, setEdit] = useState<Record<string, SourcingEdit | undefined>>({});
  const ed = (r: Sourcing): SourcingEdit =>
    edit[r._id] || {
      status: r.status,
      note: r.adminNote || '',
      options: r.options.map((o) => ({
        ...o,
        leadTime: o.leadTime || '',
        note: o.note || '',
        price: (o.unitCents / 100).toFixed(2),
      })),
    };
  const setEd = (r: Sourcing, o: Partial<SourcingEdit>) =>
    setEdit({ ...edit, [r._id]: { ...ed(r), ...o } });
  const save = async (r: Sourcing) => {
    const e = ed(r);
    try {
      await update({
        id: r._id,
        status: e.status,
        adminNote: e.note || undefined,
        options: e.options
          .filter((o) => o.title.trim())
          .map((o) => ({
            title: o.title.trim(),
            unitCents: Math.round(+o.price * 100) || 0,
            leadTime: o.leadTime || '',
            note: o.note || '',
          })),
      });
      ctx.toast('Saved');
      setEdit((current) => (current[r._id] === e ? { ...current, [r._id]: undefined } : current));
    } catch (x) {
      ctx.toast(errText(x));
    }
  };
  return html`<div style=${{ marginTop: 18 }}>
    <div className="seg">
      ${['received', 'sourcing', 'options_ready', 'ordered', 'closed'].map(
        (k) =>
          html`<button
            key=${k}
            className=${status === k ? 'on' : ''}
            onClick=${() => setStatus(k as typeof status)}
          >
            ${SR_LABEL[k]}
          </button>`
      )}
    </div>
    ${rows === undefined
      ? html`<${StaffQueryState} query=${query} />`
      : !rows.length
        ? html`<div className="empty">
            <h3>Nothing here</h3>
            <p>No requests with this status.</p>
          </div>`
        : html`<div style=${{ display: 'grid', gap: 14, marginTop: 14 }}>
            ${rows.map((r) => {
              const e = ed(r);
              return html`<div key=${r._id} className="panel" style=${{ display: 'grid', gap: 10 }}>
                <div className="row" style=${{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <h3>${r.number} · ${r.title}</h3>
                  <span className="mono mute">${r.email}</span>
                </div>
                <p className="help" style=${{ margin: 0 }}>
                  ${r.quantity} × ·
                  ${r.category}${r.material ? ' · ' + r.material : ''}${r.dims
                    ? ' · ' + r.dims
                    : ''}${r.targetCents ? ' · target ' + fmt(r.targetCents / 100) : ''}${r.neededBy
                    ? ' · needed by ' + r.neededBy
                    : ''}${r.project ? ' · ' + r.project : ''}
                </p>
                ${r.link &&
                html`<a href=${r.link} target="_blank" rel="noopener noreferrer"
                  >${r.link}</a
                >`}${r.notes && html`<p>${r.notes}</p>`}
                ${r.imageUrls.length > 0 &&
                html`<div className="pl-mini">
                  ${r.imageUrls
                    .filter(Boolean)
                    .map(
                      (u, i) =>
                        html`<a key=${i} href=${u} target="_blank" rel="noopener"
                          ><img src=${u} alt=""
                        /></a>`
                    )}
                </div>`}
                ${r.chosenOption != null &&
                html`<p className="tv-status">
                  Client chose: ${r.options[r.chosenOption]?.title}
                </p>`}
                <div style=${{ display: 'grid', gap: 6 }}>
                  ${e.options.map(
                    (o, i) =>
                      html`<div
                        key=${i}
                        className="g3f"
                        style=${{
                          display: 'grid',
                          gridTemplateColumns: '2fr 1fr 1fr 2fr auto',
                          gap: 6,
                        }}
                      >
                        <input
                          className="field"
                          placeholder="Option"
                          value=${o.title}
                          onInput=${(x: ValueEvent) => {
                            const op = [...e.options];
                            op[i] = { ...o, title: x.target.value };
                            setEd(r, { options: op });
                          }}
                        /><input
                          className="field num"
                          placeholder="Price $"
                          value=${o.price}
                          onInput=${(x: ValueEvent) => {
                            const op = [...e.options];
                            op[i] = { ...o, price: x.target.value };
                            setEd(r, { options: op });
                          }}
                        /><input
                          className="field"
                          placeholder="Lead time"
                          value=${o.leadTime}
                          onInput=${(x: ValueEvent) => {
                            const op = [...e.options];
                            op[i] = { ...o, leadTime: x.target.value };
                            setEd(r, { options: op });
                          }}
                        /><input
                          className="field"
                          placeholder="Note"
                          value=${o.note}
                          onInput=${(x: ValueEvent) => {
                            const op = [...e.options];
                            op[i] = { ...o, note: x.target.value };
                            setEd(r, { options: op });
                          }}
                        /><button
                          className="ib"
                          aria-label="Remove option"
                          onClick=${() =>
                            setEd(r, { options: e.options.filter((_, k) => k !== i) })}
                        >
                          ${I('x', { width: 14 })}
                        </button>
                      </div>`
                  )}
                  <button
                    className="btn btn-line btn-sm"
                    style=${{ justifySelf: 'start' }}
                    onClick=${() =>
                      setEd(r, {
                        options: [...e.options, { title: '', price: '', leadTime: '', note: '' }],
                      })}
                  >
                    ${I('plus', { width: 14 })} Add option
                  </button>
                </div>
                <div className="g2f">
                  <select
                    className="field"
                    aria-label="Request status"
                    value=${e.status}
                    onChange=${(x: ValueEvent) =>
                      setEd(r, { status: x.target.value as SourcingStatus })}
                  >
                    ${['received', 'sourcing', 'options_ready', 'ordered', 'closed'].map(
                      (k) => html`<option key=${k} value=${k}>${SR_LABEL[k]}</option>`
                    )}</select
                  ><input
                    className="field"
                    placeholder="Note to the requester (emailed when the status changes)"
                    value=${e.note}
                    onInput=${(x: ValueEvent) => setEd(r, { note: x.target.value })}
                  />
                </div>
                <button
                  className="btn btn-ink"
                  style=${{ justifySelf: 'start' }}
                  onClick=${() => save(r)}
                >
                  Save
                </button>
              </div>`;
            })}
          </div>`}
  </div>`;
}

function PricingAdmin({ ctx }: { ctx: StaffContext }) {
  const query = useRecoverableQuery(api.holm.adminPricing, {});
  const rows = query.data;
  const [only, setOnly] = useState(true);
  const exclude = useMutation(api.holmAdmin.addExclusion);
  const excludePiece = (r: Pricing) => {
    const reason = prompt(`Exclude ${r.name} from partner commission? Give a reason:`);
    if (reason && reason.trim())
      exclude({ kind: 'product', value: r.productId, reason })
        .then(() => ctx.toast(`${r.name} excluded from commission`))
        .catch((e) => ctx.toast(errText(e)));
  };
  if (rows === undefined) return html`<${StaffQueryState} query=${query} />`;
  const flagged = rows.filter((r) => r.flags.length);
  const list = only ? flagged : rows;
  const m = (b: number | null) => (b == null ? '—' : (b / 100).toFixed(1) + '%');
  const $ = (c: number) => fmt(c / 100, true);
  return html`<div style=${{ marginTop: 18, display: 'grid', gap: 14 }}>
    <p className="help">
      Cost is the dealer cost plus the supplier freight allowance. Margins are after card processing
      (2.9% + 30¢). "Retail after Elite" is the retail margin left after the top partner rate for
      the piece's type (held to 40% of profit); under 20% is flagged, so you can exclude or reprice
      it.
    </p>
    <p className="help">
      This legacy diagnostic applies its configured pricing floor and flags exceptions. It is not
      confirmation of an approved SKU margin or v2 commission eligibility. This legacy pricing view
      does not confirm delivery coverage or charges; review delivery in the final project quote.
    </p>
    <div className="row" style=${{ gap: 8 }}>
      <button className=${'chip' + (only ? ' on' : '')} onClick=${() => setOnly(true)}>
        Flagged · ${flagged.length}</button
      ><button className=${'chip' + (!only ? ' on' : '')} onClick=${() => setOnly(false)}>
        All pieces · ${rows.length}
      </button>
    </div>
    ${list.length
      ? html`<div style=${{ overflowX: 'auto' }}>
          <table
            className="ptable"
            style=${{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}
          >
            <thead>
              <tr>
                ${[
                  'Piece',
                  'SKU',
                  'Cost',
                  'Retail',
                  'Trade',
                  'Project 5%',
                  'Trade margin',
                  'Project margin',
                  'Retail after Elite',
                  'Flags',
                ].map(
                  (h) =>
                    html`<th
                      key=${h}
                      style=${{
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderBottom: '1px solid var(--line2)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      ${h}
                    </th>`
                )}
              </tr>
            </thead>
            <tbody>
              ${list.map(
                (r) =>
                  html`<tr key=${r.productId + r.sku}>
                    <td style=${{ padding: '8px 10px', borderBottom: '1px solid var(--line)' }}>
                      ${r.name}${r.variant && r.variant !== 'Default'
                        ? html`<span className="mute"> · ${r.variant}</span>`
                        : ''}
                    </td>
                    <td
                      className="mono"
                      style=${{ padding: '8px 10px', borderBottom: '1px solid var(--line)' }}
                    >
                      ${r.sku}
                    </td>
                    ${[
                      r.costCents ? $(r.costCents) : 'Missing',
                      $(r.retailCents),
                      $(r.tradeCents),
                      $(r.projectCents),
                      m(r.tradeMarginBps),
                      m(r.projectMarginBps),
                      m(r.afterEliteBps),
                    ].map(
                      (v, i) =>
                        html`<td
                          key=${i}
                          className="num"
                          style=${{
                            padding: '8px 10px',
                            borderBottom: '1px solid var(--line)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          ${v}
                        </td>`
                    )}
                    <td
                      style=${{
                        padding: '8px 10px',
                        borderBottom: '1px solid var(--line)',
                        color: r.flags.length ? 'var(--cognac)' : 'inherit',
                      }}
                    >
                      ${r.flags.join(' · ') || 'OK'}
                      <button
                        className="lnk"
                        style=${{ marginLeft: 6 }}
                        onClick=${() => excludePiece(r)}
                      >
                        Exclude from commission
                      </button>
                    </td>
                  </tr>`
              )}
            </tbody>
          </table>
        </div>`
      : html`<div className="empty">
          <h3>Nothing flagged</h3>
          <p>Every piece keeps the full trade discount above the margin floor.</p>
        </div>`}
  </div>`;
}

function PartnerLedger({ userId, ctx }: { userId: Id<'users'>; ctx: StaffContext }) {
  const [open, setOpen] = useState(false);
  const query = useRecoverableQuery(api.holmAdmin.ledger, open ? { userId } : 'skip');
  const l = query.data;
  const adjust = useMutation(api.holmAdmin.adjust);
  const [amt, setAmt] = useState('');
  const [note, setNote] = useState('');
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const $ = (c: number) => fmt(c / 100, true);
  const SRC = {
    storefront_order: 'louiemae.com order',
    house_quote: 'House quote',
    adjustment: 'Adjustment',
  };
  if (!open)
    return html`<button
      className="lnk"
      style=${{ justifySelf: 'start' }}
      onClick=${() => setOpen(true)}
    >
      Open ledger and adjustments
    </button>`;
  if (!l) return html`<${StaffQueryState} query=${query} />`;
  const save = () => {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    const cents = Math.round(Number(amt) * 100);
    adjust({ userId, amountCents: cents, note })
      .then(() => {
        ctx.toast('Adjustment added');
        setAmt('');
        setNote('');
      })
      .catch((e) => ctx.toast(errText(e)))
      .finally(() => {
        pending.current = false;
        setSaving(false);
      });
  };
  return html`<div style=${{ display: 'grid', gap: 10 }}>
    <div style=${{ overflowX: 'auto' }}>
      <table className="t">
        <thead>
          <tr>
            <th>Date</th>
            <th>Source</th>
            <th>Order</th>
            <th className="r">Order value</th>
            <th className="r">Rate</th>
            <th className="r">Commission</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${l.rows.map(
            (r) =>
              html`<tr key=${r.id}>
                <td>${new Date(r.createdAt).toLocaleDateString()}</td>
                <td>
                  ${SRC[r.source] || r.source}${r.note
                    ? html`<br /><small className="mute">${r.note}</small>`
                    : ''}
                </td>
                <td className="mono">${r.order ? String(r.order).slice(-12) : ''}</td>
                <td className="r num">${r.baseCents ? $(r.baseCents) : ''}</td>
                <td className="r num">${r.rateBps ? (r.rateBps / 100).toFixed(1) + '%' : ''}</td>
                <td className="r num">${$(r.amountCents)}</td>
                <td>${r.status}</td>
              </tr>`
          )}
        </tbody>
      </table>
    </div>
    ${l.payouts.length > 0 &&
    html`<div>
      <h4 style=${{ margin: '4px 0' }}>Payouts</h4>
      ${l.payouts.map(
        (x) =>
          html`<div key=${x.id} className="sumrow">
            <span
              >${new Date(x.paidAt).toLocaleDateString()} ·
              ${x.method === 'stripe' ? 'Stripe' : 'By hand'} ·
              ${x.status}${x.error ? html` <small className="mute">${x.error}</small>` : ''}</span
            ><span
              >${x.url
                ? html`<a href=${x.url} target="_blank" rel="noopener">${$(x.amountCents)}</a>`
                : $(x.amountCents)}
              <small className="mute">${x.method === 'stripe' ? '' : x.reference}</small></span
            >
          </div>`
      )}
    </div>`}
    <div className="row" style=${{ flexWrap: 'wrap', gap: 8 }}>
      <input
        className="field"
        style=${{ maxWidth: 140 }}
        type="number"
        step="0.01"
        placeholder="Amount ($)"
        aria-label="Adjustment amount in dollars, negative to deduct"
        disabled=${saving}
        value=${amt}
        onInput=${(e: ValueEvent) => setAmt(e.target.value)}
      />
      <input
        className="field"
        style=${{ maxWidth: 320 }}
        placeholder="Note (required)"
        aria-label="Adjustment note"
        disabled=${saving}
        value=${note}
        onInput=${(e: ValueEvent) => setNote(e.target.value)}
      />
      <button
        className="btn btn-line"
        disabled=${saving || !note.trim() || !Number(amt)}
        onClick=${save}
      >
        Add adjustment
      </button>
    </div>
    <p className="help" style=${{ margin: 0 }}>
      An adjustment is cleared straight away and goes on the next payout. Use a negative amount to
      take money back.
    </p>
  </div>`;
}

function ExclusionsAdmin({ ctx }: { ctx: StaffContext }) {
  const query = useRecoverableQuery(api.holmAdmin.exclusions, {});
  const rows = query.data;
  const add = useMutation(api.holmAdmin.addExclusion);
  const remove = useMutation(api.holmAdmin.removeExclusion);
  const [kind, setKind] = useState<'category' | 'product'>('category');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const save = () =>
    add({ kind, value, reason })
      .then(() => {
        ctx.toast('Excluded from commission');
        setValue('');
        setReason('');
      })
      .catch((e) => ctx.toast(errText(e)));
  if (rows === undefined) return html`<${StaffQueryState} query=${query} />`;
  return html`<details className="panel">
    <summary style=${{ cursor: 'pointer' }}>
      <b style=${{ fontWeight: 500 }}>Commission exclusions</b>
      <span className="mute">· ${rows ? rows.length : '…'}</span>
    </summary>
    <div style=${{ display: 'grid', gap: 10, marginTop: 10 }}>
      <p className="help" style=${{ margin: 0 }}>
        Excluded products earn no partner commission on orders paid from now on. A category matches
        any listing whose category contains the text.
      </p>
      ${(rows || []).map(
        (r) =>
          html`<div key=${r.id} className="sumrow">
            <span
              >${r.kind === 'product' ? 'Product' : 'Category'}:
              <b style=${{ fontWeight: 500 }}>${r.label}</b><br /><small className="mute"
                >${r.reason} · ${r.by}</small
              ></span
            ><button
              className="lnk"
              onClick=${() => remove({ id: r.id }).catch((e) => ctx.toast(errText(e)))}
            >
              Remove
            </button>
          </div>`
      )}
      <div className="row" style=${{ flexWrap: 'wrap', gap: 8 }}>
        <select
          className="field"
          style=${{ maxWidth: 150 }}
          aria-label="Exclude by"
          value=${kind}
          onChange=${(e: ValueEvent) => setKind(e.target.value as typeof kind)}
        >
          <option value="category">Category</option>
          <option value="product">Product id (or use the Pricing tab)</option>
        </select>
        <input
          className="field"
          style=${{ maxWidth: 240 }}
          placeholder=${kind === 'product' ? 'Product id' : 'e.g. clearance'}
          aria-label="What to exclude"
          value=${value}
          onInput=${(e: ValueEvent) => setValue(e.target.value)}
        />
        <input
          className="field"
          style=${{ maxWidth: 260 }}
          placeholder="Reason (required)"
          aria-label="Reason"
          value=${reason}
          onInput=${(e: ValueEvent) => setReason(e.target.value)}
        />
        <button
          className="btn btn-line"
          disabled=${!value.trim() || !reason.trim()}
          onClick=${save}
        >
          Exclude
        </button>
      </div>
    </div>
  </details>`;
}

function CommissionsCsv({ ctx }: { ctx: StaffContext }) {
  const [on, setOn] = useState(false);
  const query = useRecoverableQuery(api.holmAdmin.commissionsCsv, on ? {} : 'skip');
  const data = query.data;
  // Text that starts like a formula (= + - @, tab, return) is prefixed with ' so a spreadsheet shows it as text; numbers stay numbers.
  const cell = (v: string | number | null) => {
    let s = String(v);
    if (typeof v !== 'number' && !/^-?\d+(\.\d+)?$/.test(s) && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  useEffect(() => {
    if (on && data) {
      const csv = data.rows.map((r) => r.map(cell).join(',')).join('\n');
      saveBlob(
        new Blob([csv], { type: 'text/csv' }),
        `partner-commissions-${new Date().toISOString().slice(0, 10)}.csv`
      );
      setOn(false);
      ctx.toast(
        data.complete
          ? 'CSV downloaded'
          : 'CSV downloaded, but it is incomplete: there are more partners or rows than one export holds'
      );
    }
  }, [on, data, ctx]);
  if (on && query.status === 'unavailable') return html`<${StaffQueryState} query=${query} />`;
  return html`<button className="btn btn-line btn-sm" disabled=${on} onClick=${() => setOn(true)}>
    ${on ? 'Preparing…' : 'Export CSV · 12 months'}
  </button>`;
}

function TierOverride({
  p,
  setP,
  run,
}: {
  p: Partner;
  setP: SetPartner;
  run: (operation: Promise<unknown>, message: string) => Promise<void>;
}) {
  const [tier, setTier] = useState(p.tier);
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const save = () =>
    run(
      setP({
        userId: p.userId,
        tier,
        reason,
        ...(until ? { until: new Date(until + 'T23:59:59').getTime() } : {}),
      }),
      'Tier saved'
    );
  return html`<div style=${{ display: 'grid', gap: 8 }}>
    <p className="help" style=${{ margin: 0 }}>
      ${fmt(p.sales12Cents / 100, true)} in sales over 12 months.
      ${p.override
        ? `Tier held by the team: ${p.override.reason}${p.override.until ? `, until ${new Date(p.override.until).toLocaleDateString()}` : ''}.`
        : 'Tier follows sales automatically.'}
      ${p.override &&
      html` <button
        className="lnk"
        onClick=${() =>
          run(setP({ userId: p.userId, clearOverride: true }), 'Automatic tier resumes tonight')}
      >
        End the hold
      </button>`}
    </p>
    <div className="row" style=${{ flexWrap: 'wrap', gap: 8 }}>
      <select
        className="field"
        style=${{ maxWidth: 170 }}
        aria-label="Tier"
        value=${tier}
        onChange=${(e: ValueEvent) => setTier(e.target.value as typeof tier)}
      >
        ${[
          ['base', 'Base'],
          ['active', 'Active'],
          ['top', 'Top'],
          ['elite', 'Elite'],
        ].map(([k, l]) => html`<option key=${k} value=${k}>${l}</option>`)}
      </select>
      <input
        className="field"
        style=${{ maxWidth: 260 }}
        placeholder="Reason (required)"
        aria-label="Reason"
        value=${reason}
        onInput=${(e: ValueEvent) => setReason(e.target.value)}
      />
      <input
        className="field"
        style=${{ maxWidth: 170 }}
        type="date"
        aria-label="Hold until (optional)"
        value=${until}
        onInput=${(e: ValueEvent) => setUntil(e.target.value)}
      />
      <button className="btn btn-line" disabled=${!reason.trim()} onClick=${save}>Set tier</button>
    </div>
  </div>`;
}

function PartnersAdmin({ ctx }: { ctx: StaffContext }) {
  const query = useRecoverableQuery(api.holmPartners.adminPartners, {});
  const [retained, setRetained] = useState<typeof query.data>();
  if (query.data !== undefined && query.data !== retained) setRetained(query.data);
  const rows = query.data ?? retained;
  const preserve = (content: React.ReactNode) =>
    html`<${React.Fragment}>
      ${query.status !== 'ready' && html`<${StaffQueryState} query=${query} />`}
      <div hidden=${query.status !== 'ready'} inert=${query.status !== 'ready'}>${content}</div>
    <//>`;
  const setP = useMutation(api.holmPartners.adminSetPartner);
  const pay = useMutation(api.holmPartners.adminRecordPayout);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const run = (p: Promise<unknown>, ok: string) =>
    p.then(() => ctx.toast(ok)).catch((e) => ctx.toast(errText(e)));
  if (rows === undefined) return html`<${StaffQueryState} query=${query} />`;
  if (!rows.length)
    return preserve(
      html`<div style=${{ display: 'grid', gap: 14, marginTop: 18 }}>
        <div className="empty">
          <h3>No partners yet</h3>
          <p>Accounts that join the partner program appear here.</p>
        </div>
        <${ExclusionsAdmin} ctx=${ctx} />
      </div>`
    );
  // Payable on the 15th: $50 or more cleared and unpaid, and a way to pay them (Stripe ready
  // with automatic payouts on, or an approved W-9 for paying by hand).
  const auto = (p: Partner) => p.autoPayouts && p.payouts.ready;
  const payable = rows.filter((p) => p.unpaidCents >= 5000 && (auto(p) || p.w9Approved));
  const waiting = rows.filter((p) => p.unpaidCents >= 5000 && !auto(p) && !p.w9Approved);
  return preserve(
    html`<div style=${{ display: 'grid', gap: 14, marginTop: 18 }}>
      <div
        className="panel row"
        style=${{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}
      >
        <span
          ><b style=${{ fontWeight: 500 }}
            >Cleared and unpaid, due on the 15th:
            ${fmt(payable.reduce((t, p) => t + p.unpaidCents, 0) / 100, true)}</b
          >
          <span className="mute"
            >· ${payable.length} partner${payable.length === 1 ? '' : 's'}:
            ${payable.filter(auto).length} through Stripe automatically,
            ${payable.length - payable.filter(auto).length} by
            hand${waiting.length
              ? ` · ${waiting.length} more waiting on a W-9 or Stripe setup`
              : ''}</span
          ></span
        >
        <${CommissionsCsv} ctx=${ctx} />
      </div>
      <${ExclusionsAdmin} ctx=${ctx} />
      ${rows.map(
        (p) =>
          html`<div key=${p.userId} className="panel" style=${{ display: 'grid', gap: 10 }}>
            <div className="row" style=${{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <h3>${p.name}</h3>
              <span className="mono mute">${p.email} · ${p.refCode}</span>
            </div>
            <div className="kv">
              <span className="mono mute">Pending</span
              ><span>${fmt(p.pendingCents / 100, true)}</span
              ><span className="mono mute">Cleared</span
              ><span>${fmt(p.clearedCents / 100, true)}</span><span className="mono mute">Paid</span
              ><span>${fmt(p.paidCents / 100, true)}</span><span className="mono mute">W-9</span
              ><span
                >${p.w9Status === 'none'
                  ? 'Not uploaded'
                  : html`${p.w9Url &&
                    html`<a href=${p.w9Url} target="_blank" rel="noopener">View</a>
                      · `}${p.w9Status === 'approved'
                      ? 'Approved'
                      : html`<button
                          className="lnk"
                          onClick=${() =>
                            run(setP({ userId: p.userId, w9Approved: true }), 'W-9 approved')}
                        >
                          Approve
                        </button>`}`}</span
              >
            </div>
            <p className="help" style=${{ margin: 0 }}>
              ${p.nextTier}. Payouts:
              ${p.payouts.ready
                ? 'Stripe ready'
                : p.payouts.connected
                  ? p.payouts.due
                    ? 'Stripe needs details from the partner'
                    : 'Stripe setup in progress'
                  : 'not connected (paid by hand)'}.
              Unpaid and cleared: ${fmt(p.unpaidCents / 100, true)}.
            </p>
            <${TierOverride}
              key=${p.tier + (p.override?.reason || '')}
              p=${p}
              setP=${setP}
              run=${run}
            />
            <${PartnerLedger} userId=${p.userId} ctx=${ctx} />
            <div className="row" style=${{ flexWrap: 'wrap' }}>
              ${p.clearedCents > 0 &&
              html`<input
                  className="field"
                  style=${{ maxWidth: 260 }}
                  placeholder="Payment reference"
                  value=${refs[p.userId] || ''}
                  onInput=${(e: ValueEvent) => setRefs({ ...refs, [p.userId]: e.target.value })}
                /><button
                  className="btn btn-ink"
                  onClick=${() =>
                    run(
                      pay({ userId: p.userId, reference: refs[p.userId] || '' }),
                      'Payout recorded'
                    )}
                >
                  Record payout of ${fmt(p.clearedCents / 100, true)}
                </button>`}
            </div>
          </div>`
      )}
    </div>`
  );
}

function TradeAdmin({ ctx }: { ctx: StaffContext }) {
  const [status, setStatus] = useState<ApplicationStatus>('pending');
  const query = useRecoverableQuery(api.holm.adminApplications, ctx.me.admin ? { status } : 'skip');
  const rows = query.data;
  const review = useMutation(api.holm.reviewApplication);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  if (!ctx.me.admin) return null;
  const decide = async (id: ReviewArgs['id'], decision: ReviewArgs['decision']) => {
    setBusy(id + decision);
    try {
      await review({ id, decision, note: notes[id] || undefined });
      ctx.toast('Saved');
    } catch (e) {
      ctx.toast(errText(e));
    } finally {
      setBusy('');
    }
  };
  return html`<div>
    <div className="ph-head">
      <div className="seg">
        ${[
          ['pending', 'In review'],
          ['needs_info', 'Needs info'],
          ['approved', 'Approved'],
          ['rejected', 'Not approved'],
        ].map(
          ([k, l]) =>
            html`<button
              key=${k}
              className=${status === k ? 'on' : ''}
              onClick=${() => setStatus(k as typeof status)}
            >
              ${l}
            </button>`
        )}
      </div>
    </div>
    ${rows === undefined
      ? html`<${StaffQueryState} query=${query} />`
      : !rows.length
        ? html`<div className="empty">
            <h3>Nothing here</h3>
            <p>No applications with this status.</p>
          </div>`
        : html`<div style=${{ display: 'grid', gap: 14 }}>
            ${rows.map(
              (r) =>
                html`<div key=${r._id} className="panel" style=${{ display: 'grid', gap: 10 }}>
                  <div
                    className="row"
                    style=${{ justifyContent: 'space-between', flexWrap: 'wrap' }}
                  >
                    <h3>${r.businessName}</h3>
                    <span className="mono mute">${new Date(r.submittedAt).toLocaleString()}</span>
                  </div>
                  <dl
                    className="specs"
                    style=${{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}
                  >
                    <div>
                      <dt>Type</dt>
                      <dd>${BTYPES[r.businessType]?.l || r.businessType}</dd>
                    </div>
                    <div>
                      <dt>State</dt>
                      <dd>${r.state}</dd>
                    </div>
                    <div>
                      <dt>EIN</dt>
                      <dd className="num">••-•••${r.einLast4}</dd>
                    </div>
                    <div>
                      <dt>Online</dt>
                      <dd>${r.website}</dd>
                    </div>
                    <div>
                      <dt>Credential</dt>
                      <dd>
                        ${r.businessType === 'pm' ? `${r.company} · ${r.workEmail}` : r.credential}
                      </dd>
                    </div>
                    <div>
                      <dt>Account</dt>
                      <dd>${r.email}</dd>
                    </div>
                    <div>
                      <dt>Tax exemption</dt>
                      <dd>
                        ${r.taxRequested
                          ? r.certificateUrl
                            ? html`<a href=${r.certificateUrl} target="_blank" rel="noopener"
                                >View certificate</a
                              >`
                            : 'Requested, no file'
                          : 'No'}
                      </dd>
                    </div>
                  </dl>
                  ${status === 'pending' || status === 'needs_info'
                    ? html`<textarea
                          className="field"
                          rows="2"
                          aria-label="Note to the applicant"
                          placeholder="Note to the applicant (sent with needs info or not approved)"
                          value=${notes[r._id] || ''}
                          onInput=${(e: ValueEvent) =>
                            setNotes({ ...notes, [r._id]: e.target.value })}
                        ></textarea>
                        <div className="row" style=${{ flexWrap: 'wrap' }}>
                          <button
                            className="btn btn-ink"
                            disabled=${!!busy}
                            onClick=${() => decide(r._id, 'approved')}
                          >
                            Approve</button
                          ><button
                            className="btn btn-line"
                            disabled=${!!busy}
                            onClick=${() => decide(r._id, 'needs_info')}
                          >
                            Ask for more information</button
                          ><button
                            className="btn btn-line"
                            disabled=${!!busy}
                            onClick=${() => decide(r._id, 'rejected')}
                          >
                            Don't approve
                          </button>
                        </div>`
                    : r.reviewNote && html`<p className="help">${r.reviewNote}</p>`}
                </div>`
            )}
          </div>`}
  </div>`;
}
