import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { ArrowRight, Minus, Plus, X, ShoppingBag } from 'lucide-react';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { categories, range, type PublicFurniture } from '../lib/furniture';
import { CommerceCatalog } from '../components/CommerceCatalog';

type Selection = { productId: string; variantId: string; quantity: number };
const storageKey = 'house-of-louie-mae-quote-v1';
const previewProducts: PublicFurniture[] = [
  ['chair', 'The Sunday Chair', 'Chairs', 'ivory-wood-chair', 500],
  ['table', 'Walnut Coffee Table', 'Tables', 'walnut-coffee-table', 800],
  ['sofa', 'The Gather Sofa', 'Sofas', 'ochre-sofa', 1800],
  ['stool', 'Woven Counter Stool', 'Stools', 'woven-counter-stools', 400],
  ['lounge', 'Cognac Lounge Chair', 'Chairs', 'cognac-lounge-chair', 700],
  ['curve', 'Terracotta Sofa', 'Sofas', 'terracotta-curved-sofa', 1900],
].map(([id, name, category, photo, lower]) => ({
  id: String(id),
  name: String(name),
  category: String(category),
  description:
    'Illustrative preview only. Import and review a supplier listing to publish actual product details.',
  images: [`/images/prelaunch/furniture/${photo}.webp`],
  dimensions: '',
  materials: '',
  variants: [
    {
      id: 'standard',
      name: 'Standard',
      minimum: 1,
      lower: Number(lower),
      upper: Number(lower) + 100,
    },
  ],
}));
export function Brand() {
  return (
    <a className="fh-brand" href="/furniture">
      <span>HOUSE OF</span>
      <strong>LOUIE MAE</strong>
    </a>
  );
}
export function FurnitureCatalog() {
  const preview = new URLSearchParams(location.search).get('preview') === '1';
  const catalog = useQuery(api.furniture.catalog, preview ? 'skip' : {});
  const products = preview ? previewProducts : catalog;
  const submit = useMutation(api.furniture.submit);
  const [category, setCategory] = useState('All furniture');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Selection[]>(() => {
    if (preview) return [];
    try {
      const v = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(v)
        ? v
            .filter(
              (i) =>
                typeof i.productId === 'string' &&
                typeof i.variantId === 'string' &&
                Number.isInteger(i.quantity) &&
                i.quantity > 0 &&
                i.quantity <= 9999
            )
            .slice(0, 50)
        : [];
    } catch {
      return [];
    }
  });
  const [detail, setDetail] = useState<PublicFurniture | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState('');
  const token = useRef(window.crypto.randomUUID());
  useEffect(() => {
    if (!preview)
      try {
        localStorage.setItem(storageKey, JSON.stringify(selected));
      } catch {
        /* Storage can be unavailable in private browsing. */
      }
  }, [selected, preview]);
  const lines = selected.map((s) => {
    const product = products?.find((p) => p.id === s.productId);
    return { ...s, product, variant: product?.variants.find((v) => v.id === s.variantId) };
  });
  const invalid = lines.some((l) => !l.variant || l.quantity < l.variant.minimum);
  const low = lines.reduce((sum, l) => sum + (l.variant?.lower || 0) * l.quantity, 0);
  const high = lines.reduce((sum, l) => sum + (l.variant?.upper || 0) * l.quantity, 0);
  const count = selected.reduce((sum, l) => sum + l.quantity, 0);
  const change = (index: number, quantity: number) =>
    setSelected((s) =>
      s.map((i, n) =>
        n === index ? { ...i, quantity: Math.max(1, Math.min(9999, Math.floor(quantity) || 1)) } : i
      )
    );
  async function request(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (preview) {
      setError('This is a visual preview. Import real products before accepting requests.');
      return;
    }
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      const id = await submit({
        token: token.current,
        name: String(f.get('name')),
        email: String(f.get('email')),
        business: String(f.get('business')),
        address: String(f.get('address')),
        phone: String(f.get('phone')),
        notes: String(f.get('notes')),
        service: String(f.get('service')),
        website: String(f.get('website') || ''),
        items: selected.map((i) => ({ ...i, productId: i.productId as Id<'furnitureProducts'> })),
      });
      setReference(String(id).slice(-8).toUpperCase());
      setSelected([]);
      token.current = window.crypto.randomUUID();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not save your request. Please try again.'
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fh">
      <header className="fh-header">
        <Brand />
        <nav>
          <a href="#how-it-works">How it works</a>
          <button
            className="fh-bag"
            onClick={() => {
              setDrawer(true);
              setReference('');
            }}
          >
            <ShoppingBag size={17} /> Your quote <span>{count}</span>
          </button>
        </nav>
      </header>
      {preview && (
        <p className="fh-preview">
          Design preview · illustrative furniture and prices · requests are disabled
        </p>
      )}
      <main className="fh-shell">
        <section className="fh-intro">
          <div>
            <p className="fh-eyebrow">FOR HOMES, CAFÉS & GATHERING PLACES</p>
            <h1>
              Good spaces begin
              <br />
              with thoughtful pieces.
            </h1>
            <p>
              Furniture with character, chosen for your space.
              <br />
              Build your selection. We’ll take care of the final quote.
            </p>
          </div>
          <div className="fh-note">
            <span>01 / A MORE PERSONAL WAY TO FURNISH</span>
            <p>
              Choose the pieces you love.
              <br />
              Tell us what you have in mind.
            </p>
            <small>Estimates only. No payment required.</small>
          </div>
        </section>
        <div className="fh-toolbar">
          <div className="fh-filters">
            {['All furniture', ...categories].map((c) => (
              <button
                key={c}
                aria-pressed={category === c}
                className={category === c ? 'active' : ''}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <input
            aria-label="Search furniture"
            placeholder="Find a piece…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {!products ? (
          <p role="status">Gathering the collection…</p>
        ) : (
          <>
            <div className="fh-grid">
              {products
                .filter(
                  (p) =>
                    (category === 'All furniture' || p.category === category) &&
                    `${p.name} ${p.description}`.toLowerCase().includes(search.toLowerCase())
                )
                .map((p) => (
                  <button className="fh-card" key={p.id} onClick={() => setDetail(p)}>
                    <div className="fh-photo">
                      <img src={p.images[0]} alt={p.name} loading="lazy" />
                      <span>
                        Discover piece <ArrowRight size={15} />
                      </span>
                    </div>
                    <div className="fh-card-copy">
                      <small>{p.category}</small>
                      <h2>{p.name}</h2>
                      <p>
                        {p.variants.length > 1 ? 'From ' : ''}
                        {range(
                          Math.min(...p.variants.map((v) => v.lower)),
                          Math.min(...p.variants.map((v) => v.upper))
                        )}{' '}
                        <span>/ each</span>
                      </p>
                    </div>
                  </button>
                ))}
            </div>
            {!products.length ? (
              <div className="fh-empty">
                <h2>A considered collection is on its way.</h2>
                <p>
                  We’re gathering furniture for spaces made to be lived in. Please check back soon.
                </p>
              </div>
            ) : (
              !products.some(
                (p) =>
                  (category === 'All furniture' || p.category === category) &&
                  `${p.name} ${p.description}`.toLowerCase().includes(search.toLowerCase())
              ) && <p>No pieces match this search. Try another category.</p>
            )}
          </>
        )}
        {!preview && <CommerceCatalog channel="house" />}
        <section id="how-it-works" className="fh-how">
          {[
            ['01', 'Choose your pieces', 'Select your preferred finishes and quantities.'],
            ['02', 'Tell us about your space', 'Share your address, timing and delivery needs.'],
            [
              '03',
              'Receive a personal quote',
              'We’ll confirm availability and your delivered price.',
            ],
          ].map(([n, title, text]) => (
            <div key={n}>
              <span>{n}</span>
              <h2>{title}</h2>
              <p>{text}</p>
            </div>
          ))}
        </section>
        <p className="fh-disclaimer">
          Prices are merchandise estimates per item. Delivery and applicable taxes are quoted
          separately. Preferred project pricing may be available for larger orders. Availability and
          final pricing are confirmed before purchase.
        </p>
      </main>
      <footer className="fh-footer">
        <Brand />
        <p>Furniture for a life well gathered.</p>
      </footer>
      {detail && (
        <ProductDialog
          product={detail}
          close={() => setDetail(null)}
          add={(variantId, quantity) => {
            setSelected((old) => {
              const match = old.find((i) => i.productId === detail.id && i.variantId === variantId);
              return match
                ? old.map((i) =>
                    i === match ? { ...i, quantity: Math.min(9999, i.quantity + quantity) } : i
                  )
                : [...old, { productId: detail.id, variantId, quantity }];
            });
            setDetail(null);
            setReference('');
            setDrawer(true);
          }}
        />
      )}
      {drawer && (
        <Dialog
          title={reference ? 'Request received' : 'Your selection'}
          close={() => setDrawer(false)}
        >
          {reference ? (
            <div className="fh-success">
              <p className="fh-eyebrow">THANK YOU FOR INVITING US IN</p>
              <h2>We’ll be in touch.</h2>
              <p>
                Your request is saved. Keep reference <strong>{reference}</strong> for your records.
              </p>
              <p>
                We’ll review your pieces, availability and delivery needs before preparing your
                final quote.
              </p>
              <button onClick={() => setDrawer(false)}>Continue browsing</button>
            </div>
          ) : (
            <>
              <p className="fh-muted">A starting point for your space. No payment today.</p>
              {lines.map((l, i) => (
                <div className="fh-line" key={`${l.productId}:${l.variantId}`}>
                  <div>
                    <strong>{l.product?.name || 'Unavailable piece'}</strong>
                    <small>{l.variant?.name || 'Remove this option to continue'}</small>
                    {l.variant && (
                      <small>
                        {range(l.variant.lower, l.variant.upper)} / each · Min. {l.variant.minimum}
                      </small>
                    )}
                  </div>
                  <input
                    aria-label={`Quantity for ${l.product?.name || 'unavailable piece'}`}
                    type="number"
                    min={l.variant?.minimum || 1}
                    max="9999"
                    value={l.quantity}
                    onChange={(e) => change(i, Number(e.target.value))}
                  />
                  <button
                    aria-label={`Remove ${l.product?.name || 'unavailable piece'}`}
                    className="fh-icon"
                    onClick={() => setSelected((s) => s.filter((_, n) => i !== n))}
                  >
                    <X size={18} />
                  </button>
                </div>
              ))}
              {!lines.length ? (
                <p>Your selection is empty. Browse the collection to add a piece.</p>
              ) : (
                <>
                  <div className="fh-total">
                    <span>Merchandise estimate</span>
                    <strong>{range(low, high)}</strong>
                  </div>
                  <small>
                    Delivery and tax quoted separately. Larger projects may qualify for preferred
                    pricing.
                  </small>
                  {invalid && (
                    <p role="alert">
                      Please remove unavailable items and check minimum quantities.
                    </p>
                  )}
                  <form className="fh-form" onSubmit={request}>
                    <h2>Tell us about your project</h2>
                    <label>
                      Name
                      <input name="name" autoComplete="name" required maxLength={150} />
                    </label>
                    <label>
                      Email
                      <input
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        maxLength={254}
                      />
                    </label>
                    <label>
                      Business or project name <small>(optional)</small>
                      <input name="business" maxLength={200} />
                    </label>
                    <label>
                      Phone <small>(optional)</small>
                      <input name="phone" type="tel" autoComplete="tel" maxLength={50} />
                    </label>
                    <label>
                      Full delivery address, including ZIP and country
                      <textarea
                        name="address"
                        autoComplete="street-address"
                        required
                        minLength={10}
                        maxLength={1000}
                      />
                    </label>
                    <label>
                      Delivery preference
                      <select name="service">
                        <option>Curbside delivery</option>
                        <option>Inside placement</option>
                        <option>White glove with assembly</option>
                        <option>Please advise</option>
                      </select>
                    </label>
                    <label>
                      Timing, stairs, access or other notes
                      <textarea name="notes" maxLength={3000} />
                    </label>
                    <label className="fh-honeypot" aria-hidden="true">
                      Website
                      <input name="website" tabIndex={-1} autoComplete="off" />
                    </label>
                    <small>
                      We use these details to prepare and follow up on your quote request.
                    </small>
                    {error && (
                      <p role="alert" className="fh-error">
                        {error}
                      </p>
                    )}
                    <button className="fh-primary" disabled={busy || invalid}>
                      {busy ? 'Saving your request…' : 'Request my final quote'}{' '}
                      <ArrowRight size={18} />
                    </button>
                  </form>
                </>
              )}
            </>
          )}
        </Dialog>
      )}
    </div>
  );
}
export function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<React.ComponentRef<'dialog'>>(null);
  useEffect(() => {
    const el = ref.current;
    const active = document.activeElement as HTMLElement;
    el?.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      el?.close();
      document.body.style.overflow = old;
      active?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="fh-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="fh-dialog-head">
        <h2>{title}</h2>
        <button className="fh-icon" aria-label="Close dialog" onClick={close}>
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function ProductDialog({
  product,
  close,
  add,
}: {
  product: PublicFurniture;
  close: () => void;
  add: (id: string, quantity: number) => void;
}) {
  const [variantId, setVariant] = useState(product.variants[0].id);
  const [quantity, setQuantity] = useState(product.variants[0].minimum);
  const [photo, setPhoto] = useState(0);
  const variant = product.variants.find((v) => v.id === variantId)!;
  return (
    <Dialog title={product.name} close={close}>
      <img className="fh-detail-photo" src={product.images[photo]} alt={product.name} />
      <div className="fh-thumbs">
        {product.images.map((src, i) => (
          <button
            key={`${src}-${i}`}
            aria-label={`View photo ${i + 1}`}
            aria-pressed={photo === i}
            onClick={() => setPhoto(i)}
          >
            <img src={src} alt="" />
          </button>
        ))}
      </div>
      <p className="fh-description">{product.description}</p>
      {product.dimensions && (
        <p>
          <strong>Dimensions:</strong> {product.dimensions}
        </p>
      )}
      {product.materials && (
        <p>
          <strong>Materials:</strong> {product.materials}
        </p>
      )}
      <div className="fh-form">
        <label>
          Finish / option
          <select
            value={variantId}
            onChange={(e) => {
              setVariant(e.target.value);
              setQuantity(product.variants.find((v) => v.id === e.target.value)!.minimum);
            }}
          >
            {product.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <p className="fh-price">
          {range(variant.lower, variant.upper)} <small>/ each, estimated</small>
        </p>
        <label>
          Quantity (minimum {variant.minimum})
          <div className="fh-quantity">
            <button
              type="button"
              aria-label="Decrease quantity"
              onClick={() => setQuantity((q) => Math.max(variant.minimum, q - 1))}
            >
              <Minus size={16} />
            </button>
            <input
              type="number"
              min={variant.minimum}
              max="9999"
              value={quantity}
              onChange={(e) =>
                setQuantity(
                  Math.min(
                    9999,
                    Math.max(variant.minimum, Math.floor(Number(e.target.value)) || variant.minimum)
                  )
                )
              }
            />
            <button
              type="button"
              aria-label="Increase quantity"
              onClick={() => setQuantity((q) => Math.min(9999, q + 1))}
            >
              <Plus size={16} />
            </button>
          </div>
        </label>
        <button className="fh-primary" onClick={() => add(variant.id, quantity)}>
          Add to my quote <ArrowRight size={18} />
        </button>
        <small>Availability, delivery and final pricing confirmed with your quote.</small>
      </div>
    </Dialog>
  );
}
