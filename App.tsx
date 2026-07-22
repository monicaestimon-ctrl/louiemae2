
import React, { useState, useEffect } from 'react';
import { Menu, Search, X, Instagram, Facebook, Twitter, ChevronDown } from 'lucide-react';
import { AiConcierge } from './components/AiConcierge';
import { NavLink } from './types';
import { HomePage } from './components/HomePage';
import { StoryPage } from './components/StoryPage';
import { BlogPage } from './components/BlogPage';
import { BlogPostView } from './components/BlogPostView';
import { AdminPage } from './components/AdminPage';
import { DynamicPage } from './components/DynamicPage';
import { StorePage } from './components/StorePage';
import { SupportPage } from './components/SupportPage';
import { NewArrivalsPage } from './components/NewArrivalsPage';
import { NewCollectionPage } from './components/NewCollectionPage';
import { ShopLandingPage } from './components/ShopLandingPage';
import { NewsletterPopup } from './components/NewsletterPopup';
import { SiteProvider, useSite } from './contexts/BlogContext';
import { NewsletterProvider } from './contexts/NewsletterContext';
import { CartProvider } from './contexts/CartContext';
import { CartIcon, CartDrawer } from './components/cart';
import { CheckoutSuccess, CheckoutCancel } from './components/checkout';
import { SearchModal } from './components/SearchModal';


interface MobileNavLinkProps {
  link: NavLink;
  handleNavigation: (href: string) => void;
  depth?: number;
}

// Recursively render mobile navigation links - Fully expanded when opened
const MobileNavLink: React.FC<MobileNavLinkProps> = ({ link, handleNavigation, depth = 0 }) => {
  const [isOpen, setIsOpen] = useState(false);
  const hasChildren = link.children && link.children.length > 0;

  // Recursive function to render all nested children at once (fully expanded)
  const renderAllChildren = (children: NavLink[], currentDepth: number) => {
    return children.map((child) => (
      <div key={child.label} className="w-full">
        <button
          onClick={() => handleNavigation(child.href)}
          className={`w-full text-left font-serif transition-all duration-300 hover:text-bronze py-2 ${currentDepth === 1
            ? 'text-lg pl-4 font-medium text-cream'
            : currentDepth === 2
              ? 'text-base pl-6 text-cream/80'
              : 'text-sm pl-8 text-cream/70'
            }`}
        >
          {child.label}
        </button>
        {/* Render nested children immediately if they exist */}
        {child.children && child.children.length > 0 && (
          <div className="border-l border-bronze/15 ml-4">
            {renderAllChildren(child.children, currentDepth + 1)}
          </div>
        )}
      </div>
    ));
  };

  return (
    <div className="w-full">
      <div className={`flex items-center justify-between group w-full ${depth > 0 ? 'pl-4' : ''}`}>
        <button
          onClick={() => {
            if (hasChildren) {
              setIsOpen(!isOpen);
            } else {
              handleNavigation(link.href);
            }
          }}
          className={`flex-1 text-left font-serif text-cream transition-all duration-300 hover:text-bronze group-hover:text-bronze ${depth === 0 ? 'text-4xl md:text-5xl drop-shadow-md' : 'text-xl md:text-2xl mt-4'}`}
        >
          {link.label}
        </button>
        {hasChildren && (
          <button onClick={() => setIsOpen(!isOpen)} className="p-2 text-cream/50 hover:text-cream transition-colors">
            <ChevronDown className={`w-5 h-5 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {/* Show ALL nested children when expanded - no separate collapsing */}
      {hasChildren && (
        <div className={`overflow-hidden transition-all duration-500 ease-in-out ${isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}>
          <div className="flex flex-col mt-2 border-l border-bronze/20 ml-2">
            {/* Clickable Parent Link inside submenu if it has separate destination */}
            <button
              onClick={() => handleNavigation(link.href)}
              className="block text-left text-xs uppercase tracking-[0.25em] text-bronze/80 hover:text-white transition-colors py-2 pl-4 italic"
            >
              View All {link.label}
            </button>
            {/* Render all children and grandchildren at once */}
            {renderAllChildren(link.children!, 1)}
          </div>
        </div>
      )}
    </div>
  );
};

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
const AppContent = () => {
  const { siteContent } = useSite();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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

  else if (activePage === 'checkout-success') currentView = <CheckoutSuccess />;
  else if (activePage === 'checkout-cancel') currentView = <CheckoutCancel />;
  else if (activePage.startsWith('#support')) {
    // Don't set currentView — SupportPage is rendered directly below
  }
  else if (activePage.startsWith('#pages/')) {
    const slug = activePage.replace('#pages/', '');
    dynamicPageData = siteContent.customPages.find(p => p.slug === slug);
    currentView = dynamicPageData ? <DynamicPage page={dynamicPageData} /> : <HomePage />;
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
          {/* Mobile Menu Overlay - Hyper Glassmorphic */}
          <div
            className={`fixed inset-0 z-50 flex flex-col backdrop-blur-3xl bg-gradient-to-br from-[#3a2a1a]/95 via-[#2d1f12]/95 to-[#1a130a]/95 transition-all duration-[800ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${mobileMenuOpen ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-[20px] pointer-events-none'
              }`}
          >
            {/* Inner Sheen overlay */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-transparent pointer-events-none" />
            {/* Mobile Header */}
            <div className="flex justify-between items-center px-6 py-6 md:px-12 relative z-10 border-b border-white/10">
              <div className="flex flex-col drop-shadow-lg">
                <span className="font-serif text-3xl text-cream italic tracking-tight">Louie Mae</span>
                <span className="text-[0.55rem] uppercase tracking-[0.3em] text-bronze">Navigation</span>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="group relative w-10 h-10 flex items-center justify-center rounded-full border border-white/20 bg-white/5 backdrop-blur-sm hover:bg-white/10 hover:border-white/40 transition-all duration-300 shadow-lg"
              >
                <X className="w-5 h-5 text-cream group-hover:rotate-90 transition-transform duration-500" />
              </button>
            </div>

            {/* Mobile Links */}
            <div className="flex-1 flex flex-col px-8 md:px-16 overflow-y-auto no-scrollbar relative z-10">
              <div className="space-y-6 md:space-y-8 flex flex-col items-start max-w-lg mx-auto w-full py-10">
                {extendedNavLinks.map((link) => (
                  <MobileNavLink key={link.label} link={link} handleNavigation={handleNavigation} />
                ))}
              </div>
            </div>

            {/* Mobile Footer */}
            <div className="px-8 py-8 md:px-12 border-t border-white/10 relative z-10 bg-black/20">
              <div className="flex justify-between items-end">
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-cream/40">Connect</p>
                  <div className="flex gap-6">
                    <Instagram className="w-5 h-5 text-cream/60 hover:text-white transition-colors" />
                    <Facebook className="w-5 h-5 text-cream/60 hover:text-white transition-colors" />
                    <Twitter className="w-5 h-5 text-cream/60 hover:text-white transition-colors" />
                  </div>
                </div>
                <div className="flex flex-col items-end gap-3">
                  <button onClick={() => handleNavigation('#admin')} className="text-[10px] uppercase tracking-[0.2em] text-cream/40 hover:text-bronze transition-colors flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                    Atelier
                  </button>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-cream/30">Est. 2021</p>
                </div>
              </div>
            </div>
          </div>

          {/* Desktop Header */}
          <header
            className={`fixed top-0 left-0 right-0 z-40 transition-all duration-700 border-b ${scrolled ? 'bg-white/30 backdrop-blur-3xl py-3 border-white/40 shadow-[0_15px_30px_rgba(139,90,43,0.1)]' : 'bg-transparent py-6 border-transparent'
              }`}
          >
            <div className="w-full px-6 md:px-12 relative flex justify-between items-center min-h-[50px]">
              {/* Mobile Menu Icon */}
              <button
                className="lg:hidden text-earth z-50 p-2 -ml-2 hover:opacity-70 transition-opacity"
                onClick={() => setMobileMenuOpen(true)}
              >
                <Menu className="w-6 h-6" />
              </button>

              {/* Desktop Navigation & Logo */}
              <div className="hidden lg:flex absolute inset-0 justify-center items-center pointer-events-none">
                <div className="flex items-center gap-10 xl:gap-14 pointer-events-auto bg-transparent">
                  <nav className="flex gap-6 xl:gap-9">
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

                  <div className="text-center px-6 cursor-pointer" onClick={() => handleNavigation('#')}>
                    <p className={`text-[0.55rem] uppercase tracking-[0.3em] text-bronze mb-1 transition-all duration-500 ${scrolled ? 'opacity-0 h-0 overflow-hidden' : 'opacity-100'}`}>
                      Est. 2021
                    </p>
                    <h1 className={`font-serif text-earth tracking-tight whitespace-nowrap transition-all duration-500 ${scrolled ? 'text-2xl' : 'text-3xl xl:text-4xl'}`}>
                      Louie Mae
                    </h1>
                  </div>

                  <nav className="flex gap-6 xl:gap-9">
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
                </div>
              </div>

              {/* Mobile Logo */}
              <div
                className="lg:hidden absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center z-40 pointer-events-auto cursor-pointer"
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
              <div className="flex items-center gap-4 md:gap-6 ml-auto z-50 pl-4">
                <button
                  onClick={() => setSearchOpen(true)}
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

      {/* Search Modal */}
      <SearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onProductClick={(productId) => {
          setSelectedProductId(productId);
          setSearchOpen(false);
        }}
      />

      {/* Main Content Area */}
      {activePage.startsWith('#support') ? (
        <SupportPage section={activePage.match(/#support\/(.+)/)?.[1]} />
      ) : (
        <>{currentView}</>
      )}

      {/* Hyper-Glassmorphic Footer */}
      {activePage !== 'admin' && (
        <footer className="relative bg-gradient-to-b from-[#2a1a0f] to-[#1a130a] text-cream border-t border-bronze/20 overflow-hidden">
          {/* Decorative Glossy Glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-32 bg-bronze/10 filter blur-[80px] rounded-full pointer-events-none" />
          
          <div className="container mx-auto pt-24 pb-12 px-6 relative z-10">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
              <div>
                <h4 className="font-serif text-3xl mb-6 text-white drop-shadow-md">Louie Mae</h4>
                <p className="text-sm text-cream/70 font-sans leading-relaxed">
                  Curating a life you love through timeless design and authentic living.
                </p>
              </div>
              <div>
                <h4 className="font-serif text-xl mb-6 text-white/90">Shop</h4>
                <ul className="space-y-4 text-sm text-cream/70">
                  <li><button onClick={() => handleNavigation('#new-arrivals')} className="hover:text-white transition-colors cursor-pointer w-full text-left">New Arrivals</button></li>
                  <li><button onClick={() => handleNavigation('#collection/fashion')} className="hover:text-white transition-colors cursor-pointer w-full text-left">Women's</button></li>
                  <li><button onClick={() => handleNavigation('#collection/furniture')} className="hover:text-white transition-colors cursor-pointer w-full text-left">Furniture</button></li>
                  <li><button onClick={() => handleNavigation('#collection/decor')} className="hover:text-white transition-colors cursor-pointer w-full text-left">Decor</button></li>
                  <li><button onClick={() => handleNavigation('#collection/kids')} className="hover:text-white transition-colors cursor-pointer w-full text-left">Kids</button></li>
                </ul>
              </div>
              <div>
                <h4 className="font-serif text-xl mb-6 text-white/90">Support</h4>
                <ul className="space-y-4 text-sm text-cream/70">
                  <li><button onClick={() => handleNavigation('#support/shipping')} className="hover:text-white transition-colors cursor-pointer w-full text-left">Shipping & Returns</button></li>
                  <li><button onClick={() => handleNavigation('#support/faq')} className="hover:text-white transition-colors cursor-pointer w-full text-left">FAQ</button></li>
                  <li><button onClick={() => handleNavigation('#support/contact')} className="hover:text-white transition-colors cursor-pointer w-full text-left">Contact Us</button></li>
                  <li><button onClick={() => handleNavigation('#support/privacy')} className="hover:text-white transition-colors cursor-pointer w-full text-left">Privacy Policy</button></li>
                </ul>
              </div>
              <div>
                <h4 className="font-serif text-xl mb-6 text-white/90">Follow Us</h4>
                <div className="flex gap-5">
                  <a href="#" aria-label="Instagram" className="p-3 bg-white/5 rounded-full border border-white/10 hover:bg-white/15 hover:border-bronze/40 transition-all">
                    <Instagram className="w-5 h-5 text-cream" />
                  </a>
                  <a href="#" aria-label="Facebook" className="p-3 bg-white/5 rounded-full border border-white/10 hover:bg-white/15 hover:border-bronze/40 transition-all">
                    <Facebook className="w-5 h-5 text-cream" />
                  </a>
                  <a href="#" aria-label="Twitter" className="p-3 bg-white/5 rounded-full border border-white/10 hover:bg-white/15 hover:border-bronze/40 transition-all">
                    <Twitter className="w-5 h-5 text-cream" />
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
