/* global HTMLMetaElement, Window */
/** Indexing policy for private routes; authorization remains server-owned. */
export type RouteLocation = { pathname: string; search: string; hash: string };
export function privateLocation(location: RouteLocation): boolean {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const query = new URLSearchParams(location.search);
  const hash = location.hash.replace(/^#/, '');
  const route = hash.split('?')[0];
  if (query.has('code') || query.has('session_id')) return true;
  if (
    query.has('deliveryQuote') ||
    query.has('delivery-access') ||
    new URLSearchParams(hash).has('delivery-access')
  )
    return true;
  if (
    path === '/admin' ||
    path === '/furniture/admin' ||
    path === '/furniture/index.html' ||
    /^admin(?:\/|$)/.test(route)
  )
    return true;
  if (/^checkout(?:\/|$)/.test(route)) return true;
  if (path === '/trade' || path === '/trade/index.html') {
    // Public marketing and policy information only. Catalog and project states
    // are deliberately excluded from indexing regardless of viewer role.
    return !['', 'home', 'welcome', 'partner-terms'].includes(route);
  }
  if (
    !route ||
    ['home', 'main-content', 'story', 'shop', 'blog', 'new-arrivals', 'creators'].includes(route)
  )
    return false;
  return !/^(?:collection|blog|pages|support)(?:\/|$)/.test(route);
}

type Entry = { node: HTMLMetaElement; original: string | null; applied: string; created: boolean };
type LeaseState = { leases: Set<symbol>; entries: Entry[]; observer: MutationObserver };
const states = new WeakMap<Document, LeaseState>();
function privateDirectives(original: string | null) {
  const retained = (original || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value && !/^(?:index|follow|all|noindex|nofollow)$/i.test(value));
  return [...retained, 'noindex', 'nofollow'].join(', ');
}
/** Compose independent private surfaces, preserving the pre-existing robots policy. */
export function acquirePrivateIndexing(doc: Document): () => void {
  let state = states.get(doc);
  if (!state) {
    const entries: Entry[] = [];
    const refresh = () => {
      let nodes = [...doc.head.querySelectorAll<HTMLMetaElement>('meta[name="robots" i]')];
      if (!nodes.length) {
        const node = doc.createElement('meta');
        node.name = 'robots';
        entries.push({ node, original: null, applied: '', created: true });
        doc.head.append(node);
        nodes = [node];
      }
      for (const node of nodes) {
        let entry = entries.find((item) => item.node === node);
        if (!entry) {
          entry = { node, original: node.getAttribute('content'), applied: '', created: false };
          entries.push(entry);
        } else if (entry.applied && node.getAttribute('content') !== entry.applied) {
          entry.original = node.getAttribute('content');
          entry.created = false;
        }
        entry.applied = privateDirectives(entry.original);
        if (node.getAttribute('content') !== entry.applied)
          node.setAttribute('content', entry.applied);
      }
    };
    refresh();
    const Observer = doc.defaultView?.MutationObserver;
    if (!Observer) throw new Error('DOM observation is unavailable');
    const observer = new Observer(refresh);
    observer.observe(doc.head, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['name', 'content'],
    });
    state = { leases: new Set(), entries, observer };
    states.set(doc, state);
  }
  const owner = Symbol('private-surface');
  state.leases.add(owner);
  const current = state;
  return () => {
    if (!current.leases.delete(owner) || current.leases.size) return;
    current.observer.disconnect();
    states.delete(doc);
    for (const entry of current.entries) {
      if (
        !entry.node.isConnected ||
        entry.node.name.toLowerCase() !== 'robots' ||
        entry.node.getAttribute('content') !== entry.applied
      )
        continue;
      if (entry.created) entry.node.remove();
      else if (entry.original === null) entry.node.removeAttribute('content');
      else entry.node.setAttribute('content', entry.original);
    }
  };
}

const installations = new WeakMap<Window, () => void>();
/** Install before asynchronous app loading, then follow route changes synchronously. */
export function installPrivateLocationPolicy(win: Window): () => void {
  const existing = installations.get(win);
  if (existing) return existing;
  let release: (() => void) | null = null;
  const update = () => {
    const required = privateLocation(win.location);
    if (required && !release) release = acquirePrivateIndexing(win.document);
    else if (!required && release) {
      release();
      release = null;
    }
  };
  update();
  win.addEventListener('hashchange', update);
  win.addEventListener('popstate', update);
  const stop = () => {
    win.removeEventListener('hashchange', update);
    win.removeEventListener('popstate', update);
    release?.();
    release = null;
    installations.delete(win);
  };
  installations.set(win, stop);
  return stop;
}
