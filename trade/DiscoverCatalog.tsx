import { useRef, useState, type ReactNode } from 'react';
import { Camera, Search } from 'lucide-react';
import { toneDistance as distance } from '../lib/holmCatalogFacets';
import type { HolmProduct } from './catalog';

type ImageQuery = { src: string; pal: string[] };
type Trend = { id: string; name: string; image: string };
type Props = {
  products: HolmProduct[];
  pricing?: 'retail' | 'trade';
  query: string;
  imageQuery: ImageQuery | null;
  types: Record<string, string>;
  materials: Record<string, string>;
  trends: Trend[];
  matchQuery: (query: string) => HolmProduct[];
  onQuery: (query: string) => void;
  onClearImage: () => void;
  onImage: (file: File) => void;
  onTrend: (id: string) => void;
  onSourcing: () => void;
  renderProducts: (products: HolmProduct[], searching: boolean) => ReactNode;
};
const PALETTE = [['Cognac', '#A0612F'], ['Tan', '#B07A4A'], ['Espresso', '#6B4A33'], ['Olive', '#5E6338'], ['Ivory', '#E7DFD0'], ['Stone', '#CFCBC4'], ['Black', '#2A2522'], ['Brass', '#B58D52']];
const dollars = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(item => item !== value) : [...values, value];

/** Typed catalog boundary. Server pagination remains a separate migration. */
export function DiscoverCatalog(props: Props) {
  const [draft, setDraft] = useState({ source: props.query, value: props.query });
  if (draft.source !== props.query) setDraft({ source: props.query, value: props.query });
  const query = draft.source === props.query ? draft.value : props.query;
  const [type, setType] = useState('all');
  const [materials, setMaterials] = useState<string[]>([]);
  const [tones, setTones] = useState<string[]>([]);
  const photoKey = JSON.stringify(props.imageQuery);
  const [toneSource, setToneSource] = useState(photoKey);
  if (toneSource !== photoKey) {
    setToneSource(photoKey);
    const available = new Set([...PALETTE.map(([, color]) => color), ...(props.imageQuery?.pal ?? [])]);
    setTones(previous => previous.filter(color => available.has(color)));
  }
  const [maximum, setMaximum] = useState<number | null>(null);
  const [inStock, setInStock] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [sort, setSort] = useState('rel');
  const file = useRef<HTMLInputElement>(null);
  const priceOf = (product: HolmProduct) => props.pricing === 'trade' ? product.trade ?? product.price : product.price;
  const rangeMaximum = Math.ceil(Math.max(300, maximum ?? 0,
    ...props.products.map(priceOf).filter(Number.isFinite)) / 50) * 50;
  let products = query.trim() ? props.matchQuery(query) : [...props.products];
  if (query.trim() && !products.length) products = props.products.filter(product => `${product.name} ${product.line}`.toLowerCase().includes(query.toLowerCase()));
  const palette = props.imageQuery?.pal ?? [];
  if (palette.length) products = [...products].sort((a, b) => Math.min(...palette.map(color => distance(color, a.tone))) - Math.min(...palette.map(color => distance(color, b.tone))));
  products = products.filter(product => (type === 'all' || product.type === type) && (!materials.length || materials.includes(product.mat)) && (!tones.length || tones.some(tone => distance(tone, product.tone) < 48)) && (maximum === null || priceOf(product) <= maximum) && (!inStock || !product.oos));
  if (sort !== 'rel') products = [...products].sort((a, b) => {
    const left = priceOf(a), right = priceOf(b);
    if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : 0;
    if (!Number.isFinite(right)) return -1;
    return sort === 'lo' ? left - right : right - left;
  });
  const searching = Boolean(query.trim() || props.imageQuery);
  const count = materials.length + tones.length + Number(inStock) + Number(maximum !== null);
  function resetFilters() { setMaterials([]); setTones([]); setType('all'); setMaximum(null); setInStock(false); }
  return <main className="wrap">
    <div className="ph-head"><div><span className="eyebrow">Discover</span><h1>{searching ? <>Results{query.trim() && <> for <em>{query}</em></>}</> : <>Find the piece, <em>then the room.</em></>}</h1></div>
      <form className="search" style={{ maxWidth: 520, margin: 0, flex: '1 1 320px', display: 'flex' }} onSubmit={event => { event.preventDefault(); props.onQuery(query); props.onClearImage(); }}>
        <Search aria-hidden="true" /><input aria-label="Search" value={query} onChange={event => setDraft({ source: props.query, value: event.target.value })} placeholder="Search by piece, material, color or space" />
        <button type="button" className="ib" aria-label="Search with a photo" onClick={() => file.current?.click()}><Camera aria-hidden="true" /></button>
        <input ref={file} type="file" accept="image/*" hidden onChange={event => { const selected = event.target.files?.[0]; if (selected) props.onImage(selected); event.target.value = ''; }} />
      </form>
    </div>
    {props.imageQuery && <div className="img-q"><img src={props.imageQuery.src} alt="Your photo" /><div style={{ flex: 1, minWidth: 200 }}><b style={{ fontWeight: 500 }}>Matched to the tones in your photo</b><div className="row" style={{ marginTop: 6, gap: 6 }}>{palette.map(color => <button key={color} className="dot" style={{ width: 26, height: 26, background: color }} aria-label={`Filter by ${color}`} aria-pressed={tones.includes(color)} onClick={() => setTones(toggle(tones, color))} />)}<span className="mono mute">Tap a tone to narrow</span></div></div><button className="btn btn-line btn-sm" onClick={props.onClearImage}>Clear photo</button></div>}
    {!searching && <div className="trend-row">{props.trends.map(trend => <button key={trend.id} className="trend" onClick={() => props.onTrend(trend.id)}><img src={trend.image} alt="" loading="lazy" /><div><span className="up">Explore</span><h2>{trend.name}</h2></div></button>)}</div>}
    <div className="filters"><div className="scroll-x">{[['all', 'Everything'], ...Object.entries(props.types)].map(([key, label]) => <button key={key} className={`chip${type === key ? ' on' : ''}`} aria-pressed={type === key} onClick={() => setType(key)}>{label}</button>)}</div><span style={{ flex: 1 }} />
      <button className={`chip${expanded ? ' on' : ''}`} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>Filters{count > 0 && ` · ${count}`}</button>
      <select className="field" style={{ height: 44, width: 'auto', borderRadius: 999, fontSize: 13 }} value={sort} onChange={event => setSort(event.target.value)} aria-label="Sort"><option value="rel">Most relevant</option><option value="lo">Price, low to high</option><option value="hi">Price, high to low</option></select>
    </div>
    {expanded && <div className="filters filters-more">{Object.entries(props.materials).map(([key, label]) => <button key={key} className={`chip${materials.includes(key) ? ' on' : ''}`} aria-pressed={materials.includes(key)} onClick={() => setMaterials(toggle(materials, key))}>{label}</button>)}
      <div className="swatches" role="group" aria-label="Color palette">{PALETTE.map(([name, color]) => <button key={color} className={tones.includes(color) ? 'on' : ''} style={{ background: color, width: 26, height: 26 }} aria-label={name} aria-pressed={tones.includes(color)} onClick={() => setTones(toggle(tones, color))} />)}</div>
      <label className="row" style={{ fontSize: 13, gap: 8 }}>Price <b className="num" style={{ fontWeight: 500, minWidth: 56 }}>{maximum === null ? 'Any price' : `Up to ${dollars(maximum)}`}</b><input type="range" min="0" max={rangeMaximum} step="50" value={maximum ?? rangeMaximum} onChange={event => { const value = Number(event.target.value); setMaximum(value === rangeMaximum ? null : value); }} style={{ width: 120 }} aria-label="Maximum price" aria-valuetext={maximum === null ? 'Any price' : dollars(maximum)} /></label>
      <button className="toggle" style={{ fontSize: 13 }} aria-pressed={inStock} onClick={() => setInStock(!inStock)}><span className={`sw${inStock ? ' on' : ''}`} /> In stock</button>
    </div>}
    <p className="mono mute" role="status" style={{ marginBottom: 14 }}>{products.length} piece{products.length === 1 ? '' : 's'}</p>
    {products.length < 6 && <div className="sr-cta"><span><b>Not seeing the right piece?</b><br /><span className="mute" style={{ fontSize: 14 }}>Ask us to help source a piece for your project.</span></span><button className="btn btn-ink btn-sm" onClick={props.onSourcing}>Request sourcing</button></div>}
    {products.length ? props.renderProducts(products, searching) : <div className="empty"><h3>Nothing matches all of that</h3><p>Try removing a material or raising the price limit.</p><button className="btn btn-line" onClick={resetFilters}>Clear filters</button></div>}
  </main>;
}
