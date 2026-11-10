
import React, { useState, useEffect, useCallback, lazy, Suspense, useSyncExternalStore } from 'react';
import { Menu, Search, Instagram, ChevronDown } from 'lucide-react';
import { AiConcierge } from './components/AiConcierge';
import { SiteMenu } from './components/SiteMenu';
import { NavLink } from './types';
import { HomePage } from './components/HomePage';
import { DynamicPage } from './components/DynamicPage';
import { NewsletterPopup } from './components/NewsletterPopup';
import { SiteProvider, useSite } from './contexts/BlogContext';
import { NewsletterProvider } from './contexts/NewsletterContext';
import { CartProvider } from './contexts/CartContext';
import { CartIcon, CartDrawer } from './components/cart';
import { useConvex, useMutation } from 'convex/react';
import { api } from './convex/_generated/api';
import { captureRefFromUrl, visitorId } from './lib/partnerLink';
import { safeRedirect } from './lib/enrollment';
import {DeliveryQuoteAccess} from './components/delivery/DeliveryQuoteStatus';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ContentStatusPage } from './components/ContentStatusPage';
import { SearchLoadState } from './components/SearchLoadState';
import { loadModule } from './lib/moduleRecovery';

// Everything past the home page loads on demand so the first visit only downloads
// what it shows. Each page keeps its named export; lazy() needs a default.
const named = <T extends Record<string, unknown>, K extends keyof T>(load: () => Promise<T>, key: K) =>
  lazy(() => loadModule(load).then((m) => ({ default: m[key] as React.ComponentType<any> })));
const StoryPage = named(() => import('./components/StoryPage'), 'StoryPage');
const BlogPage = named(() => import('./components/BlogPage'), 'BlogPage');
const BlogPostView = named(() => import('./components/BlogPostView'), 'BlogPostView');
const AdminPage = named(() => import('./components/AdminPage'), 'AdminPage');
const StorePage = named(() => import('./components/StorePage'), 'StorePage');
const SupportPage = named(() => import('./components/SupportPage'), 'SupportPage');
const CreatorHub = lazy(() => loadModule(() => import('./components/CreatorHub')));
const NewArrivalsPage = named(() => import('./components/NewArrivalsPage'), 'NewArrivalsPage');
const NewCollectionPage = named(() => import('./components/NewCollectionPage'), 'NewCollectionPage');
const ShopLandingPage = named(() => import('./components/ShopLandingPage'), 'ShopLandingPage');
const CheckoutSuccess = named(() => import('./components/checkout'), 'CheckoutSuccess');
const CheckoutCancel = named(() => import('./components/checkout'), 'CheckoutCancel');
const SearchModal = named(() => import('./components/SearchModal'), 'SearchModal');

const PageFallback = () => <main className="min-h-[100svh] flex items-center justify-center text-earth" aria-busy="true"><p role="status">Loading page…</p></main>;

// The full desktop navigation only shows at 1600px and wider; narrower screens never build it.
const WIDE_NAV = '(min-width: 1600px)';
const subscribeWideNav = (onChange: () => void) => {
  const mql = window.matchMedia(WIDE_NAV);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
};
const isWideNav = () => window.matchMedia(WIDE_NAV).matches;


/** Reusable glassmorphic dropdown for desktop nav links */
const NavDropdown: React.FC<{ links: NavLink[]; handleNavigation: (href: string) => void }> = ({ links, handleNavigation }) => (
  <div className="absolute top-full left-1/2 -translate-x-1/2 pt-4 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 transform translate-y-2 group-hover:translate-y-0">
    <div className="bg-gradient-to-br from-[#3a2a1a]/95 via-[#2d1f12]/95 to-[#1a130a]/95 backdrop-blur-3xl border border-white/20 py-5 px-5 shadow-[0_30px_60px_rgba(139,90,43,0.3),inset_0_1px_0_rgba(255,255,255,0.15)] rounded-2xl min-w-[240px] max-h-[75vh] overflow-y-auto relative overflow-hidden text-cream">
      {/* Inner Glass Highlight */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-bronze/5 pointer-events-none" />
      <div className="flex flex-col gap-1 relative z-10">
        {links.map(child => (
          <div key={child.label} className="w-full">
            <button
              onClick={(e) => { e.stopPropagation(); handleNavigation(child.href); }}
              className="w-full text-left text-[0.7rem] uppercase tracking-[0.15em] font-medium py-2 px-3 hover:text-white transition-colors rounded-xl hover:bg-white/10 text-cream/90"
            >
              {child.label}
            </button>
            {child.children && (
              <div className="ml-4 mb-3 border-l border-white/10 pl-3">
                {child.children.map(subChild => (
                  <div key={subChild.label}>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleNavigation(subChild.href); }}
                      className="w-full text-left text-[0.6rem] uppercase tracking-[0.12em] text-cream/70 py-1.5 px-2 hover:text-white transition-colors rounded-md hover:bg-white/5 mt-1"
                    >
                      {subChild.label}
                    </button>
                    {subChild.children && (
                      <div className="ml-3 border-l border-white/5 pl-2">
                        {subChild.children.map(deepChild => (
                          <button
                            key={deepChild.label}
                            onClick={(e) => { e.stopPropagation(); handleNavigation(deepChild.href); }}
                            className="w-full text-left text-[0.55rem] uppercase tracking-[0.1em] text-cream/50 py-1.5 px-2 hover:text-white transition-colors rounded-md hover:bg-white/5"
                          >
                            {deepChild.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  </div>
);

// We need a wrapper component to use the context inside App
/** Keep shared navigation and cart state outside recoverable route content. */
const AppContent = () => {
  const { siteContent, customPagesStatus, siteContentStatus } = useSite();
  // A visit through a partner link (?ref=CODE&ch=channel) on any storefront page: saved for
  // 30 days and shared with /trade, then taken out of the address bar.
  const recordPartnerClick = useMutation(api.holmPartners.recordClick);
  const recordReferralClick = useMutation(api.prgAttribution.recordClick);
  const convex = useConvex();
  // A retail referral link (/r/<linkId>, v2): record the click server-side, then open its destination.
  useEffect(() => {
    const m = window.location.pathname.match(/^\/r\/([a-z0-9]{8,24})$/);
    if (!m) return;
    const linkId = m[1];
    let referrerHost: string | undefined;
    try {
      referrerHost = document.referrer ? new URL(document.referrer).hostname : undefined;
    } catch {
      referrerHost = undefined;
    }
    const consent = (() => {
      try {
        const c = localStorage.getItem('lm:consent');
        return c === 'granted' || c === 'denied' ? c : 'unknown';
      } catch {
        return 'unknown';
      }
    })() as 'granted' | 'denied' | 'unknown';
    void (async () => {
      try {
        await recordReferralClick({ linkId, visitorKey: visitorId(), userAgent: navigator.userAgent, ...(referrerHost ? { referrerHost } : {}), consent });
      } catch {
        /* the visit still lands on the page */
      }
      const dest = await convex.query(api.prgLinks.resolve, { linkId }).catch(() => ({ kind: 'home' as const }));
      const target =
        dest.kind === 'product'
          ? `/#collection/${dest.collection}?product=${encodeURIComponent(dest.productId)}${dest.variantId ? `&variant=${encodeURIComponent(dest.variantId)}` : ''}`
          : dest.kind === 'page'
            ? safeRedirect(dest.path)
            : '/';
      window.location.replace(target);
    })();
  }, [recordReferralClick, convex]);
  useEffect(() => {
    // Not on the admin pages: the team's own visits shouldn't count as partner traffic.
    const admin = window.location.pathname.replace(/\/+$/, '') === '/admin' || /^#admin/.test(window.location.hash);
    if (!admin) void captureRefFromUrl(recordPartnerClick, `site:${window.location.pathname}${window.location.hash}`);
    // Back from Google sign-in on the Creator Hub, which returns to the home page.
    try {
      const after = sessionStorage.getItem('lm:after');
      if (after) {
        sessionStorage.removeItem('lm:after');
        if (!window.location.hash && /^#[\w/-]+$/.test(after)) window.location.hash = after;
      }
    } catch {
      /* storage blocked: stay on the home page */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per page load
  }, []);
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // The menu's contents are built the first time it opens, then kept for the fade.
  const [mobileMenuBuilt, setMobileMenuBuilt] = useState(false);
  const wideNav = useSyncExternalStore(subscribeWideNav, isWideNav);
  const [activePage, setActivePage] = useState<string>('home');
  const [searchOpen, setSearchOpen] = useState(false);
  const [, setSelectedProductId] = useState<string | null>(null); // TODO: Wire to product detail navigation

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);

    // Lock body scroll when menu is open
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    // Hash handler
    const handleHash = () => {
      // Let /admin work as a real entry path so it survives domain redirects.
      const isAdminPath = window.location.pathname.replace(/\/+$/, '') === '/admin';
      const fullHash = isAdminPath ? '#admin' : window.location.hash;
      // Split query params to determine main route
      const [baseHash] = fullHash.split('?');

      if (baseHash === '#admin') setActivePage('admin');
      else if (baseHash === '#blog') setActivePage('blog');
      else if (baseHash.startsWith('#blog/')) setActivePage(baseHash);
      else if (baseHash === '#story') setActivePage('story');
      else if (baseHash === '#shop') setActivePage('shop');
      else if (baseHash === '#new-arrivals') setActivePage('new-arrivals');
      else if (baseHash === '#creators') setActivePage('creators');
      else if (baseHash.startsWith('#support')) setActivePage(fullHash);

      else if (baseHash === '#checkout/success') setActivePage('checkout-success');
      else if (baseHash === '#checkout/cancel') setActivePage('checkout-cancel');
      else if (baseHash.startsWith('#pages/')) setActivePage(baseHash);
      else if (baseHash === '#collection/new') setActivePage('new-collection');
      else if (baseHash.startsWith('#collection/')) setActivePage(fullHash); // Pass full hash to parse query later
      else setActivePage('home');
    };

    handleHash(); // Initial check
    window.addEventListener('hashchange', handleHash);

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('hashchange', handleHash);
      document.body.style.overflow = 'unset';
    };
  }, [mobileMenuOpen]);

  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);

  const handleNavigation = (href: string) => {
    setMobileMenuOpen(false);
    window.location.hash = href;

    // Fallback if hashchange doesn't fire immediately
    const [baseHash] = href.split('?');
    if (baseHash === '#story') setActivePage('story');
    else if (baseHash === '#blog') setActivePage('blog');
    else if (baseHash.startsWith('#blog/')) setActivePage(baseHash);
    else if (baseHash === '#admin') setActivePage('admin');
    else if (baseHash === '#shop') setActivePage('shop');
    else if (baseHash === '#new-arrivals') setActivePage('new-arrivals');
    else if (baseHash === '#creators') setActivePage('creators');
    else if (baseHash.startsWith('#support')) setActivePage(href);
    else if (baseHash.startsWith('#pages/')) setActivePage(baseHash);
    else if (baseHash === '#collection/new') setActivePage('new-collection');
    else if (baseHash.startsWith('#collection/')) setActivePage(href);
    else setActivePage('home');

    // For support sections, don't scroll to top — let SupportPage handle scrolling to the section
    if (!baseHash.startsWith('#support')) {
      // Instant scroll to top — smooth scroll gets canceled by re-renders on mobile
      window.scrollTo(0, 0);
      // Fallback after React re-render completes
      requestAnimationFrame(() => window.scrollTo(0, 0));
    }
  };

  // Dynamic meta tags per page
  useEffect(() => {
    const BASE_URL = 'https://louiemae.com';
    const setMeta = (selector: string, content: string) => {
      const el = document.querySelector(selector);
      if (el) el.setAttribute('content', content);
    };

    let title = 'Louie Mae | Curated Home, Kids & Lifestyle';
    let description = 'Elevated home décor, modern organic furniture, and thoughtfully designed children\'s clothing — curated with warmth, intention, and lived-in luxury.';
    let image = `${BASE_URL}/lm3.jpg`;
    let url = BASE_URL;

    if (activePage === 'story') {
      title = 'Our Story | Louie Mae';
      description = 'Discover the heart behind Louie Mae — a journey of faith, craftsmanship, and calling. From artisan jewelry to curated lifestyle, every piece tells a story.';
      image = `${BASE_URL}/images/brand/fam2.png`;
      url = `${BASE_URL}/story`;
    } else if (activePage === 'blog') {
      title = 'Simply by Mae | Louie Mae';
      description = 'Stories, inspiration, and behind-the-scenes moments from the Louie Mae journey.';
      image = `${BASE_URL}/images/brand/blog-main-v2.png`;
      url = `${BASE_URL}/blog`;
    } else if (activePage === 'creators') {
      title = 'Earn as a creator | Louie Mae';
      description = 'Share Louie Mae on your socials, blog or links and earn commission on orders placed through your links.';
      url = `${BASE_URL}/#creators`;
    } else if (activePage === 'shop') {
      title = 'Shop | Louie Mae';
      description = 'Browse our curated collections of elevated home décor, modern furniture, children\'s clothing, and lifestyle essentials.';
      image = `${BASE_URL}/images/brand/DINNERTABLE.png`;
      url = `${BASE_URL}/shop`;
    } else if (activePage.startsWith('#collection/')) {
      const [path] = activePage.split('?');
      const type = path.replace('#collection/', '');
      const collection = siteContent.collections.find(c => c.id === type);
      if (collection) {
        title = `${collection.title} | Louie Mae`;
        description = `Shop ${collection.title} — ${collection.subtitle}`;
        url = `${BASE_URL}/collection/${type}`;
      }
    }

    document.title = title;
    setMeta('meta[property="og:title"]', title);
    setMeta('meta[property="og:description"]', description);
    setMeta('meta[property="og:image"]', image);
    setMeta('meta[property="og:url"]', url);
    setMeta('meta[name="twitter:title"]', title);
    setMeta('meta[name="twitter:description"]', description);
    setMeta('meta[name="twitter:image"]', image);
    setMeta('meta[name="description"]', description);
    setMeta('link[rel="canonical"]', url);
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute('href', url);
  }, [activePage, siteContent.collections]);

  // Merge dynamic custom pages into links if needed, or allow them to be manually added in admin
  const extendedNavLinks = siteContent.navLinks;

  // Determine what to render
  let currentView: React.ReactNode = <HomePage />;
  let dynamicPageData = null;

  if (activePage === 'admin') currentView = <AdminPage />;
  else if (activePage === 'blog') currentView = <BlogPage />;
  else if (activePage.startsWith('#blog/')) {
    const postId = activePage.replace('#blog/', '');
    currentView = <BlogPostView postId={postId} />;
  }
  else if (activePage === 'story') currentView = <StoryPage />;
  else if (activePage === 'shop') currentView = <ShopLandingPage />;
  else if (activePage === 'new-arrivals') currentView = <NewArrivalsPage />;
  else if (activePage === 'new-collection') currentView = <NewCollectionPage />;
  else if (activePage === 'creators') currentView = <CreatorHub />;

  else if (activePage === 'checkout-success') currentView = <CheckoutSuccess />;
  else if (activePage === 'checkout-cancel') currentView = <CheckoutCancel />;
  else if (activePage.startsWith('#support')) {
    // Don't set currentView — SupportPage is rendered directly below
  }
  else if (activePage.startsWith('#pages/')) {
    const slug = activePage.replace('#pages/', '');
    dynamicPageData = siteContent.customPages.find(p => p.slug === slug);
    currentView = dynamicPageData ? <DynamicPage page={dynamicPageData} /> : <ContentStatusPage status={customPagesStatus} />;
  }
  else if (activePage.startsWith('#collection/')) {
    const [path, query] = activePage.split('?');
    const type = path.replace('#collection/', '');
    const params = new URLSearchParams(query);
    const category = params.get('cat');
    const viewProducts = params.get('view') === 'products';

    // Check if the type exists in our dynamic collections
    const collectionExists = siteContent.collections.some(c => c.id === type);

    if (collectionExists) {
      currentView = <StorePage collection={type as string} initialCategory={category || 'All'} forceProductView={viewProducts} />;
    } else {
      currentView = <HomePage />;
    }
  }

  return (
    <div className="min-h-screen bg-cream font-sans selection:bg-bronze selection:text-white overflow-x-hidden">

      {/* Only show Header/Footer if NOT in admin mode */}
      {activePage !== 'admin' && (
        <>
          {/* Side menu (all widths below the full desktop nav). Built on first open, then kept. */}
          {mobileMenuBuilt && (
            <SiteMenu
              open={mobileMenuOpen}
              links={extendedNavLinks}
              onClose={closeMobileMenu}
              onNavigate={handleNavigation}
            />
          )}

          {/* Desktop Header */}
          <header
            className={`fixed top-0 left-0 right-0 z-40 transition-all duration-700 border-b ${scrolled ? 'bg-cream/85 lg:bg-white/30 backdrop-blur-3xl py-3 border-white/40 shadow-[0_15px_30px_rgba(139,90,43,0.1)]' : 'bg-transparent py-6 border-transparent'
              }`}
          >
            <div className="w-full px-6 md:px-12 relative flex justify-between items-center min-h-[50px]">
              {/* Mobile Menu Icon */}
              <button
                className="min-[1600px]:hidden text-earth z-50 p-2 -ml-2 hover:opacity-70 transition-opacity"
                aria-label="Open menu"
                aria-expanded={mobileMenuOpen}
                onClick={() => { setMobileMenuBuilt(true); setMobileMenuOpen(true); }}
              >
                <Menu className="w-6 h-6" />
              </button>

              {/* Desktop Navigation & Logo */}
              <div className="hidden min-[1600px]:flex flex-1 min-w-0 justify-center items-center">
                {wideNav && <div className="flex items-center gap-6 pointer-events-auto bg-transparent">
                  <nav className="flex gap-5">
                    {extendedNavLinks.slice(0, 3).map(link => (
                      <div key={link.label} className="relative group">
                        <button
                          onClick={() => handleNavigation(link.href)}
                          className="text-[0.65rem] uppercase tracking-[0.15em] text-earth/80 hover:text-bronze transition-colors font-medium whitespace-nowrap py-2 flex items-center gap-1"
                        >
                          {link.label}
                          {link.children && <ChevronDown className="w-2.5 h-2.5 opacity-40 group-hover:opacity-100 transition-opacity" />}
                        </button>

                        {/* Level 1 Dropdown - Hyper Glassmorphic */}
                        {link.children && <NavDropdown links={link.children} handleNavigation={handleNavigation} />}
                      </div>
                    ))}
                  </nav>

                  <div className="text-center px-4 cursor-pointer" onClick={() => handleNavigation('#')}>
                    <p className={`text-[0.55rem] uppercase tracking-[0.3em] text-bronze mb-1 transition-all duration-500 ${scrolled ? 'opacity-0 h-0 overflow-hidden' : 'opacity-100'}`}>
                      Est. 2021
                    </p>
                    <h1 className={`font-serif text-earth tracking-tight whitespace-nowrap transition-all duration-500 ${scrolled ? 'text-2xl' : 'text-3xl xl:text-4xl'}`}>
                      Louie Mae
                    </h1>
                  </div>

                  <nav className="flex gap-5">
                    {extendedNavLinks.slice(3).map(link => (
                      <div key={link.label} className="relative group">
                        <button
                          onClick={() => handleNavigation(link.href)}
                          className="text-[0.65rem] uppercase tracking-[0.15em] text-earth/80 hover:text-bronze transition-colors font-medium whitespace-nowrap py-2 flex items-center gap-1"
                        >
                          {link.label}
                          {link.children && <ChevronDown className="w-2.5 h-2.5 opacity-40 group-hover:opacity-100 transition-opacity" />}
                        </button>

                        {/* Level 1 Dropdown - Hyper Glassmorphic */}
                        {link.children && <NavDropdown links={link.children} handleNavigation={handleNavigation} />}
                      </div>
                    ))}
                  </nav>
                </div>}
              </div>

              {/* Mobile Logo */}
              <div
                className="min-[1600px]:hidden absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center z-40 pointer-events-auto cursor-pointer"
                onClick={() => handleNavigation('#')}
              >
                <p className={`text-[0.45rem] uppercase tracking-[0.25em] text-bronze mb-0.5 transition-all ${scrolled ? 'hidden' : 'block'}`}>
                  Est. 2021
                </p>
                <h1 className="font-serif text-2xl text-earth tracking-tight whitespace-nowrap">
                  Louie Mae
                </h1>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-4 md:gap-6 ml-auto shrink-0 z-50 pl-6">
                {/* Retail is this storefront; Trade opens House of Louie Mae */}
                <div className="hidden md:flex items-center gap-2 text-[0.6rem] uppercase tracking-[0.15em] font-medium" aria-label="Shop as">
                  <span className="text-earth" aria-current="page">Retail</span>
                  <span className="text-earth/30">·</span>
                  <a href="/trade/" className="text-earth/60 hover:text-bronze transition-colors">Trade</a>
                </div>
                <button
                  onClick={() => setSearchOpen(true)}
                  aria-label="Search"
                  className="text-earth hover:text-bronze transition-colors p-1"
                >
                  <Search className="w-4 h-4 md:w-5 md:h-5" />
                </button>
                <CartIcon />
              </div>
            </div>
          </header>
        </>
      )}

      {/* Cart Drawer */}
      <CartDrawer />
      <DeliveryQuoteAccess />

      {/* Search Modal */}
      {searchOpen && <ErrorBoundary fallback={<SearchLoadState failed onClose={() => setSearchOpen(false)} />}><Suspense fallback={<SearchLoadState onClose={() => setSearchOpen(false)} />}><SearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onProductClick={(productId) => {
          setSelectedProductId(productId);
          setSearchOpen(false);
        }}
      /></Suspense></ErrorBoundary>}

      {/* Main Content Area */}
      <ErrorBoundary key={activePage} retryLocally>
      <Suspense fallback={<PageFallback />}>
        {activePage.startsWith('#support') ? (
          <SupportPage section={activePage.match(/#support\/(.+)/)?.[1]} />
        ) : (
          <>{currentView}</>
        )}
      </Suspense>
      </ErrorBoundary>

      {/* Hyper-Glassmorphic Footer */}
      {activePage !== 'admin' && (
        <footer className="below-fold relative bg-gradient-to-b from-[#2a1a0f] to-[#1a130a] text-cream border-t border-bronze/20 overflow-hidden">
          <div className="min-h-12 px-6 py-3 text-sm text-cream" role="status">
            {siteContentStatus === 'unavailable' ? 'Some site information is temporarily unavailable. Navigation uses our default collections.' : ''}
          </div>
          {/* Decorative Glossy Glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-32 bg-bronze/10 filter blur-[80px] rounded-full pointer-events-none" />
          
          <div className="container mx-auto pt-24 pb-12 px-6 relative z-10">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
              <div>
                <p className="font-serif text-3xl mb-6 text-white drop-shadow-md">Louie Mae</p>
                <p className="text-sm text-cream/70 font-sans leading-relaxed">
                  Curating a life you love through timeless design and authentic living.
                </p>
              </div>
              <div>
                <h2 className="font-serif text-xl mb-6 text-white/90">Shop</h2>
                <ul className="space-y-4 text-sm text-cream/70">
                  <li><button onClick={() => handleNavigation('#new-arrivals')} className="hover:text-white transition-colors cursor-pointer w-full text-left">New Arrivals</button></li>
                  <li><button onClick={() => handleNavigation('#collection/fashion')} className="hover:text-white transition-colors cursor-pointer w-full text-left">Women's</button></li>
                  <li><button onClick={() => handleNavigation('#collection/furniture')} className="hover:text-white transition-colors cursor-pointer w-full text-left">Furniture</button></li>
                  <li><button onClick={() => handleNavigation('#collection/decor')} className="hover:text-white transition-colors cursor-pointer w-full text-left">Decor</button></li>
                  <li><button onClick={() => handleNavigation('#collection/kids')} className="hover:text-white transition-colors cursor-pointer w-full text-left">Kids</button></li>
                </ul>
              </div>
              <div>
                <h2 className="font-serif text-xl mb-6 text-white/90">Support</h2>
                <ul className="space-y-4 text-sm text-cream/70">
                  <li><button onClick={() => handleNavigation('#support/shipping')} className="hover:text-white transition-colors cursor-pointer w-full text-left">Shipping & Returns</button></li>
                  <li><button onClick={() => handleNavigation('#support/faq')} className="hover:text-white transition-colors cursor-pointer w-full text-left">FAQ</button></li>
                  <li><button onClick={() => handleNavigation('#support/contact')} className="hover:text-white transition-colors cursor-pointer w-full text-left">Contact Us</button></li>
                  <li><button onClick={() => handleNavigation('#creators')} className="hover:text-white transition-colors cursor-pointer w-full text-left">Earn as a creator</button></li>
                  <li><a href="/privacy" className="hover:text-white transition-colors">Privacy Policy</a></li>
                  <li><a href="/terms" className="hover:text-white transition-colors">Terms of Service</a></li>
                </ul>
              </div>
              <div>
                <h2 className="font-serif text-xl mb-6 text-white/90">Follow Us</h2>
                <div className="flex gap-5">
                  <a href="https://www.instagram.com/itslouiemae/" target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="p-3 bg-white/5 rounded-full border border-white/10 hover:bg-white/15 hover:border-bronze/40 transition-all">
                    <Instagram className="w-5 h-5 text-cream" />
                  </a>
                </div>
              </div>
            </div>
            <div className="border-t border-white/10 pt-8 flex justify-between items-center text-xs text-cream/40 uppercase tracking-[0.2em] font-medium">
              <span>© 2026 Louie Mae Collective.</span>
              <button 
                onClick={() => handleNavigation('#admin')} 
                className="hover:text-bronze transition-colors flex items-center gap-1.5 border border-white/5 px-4 py-2 rounded-full hover:bg-white/5"
              >
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
                Enter Atelier
              </button>
            </div>
          </div>
        </footer>
      )}

      {/* Floating AI Concierge & Newsletter Popup (Hidden on Admin) */}
      {activePage !== 'admin' && (
        <>
          <AiConcierge />
          <NewsletterPopup />
        </>
      )}

    </div>
  );
};

export default function App() {
  return (
    <SiteProvider>
      <NewsletterProvider>
        <CartProvider>
          <AppContent />
        </CartProvider>
      </NewsletterProvider>
    </SiteProvider>
  );
}
