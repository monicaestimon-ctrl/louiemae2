import { LazyProductPreview } from './LazyProductPreview';
import { navigatePlainLink } from '../lib/navigation';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FadeIn } from './FadeIn';
import { GlassButton } from './ui/GlassButton';
import { FASHION_CATEGORIES, KIDS_CATEGORIES, INITIAL_SITE_CONTENT } from '../constants';
import { useSite } from '../contexts/BlogContext';
import { useNewsletter } from '../contexts/NewsletterContext';
import type { CollectionConfig } from '../types';
import { HomeRecommendations } from './HomeRecommendations';
import { ArrowUpRight, Check } from 'lucide-react';
import { DynamicSectionRenderer } from './DynamicPage';
import { responsiveImage } from '../lib/responsiveImage';

const DEFAULT_HERO_IMAGE = INITIAL_SITE_CONTENT.home.hero.image;
const heroShell = () => document.getElementById('lm-shell');
const furnitureFallback: CollectionConfig = { id: 'furniture', title: 'Furniture', subtitle: '', heroImage: '', subcategories: [] };

export const HomePage: React.FC = () => {
  const { siteContent, isLoading } = useSite();
  const [heroLoaded, setHeroLoaded] = useState(false);
  // index.html's hero, when the visit started on the home page. It stays the hero for good:
  // replacing it would make the browser paint the headline twice and count the late one.
  const [fromShell] = useState(() => heroShell() !== null);
  const { home } = siteContent;
  const savedHero = isLoading ? undefined : home.hero.image;
  useEffect(() => {
    const shell = heroShell();
    if (!shell) return;
    shell.hidden = false;
    return () => { shell.hidden = true; };
  }, []);
  useEffect(() => {
    const shell = heroShell();
    const p = shell?.querySelector('p');
    const h2 = shell?.querySelector('h1');
    const line2 = h2?.querySelector('span');
    if (!p || !h2?.firstChild || !line2) return;
    if (p.textContent !== home.hero.pretitle) p.textContent = home.hero.pretitle;
    if (h2.firstChild.nodeValue !== home.hero.titleLine1) h2.firstChild.nodeValue = home.hero.titleLine1;
    if (line2.textContent !== home.hero.titleLine2) line2.textContent = home.hero.titleLine2;
  }, [home.hero.pretitle, home.hero.titleLine1, home.hero.titleLine2]);
  const { addSubscriber } = useNewsletter();
  const furniture = siteContent.collections.find(collection => collection.id === 'furniture') ?? furnitureFallback;
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const openProduct = (id: string | null) => setSelectedProductId(id);



  // Newsletter Form State
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [subStatus, setSubStatus] = useState<'idle' | 'loading' | 'success'>('idle');

  const navigateTo = (hash: string) => {
    window.location.hash = hash;
    window.scrollTo(0, 0);
  };

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setSubStatus('loading');
    const success = await addSubscriber(email, name);
    if (success) {
      setSubStatus('success');
      setEmail('');
      setName('');
    } else {
      setSubStatus('idle');
      alert('Already subscribed!');
    }
  };

  const savedHeroImage = savedHero && savedHero !== DEFAULT_HERO_IMAGE ? (
    <img
      key={savedHero}
      {...responsiveImage(savedHero, '100vw')}
      alt=""
      ref={(el) => { if (el?.complete && el.naturalWidth) setHeroLoaded(true); }}
      onLoad={() => setHeroLoaded(true)}
      className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-[1200ms] ${heroLoaded ? 'opacity-100' : 'opacity-0'}`}
    />
  ) : null;

  return (
    <main aria-label="Louie Mae home">
      {/* Hero Section: index.html's when there is one, otherwise the same hero drawn here.
          The default photo stays underneath and a saved replacement fades in over it once it
          has downloaded. */}
      {fromShell ? createPortal(savedHeroImage, heroShell()!) : (
        <section className="relative h-screen h-svh w-full overflow-hidden bg-[#d4c9b8]">
          <img
            {...responsiveImage(DEFAULT_HERO_IMAGE, '100vw')}
            alt="Interior"
            loading="eager"
            fetchPriority="high"
            className="absolute inset-0 w-full h-full object-cover"
          />
          {savedHeroImage}
          <div className="absolute inset-0 bg-black/20 z-10"></div>
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center text-center px-6">
            <p className="motion-safe:animate-hero-in text-white/90 text-xs md:text-base uppercase tracking-[0.3em] mb-6">{home.hero.pretitle}</p>
            <h1 className="motion-safe:animate-hero-rise font-serif text-[2.75rem] sm:text-5xl md:text-7xl lg:text-8xl text-cream leading-[1.08] mb-10 drop-shadow-lg max-w-5xl text-balance">
              {home.hero.titleLine1}<br />
              <span className="italic">{home.hero.titleLine2}</span>
            </h1>
            <div className="motion-safe:animate-hero-in [animation-delay:300ms]">
              <GlassButton
                onClick={() => navigateTo('#collection/new')}
              >
                New Collection
              </GlassButton>
            </div>
          </div>
        </section>
      )}

      {/* Intro Text */}

      <section className="py-24 px-6 container mx-auto text-center">
        <FadeIn>
          <h2 className="font-serif text-3xl md:text-5xl text-earth leading-tight max-w-5xl mx-auto">
            {home.intro.text}
          </h2>
        </FadeIn>
      </section>

      {/* 1. Main Categories */}
      <section className="below-fold pb-24 px-4 md:px-12 bg-cream">
        <div className="container mx-auto grid grid-cols-1 gap-4 md:gap-6">

          {/* Top Row: Furniture & Decor */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            {/* Furniture */}
            <a
              id="furniture"
              href={'#collection/furniture'} onClick={event => navigatePlainLink(event, '#collection/furniture', navigateTo)}
              className="block relative group cursor-pointer aspect-[4/3] w-full overflow-hidden rounded-2xl shadow-lg hover:shadow-[0_20px_40px_rgba(0,0,0,0.15)] hover:-translate-y-1 transition-all duration-500 border border-white/5"
            >
              <img
                loading="lazy"
                decoding="async"
                {...responsiveImage(home.categoryImages.furniture, '(min-width: 1024px) 50vw, 100vw')}
                alt=""
                className="w-full h-full object-cover transition-transform duration-[1.5s] group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent group-hover:opacity-80 transition-opacity duration-500"></div>
              <div className="absolute bottom-6 left-6 md:bottom-8 md:left-8 transform transition-transform duration-500 group-hover:-translate-y-2">
                <h2 className="font-serif text-2xl md:text-3xl text-white tracking-wide drop-shadow-md">Furniture</h2>
              </div>
            </a>

            {/* Decor */}
            <a
              id="decor"
              href={'#collection/decor'} onClick={event => navigatePlainLink(event, '#collection/decor', navigateTo)}
              className="block relative group cursor-pointer aspect-[4/3] w-full overflow-hidden rounded-2xl shadow-lg hover:shadow-[0_20px_40px_rgba(0,0,0,0.15)] hover:-translate-y-1 transition-all duration-500 border border-white/5"
            >
              <img
                loading="lazy"
                decoding="async"
                {...responsiveImage(home.categoryImages.decor, '(min-width: 1024px) 50vw, 100vw')}
                alt=""
                className="w-full h-full object-cover transition-transform duration-[1.5s] group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent group-hover:opacity-80 transition-opacity duration-500"></div>
              <div className="absolute bottom-6 left-6 md:bottom-8 md:left-8 transform transition-transform duration-500 group-hover:-translate-y-2">
                <h2 className="font-serif text-2xl md:text-3xl text-white tracking-wide drop-shadow-md">Decor</h2>
              </div>
            </a>
          </div>

          {/* Bottom Row: Mae Collective, Kids, Blog */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
            {/* The Mae Collective */}
            <a
              id="fashion"
              href={'#collection/fashion'} onClick={event => navigatePlainLink(event, '#collection/fashion', navigateTo)}
              className="block relative group cursor-pointer aspect-[4/3] md:aspect-auto md:h-[500px] w-full overflow-hidden rounded-2xl shadow-lg hover:shadow-[0_20px_40px_rgba(0,0,0,0.15)] hover:-translate-y-1 transition-all duration-500 border border-white/5"
            >
              <img
                loading="lazy"
                decoding="async"
                {...responsiveImage(home.categoryImages.fashion, '(min-width: 1024px) 50vw, 100vw')}
                alt=""
                className="w-full h-full object-cover object-top transition-transform duration-[1.5s] group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent group-hover:opacity-80 transition-opacity duration-500"></div>
              <div className="absolute bottom-6 left-6 md:bottom-8 md:left-8 transform transition-transform duration-500 group-hover:-translate-y-2">
                <h3 className="font-serif text-2xl md:text-3xl text-white drop-shadow-md">The Mae Collective</h3>
              </div>
            </a>

            {/* Louie Kids & Co. */}
            <a
              id="kids"
              href={'#collection/kids'} onClick={event => navigatePlainLink(event, '#collection/kids', navigateTo)}
              className="block relative group cursor-pointer aspect-[4/3] md:aspect-auto md:h-[500px] w-full overflow-hidden rounded-2xl shadow-lg hover:shadow-[0_20px_40px_rgba(0,0,0,0.15)] hover:-translate-y-1 transition-all duration-500 border border-white/5"
            >
              <img
                loading="lazy"
                decoding="async"
                {...responsiveImage(home.categoryImages.kids, '(min-width: 1024px) 50vw, 100vw')}
                alt=""
                className="w-full h-full object-cover object-top transition-transform duration-[1.5s] group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent group-hover:opacity-80 transition-opacity duration-500"></div>
              <div className="absolute bottom-6 left-6 md:bottom-8 md:left-8 transform transition-transform duration-500 group-hover:-translate-y-2">
                <h3 className="font-serif text-2xl md:text-3xl text-white drop-shadow-md">Louie Kids & Co.</h3>
              </div>
            </a>

            {/* Blog */}
            <a
              id="journal"
              href={'#blog'} onClick={event => navigatePlainLink(event, '#blog', navigateTo)}
              className="block relative group cursor-pointer aspect-[4/3] md:aspect-auto md:h-[500px] w-full overflow-hidden rounded-2xl shadow-lg hover:shadow-[0_20px_40px_rgba(0,0,0,0.15)] hover:-translate-y-1 transition-all duration-500 border border-white/5"
            >
              <img
                loading="lazy"
                decoding="async"
                {...responsiveImage(home.categoryImages.journal, '(min-width: 1024px) 50vw, 100vw')}
                alt=""
                className="w-full h-full object-cover transition-transform duration-[1.5s] group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent group-hover:opacity-80 transition-opacity duration-500"></div>
              <div className="absolute bottom-6 left-6 md:bottom-8 md:left-8 transform transition-transform duration-500 group-hover:-translate-y-2">
                <h3 className="font-serif text-2xl md:text-3xl text-white drop-shadow-md">Blog</h3>
              </div>
            </a>
          </div>

        </div>
      </section>

      {/* 2. Fashion Categories (Detailed) */}
      <section className="below-fold py-20 px-4 md:px-12 bg-white">
        <FadeIn className="text-center mb-12">
          <h2 className="font-serif text-3xl md:text-5xl text-earth leading-tight mb-6">
            Shop The Mae Collective
          </h2>
          <div className="flex justify-center">
            <GlassButton
              onClick={() => navigateTo('#collection/fashion')}
              variant="dark"
            >
              Shop All
            </GlassButton>
          </div>
        </FadeIn>

        <div className="container mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {FASHION_CATEGORIES.map((cat, idx) => (
              <FadeIn key={cat.id} delay={idx * 150} className="group cursor-pointer">
                <a
                  href={`#collection/fashion?cat=${encodeURIComponent(cat.title)}`} onClick={event => navigatePlainLink(event, `#collection/fashion?cat=${encodeURIComponent(cat.title)}`, navigateTo)}
                  className="block relative aspect-[3/4] overflow-hidden rounded-2xl mb-4 shadow-md group-hover:shadow-[0_20px_40px_rgba(0,0,0,0.15)] group-hover:-translate-y-2 transition-all duration-500 border border-white/40"
                >
                  <img
                    loading="lazy"
                    decoding="async"
                    {...responsiveImage(cat.image, '(min-width: 1024px) 50vw, 100vw')}
                    alt={cat.title}
                    className="w-full h-full object-cover transition-transform duration-[1.5s] group-hover:scale-105"
                  />
                  {/* Subtle Inner Glow Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                </a>
                <h3

                  className="font-serif text-lg md:text-xl text-earth group-hover:text-bronze transition-colors px-1"
                >
                  <a href={`#collection/fashion?cat=${encodeURIComponent(cat.title)}`}>{cat.title}</a>
                </h3>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* 3. Recommended Products */}
      <section className="below-fold py-20 px-4 md:px-12 bg-cream-dark/30">
        <div className="container mx-auto">
          <FadeIn className="mb-12 text-center">
            <h2 className="font-serif text-3xl md:text-5xl text-earth leading-tight max-w-5xl mx-auto mb-6">
              Design your Home Interior with pieces we love at Louie Mae
            </h2>
            <div className="w-24 h-px bg-bronze mx-auto mb-6"></div>
            <h3 className="font-serif text-lg md:text-xl text-earth italic">Recommended Products</h3>
          </FadeIn>

          <HomeRecommendations config={furniture} onOpen={id => openProduct(id)} />
        </div>
      </section>

      {/* 4. Kids Categories (Detailed - Updated Asymmetrical Grid) */}
      <section className="below-fold py-24 bg-white px-4 md:px-12">
        <div className="container mx-auto">
          <FadeIn className="text-center mb-16">
            <h2 className="font-serif text-3xl md:text-5xl text-earth leading-tight mb-4">Louie Kids & Co.</h2>
            <p className="font-sans text-earth/80 text-sm tracking-widest uppercase">
              Shop Our Curated Kids Selection
            </p>
          </FadeIn>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:auto-rows-[minmax(300px,auto)]">
            {KIDS_CATEGORIES.map((cat, idx) => (
              <FadeIn
                key={cat.id}
                delay={idx * 150}
                className={`group cursor-pointer relative overflow-hidden rounded-[2.5rem] shadow-sm border border-earth/5 aspect-[4/3] md:aspect-auto ${idx === 0 ? 'md:row-span-2 md:h-auto' : 'md:h-[400px]'
                  }`}
              >
                <a
                  href={`#collection/kids?cat=${encodeURIComponent(cat.title)}`} onClick={event => navigatePlainLink(event, `#collection/kids?cat=${encodeURIComponent(cat.title)}`, navigateTo)}
                  className="block w-full h-full relative"
                >
                  {/* Mobile-only override for Girls category */}
                  {cat.id === 'girls' ? (
                    <picture>
                      <source
                        media="(max-width: 767px)"
                        srcSet="/images/brand/girls-dress1.png"
                      />
                      <img
                        {...responsiveImage(cat.image, '(min-width: 1024px) 50vw, 100vw')}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110"
                      />
                    </picture>
                  ) : (
                    <img
                      {...responsiveImage(cat.image, '(min-width: 1024px) 50vw, 100vw')}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110"
                    />
                  )}

                  {/* Overlay Gradient (Elevated) */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-80 group-hover:opacity-90 transition-opacity"></div>

                  {/* Subtle Inner Border Glow */}
                  <div className="absolute inset-0 border-[2px] border-white/0 group-hover:border-white/10 rounded-[2.5rem] transition-colors duration-500 pointer-events-none z-10"></div>

                  {/* Content */}
                  <div className="absolute bottom-0 left-0 right-0 p-8 md:p-10 flex flex-col justify-end items-start transform transition-transform duration-500 group-hover:-translate-y-2">
                    {cat.caption && (
                      <span className="text-[10px] uppercase tracking-[0.3em] text-white/80 mb-2">{cat.caption}</span>
                    )}
                    <div className="flex items-center justify-between w-full">
                      <h3 className="font-serif text-2xl md:text-5xl text-white leading-none whitespace-nowrap">{cat.title}</h3>
                      <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-4 group-hover:translate-x-0">
                        <ArrowUpRight className="w-5 h-5 text-white" />
                      </div>
                    </div>
                  </div>
                </a>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Brand Feature Section */}
      <section className="below-fold pb-20 px-4 md:px-12 bg-cream">
        <div className="container mx-auto flex flex-col items-center">
          <FadeIn className="text-center mb-10">
            <p className="text-bronze text-xs md:text-sm uppercase tracking-[0.25em] mb-3">Est. 2021</p>
            <h2 className="font-serif text-6xl md:text-8xl text-earth leading-none">Louie Mae</h2>
          </FadeIn>

          <FadeIn delay={200} className="w-full max-w-4xl overflow-hidden rounded-2xl shadow-lg">
            <img
              loading="lazy"
              decoding="async"
              {...responsiveImage(home.brand.image, '(min-width: 1024px) 50vw, 100vw')}
              alt="Louie Mae Signature Interior"
              className="w-full h-auto object-cover transition-transform duration-[30s] hover:scale-105"
            />
          </FadeIn>
        </div>
      </section>

      {/* DYNAMIC SECTIONS (Added via Admin) */}
      {home.sections && home.sections.length > 0 && (
        <div className="pb-24">
          {home.sections.map((section, idx) => (
            <DynamicSectionRenderer key={section.id} section={section} index={idx} />
          ))}
        </div>
      )}

      {/* 5. Newsletter - Atelier Gradient & Glowing Inputs */}
      <section className="below-fold relative py-32 text-center px-6 overflow-hidden">
        {/* Background Gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#1a130a] via-[#2d1f12] to-[#3a2a1a]"></div>
        {/* Ambient Glows */}
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-bronze/10 filter blur-[100px] rounded-full pointer-events-none opacity-50"></div>
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-white/5 filter blur-[100px] rounded-full pointer-events-none opacity-50"></div>

        <FadeIn className="relative z-10">
          <h2 className="font-serif text-4xl md:text-6xl text-cream mb-4 tracking-tight drop-shadow-lg">Join The Mae Letter</h2>
          <p className="font-serif text-2xl md:text-3xl italic text-[#D6B99C] mb-12 font-light">Newsletter</p>

          <div className="max-w-xl mx-auto space-y-2 text-muted-cream font-sans text-sm md:text-base leading-relaxed mb-16">
            <p>To Get First Look At New Product Drops, Personal Notifications</p>
            <p>To New Blog Posts, And Exclusive Access To Discount Codes</p>
            <p>And Updates From Louie Mae.</p>
          </div>

          <form className="max-w-xl mx-auto space-y-8" onSubmit={handleSubscribe}>
            <div className="text-left group relative">
              <label htmlFor="home-letter-name" className="block font-serif text-xl text-cream/90 mb-2 pl-4 transition-colors group-focus-within:text-[#D6B99C]">First Name</label>
              <div className="absolute -inset-0.5 bg-gradient-to-r from-bronze/0 via-bronze/20 to-bronze/0 rounded-xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-500 blur-sm"></div>
              <input
                id="home-letter-name"
                type="text"
                autoComplete="given-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full relative bg-white/5 backdrop-blur-md border border-white/10 rounded-xl py-4 px-6 text-cream focus:outline-none focus:border-bronze focus:bg-white/10 transition-all font-sans text-lg shadow-[inset_0_2px_10px_rgba(0,0,0,0.2)]"
              />
            </div>
            <div className="text-left group relative">
              <label htmlFor="home-letter-email" className="block font-serif text-xl text-cream/90 mb-2 pl-4 transition-colors group-focus-within:text-[#D6B99C]">Email</label>
              <div className="absolute -inset-0.5 bg-gradient-to-r from-bronze/0 via-bronze/20 to-bronze/0 rounded-xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-500 blur-sm"></div>
              <input
                id="home-letter-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full relative bg-white/5 backdrop-blur-md border border-white/10 rounded-xl py-4 px-6 text-cream focus:outline-none focus:border-bronze focus:bg-white/10 transition-all font-sans text-lg shadow-[inset_0_2px_10px_rgba(0,0,0,0.2)]"
              />
            </div>

            <div className="flex justify-center pt-8">
              <GlassButton
                type="submit"
                variant="dark"
                disabled={subStatus === 'loading' || subStatus === 'success'}
              >
                {subStatus === 'loading' ? 'Joining...' : subStatus === 'success' ? <><Check className="w-4 h-4" /> Joined</> : 'Submit'}
              </GlassButton>
            </div>
          </form>
        </FadeIn>
      </section>

      <LazyProductPreview productId={selectedProductId} onClose={() => openProduct(null)} />
    </main>
  );
};
