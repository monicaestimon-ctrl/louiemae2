/** Stable public identity: a product rename does not change its address. */
export function productUrl(id: string, variantId?: string) {
  return `/products/${encodeURIComponent(id)}${variantId ? `?variant=${encodeURIComponent(variantId)}` : ''}`;
}

/** Parse public product routes, returning an empty identity for malformed product paths. */
export function productRoute(route: string): { id: string; variantId?: string } | null {
  if (!route.startsWith('/products/')) return null;
  const [path, query] = route.split('?');
  try {
    const id = decodeURIComponent(path.slice('/products/'.length));
    // Reject malformed paths before asking the backend; its ID normalization is authoritative.
    if (!id || /[\s/\\?#]/.test(id)) return { id: '' };
    return { id, variantId: new URLSearchParams(query).get('variant') || undefined };
  } catch {
    return { id: '' };
  }
}

/** Resolve real product paths and existing hash routes through one route table. */
export function storefrontRoute(location: { pathname: string; search: string; hash: string }) {
  const path = location.pathname.replace(/\/+$/, '');
  if (path === '/admin') return 'admin';
  const full = location.hash;
  const [hash] = full.split('?');
  if (hash.startsWith('#collection/')) {
    const params = new URLSearchParams(full.split('?')[1]);
    const product = params.get('product');
    if (product) return productUrl(product, params.get('variant') || undefined);
  }
  const simple: Record<string, string> = {
    '#admin': 'admin',
    '#blog': 'blog',
    '#story': 'story',
    '#shop': 'shop',
    '#new-arrivals': 'new-arrivals',
    '#creators': 'creators',
    '#checkout/success': 'checkout-success',
    '#checkout/cancel': 'checkout-cancel',
    '#collection/new': 'new-collection',
  };
  if (simple[hash]) return simple[hash];
  if (/^#(?:blog|pages)\//.test(hash)) return hash;
  if (/^#(?:support|collection)(?:\/|$)/.test(hash)) return full;
  if (path.startsWith('/products/') || path === '/products')
    return `${path === '/products' ? '/products/' : path}${location.search}`;
  return 'home';
}

/** Push a same-origin route without leaving the shared cart; native Back emits the same event. */
export function navigateStorefront(
  href: string,
  options: { replace?: boolean; state?: Record<string, unknown>; scroll?: boolean } = {}
) {
  const url = new URL(href, `${window.location.origin}/`);
  if (url.origin !== window.location.origin) return;
  window.history[options.replace ? 'replaceState' : 'pushState'](
    options.state ?? {},
    '',
    url.pathname + url.search + url.hash
  );
  window.dispatchEvent(new window.PopStateEvent('popstate', { state: options.state ?? {} }));
  if (options.scroll !== false) window.scrollTo(0, 0);
}
