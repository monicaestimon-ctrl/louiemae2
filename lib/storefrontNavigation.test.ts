import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  navigateStorefront,
  productRoute,
  productUrl,
  storefrontRoute,
} from './storefrontNavigation';

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});
describe('public product navigation', () => {
  it('keeps immutable identity and encodes variant values', () => {
    expect(productUrl('stable-id', 'color blue')).toBe('/products/stable-id?variant=color%20blue');
    expect(productRoute('/products/stable-id?variant=color%20blue&ref=partner')).toEqual({
      id: 'stable-id',
      variantId: 'color blue',
    });
    expect(productRoute('/products/%E0%A4')).toEqual({ id: '' });
    expect(productRoute('/products/a%2Fb')).toEqual({ id: '' });
    expect(productRoute('#shop')).toBeNull();
  });
  it('resolves product reload, legacy referrals, hash navigation and admin without losing filters', () => {
    expect(
      storefrontRoute({ pathname: '/products/stable-id', search: '?variant=v2', hash: '' })
    ).toBe('/products/stable-id?variant=v2');
    expect(
      storefrontRoute({
        pathname: '/',
        search: '?ref=abc',
        hash: '#collection/decor?product=stable-id&variant=v2',
      })
    ).toBe('/products/stable-id?variant=v2');
    expect(
      storefrontRoute({
        pathname: '/products/stable-id',
        search: '',
        hash: '#collection/furniture?cat=Chairs',
      })
    ).toBe('#collection/furniture?cat=Chairs');
    expect(
      storefrontRoute({ pathname: '/products/stable-id', search: '', hash: '#main-content' })
    ).toBe('/products/stable-id');
    expect(storefrontRoute({ pathname: '/admin', search: '', hash: '#shop' })).toBe('admin');
  });
  it('leaves the product path for collections, preserves return state and rejects external URLs', () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    window.history.replaceState({ lmSearch: 'chair' }, '', '/products/stable-id');
    const listener = vi.fn();
    window.addEventListener('popstate', listener);
    navigateStorefront('#collection/decor?cat=Lighting', { state: { fixture: true } });
    expect(window.location.pathname + window.location.hash).toBe('/#collection/decor?cat=Lighting');
    expect(window.history.state).toEqual({ fixture: true });
    expect(listener).toHaveBeenCalledTimes(1);
    navigateStorefront('https://outside.example/product');
    expect(listener).toHaveBeenCalledTimes(1);
    navigateStorefront(productUrl('stable-id', 'v2'), { replace: true, scroll: false });
    expect(window.location.pathname + window.location.search).toBe(
      '/products/stable-id?variant=v2'
    );
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    window.removeEventListener('popstate', listener);
  });
});
