
import React, { useState } from 'react';
import { FadeIn } from './FadeIn';
import { GlassButton } from './ui/GlassButton';
import { PRODUCTS, FASHION_CATEGORIES, KIDS_CATEGORIES } from '../constants';
import { useSite } from '../contexts/BlogContext';
import { useNewsletter } from '../contexts/NewsletterContext';
import { Product } from '../types';
import { X, ShoppingBag, ArrowUpRight, Check } from 'lucide-react';
import { DynamicSectionRenderer } from './DynamicPage';
import { SafeImage } from './SafeImage';

export const HomePage: React.FC = () => {
  const { siteContent, isLoading } = useSite();
  const { home } = siteContent;
  const { addSubscriber } = useNewsletter();
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);



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

  return (
    <>
      {/* Hero Section */}
      <section className="relative h-screen w-full overflow-hidden">
        <div className="absolute inset-0 bg-black/20 z-10"></div>
        <img
          key={home.hero.image || 'hero'}
          src={home.hero.image}
          alt="Interior"
          loading="eager"
          fetchPriority="high"
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-[20s] hover:scale-105"
          style={{ backgroundColor: '#d4c9b8' }}
        />
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center text-center px-4">
          <FadeIn>
            <p className="text-white/90 text-sm md:text-base uppercase tracking-[0.3em] mb-6">{home.hero.pretitle}</p>
          </FadeIn>
          <FadeIn delay={200}>
            <h2 className="font-serif text-5xl md:text-7xl lg:text-8xl text-cream leading-tight mb-8 drop-shadow-lg max-w-5xl">
              {home.hero.titleLine1}<br />
              <span className="italic">{home.hero.titleLine2}</span>
            </h2>
          </FadeIn>
          <FadeIn delay={400}>
            <GlassButton
              onClick={() => navigateTo('#collection/new')}
            >
              New Collection
            </GlassButton>
          </FadeIn>
        </div>
      </section>

      {/* Intro Text */}
      <section className="py-24 px-6 container mx-auto text-center">
        <FadeIn>
          <h3 className="font-serif text-3xl md:text-5xl text-earth leading-tight max-w-5xl mx-auto">
            {home.intro.text}
          </h3>
        </FadeIn>
      </section>

      {/* 1. Main Categories */}
      <section className="pb-24 px-4 md:px-12 bg-cream">
        <div className="container mx-auto grid grid-cols-1 gap-4 md:gap-6">

          {/* Top Row: Furniture & Decor */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            {/* Furniture */}
            <div
              id="furniture"
              onClick={() => navigateTo('#collection/furniture')}
              className="relative group cursor-pointer aspect-[4/3] w-full overflow-hidden rounded-2xl shadow-lg hover:shadow-[0_20px_40px_rgba(0,0,0,0.15)] hover:-translate-y-1 transition-all duration-500 border border-white/5"
            >
              <img
                src={home.categoryImages.furniture}
                alt="Furniture"
                className="w-full h-full object-cover transition-transform duration-[1.5s] group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent group-hover:opacity-80 transition-opacity duration-500"></div>
              <div className="absolute bottom-6 left-6 md:bottom-8 md:left-8 transform transition-transform duration-500 group-hover:-translate-y-2">
                <h2 className="font-serif text-2xl md:text-3xl text-white tracking-wide drop-shadow-md">Furniture</h2>
              </div>
            </div>

            {/* Decor */}
            <div
              id="decor"
              onClick={() => navigateTo('#collection/decor')}
              className="relative group cursor-pointer aspect-[4/3] w-full overflow-hidden rounded-2xl shadow-lg hover:shadow-[0_20px_40px_rgba(0,0,0,0.15)] hover:-translate-y-1 transition-all duration-500 border border-white/5"
            >
              <img
                src={home.categoryImages.decor}
                alt="Decor"
                className="w-full h-full object-cover transition-transform duration-[1.5s] group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent group-hover:opacity-80 transition-opacity duration-500"></div>
              <div className="absolute bottom-6 left-6 md:bottom-8 md:left-8 transform transition-transform duration-500 group-hover:-translate-y-2">
                <h2 className="font-serif text-2xl md:text-3xl text-white tracking-wide drop-shadow-md">Decor</h2>
              </div>
            </div>
          </div>

          {/* Bottom Row: Mae Collective, Kids, Blog */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
            {/* The Mae Collective */}
            <div
              id="fashion"
              onClick={() => navigateTo('#collection/fashion')}
              className="relative group cursor-pointer aspect-[4/3] md:aspect-auto md:h-[500px] w-full overflow-hidden rounded-2xl shadow-lg hover:shadow-[0_20px_40px_rgba(0,0,0,0.15)] hover:-translate-y-1 transition-all duration-500 border border-white/5"
            >
              <img
                src={home.categoryImages.fashion}
                alt="The Mae Collective"
                className="w-full h-full object-cover object-top transition-transform duration-[1.5s] group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent group-hover:opacity-80 transition-opacity duration-500"></div>
              <div className="absolute bottom-6 left-6 md:bottom-8 md:left-8 transform transition-transform duration-500 group-hover:-translate-y-2">
                <h3 className="font-serif text-2xl md:text-3xl text-white drop-shadow-md">The Mae Collective</h3>
              </div>
            </div>

            {/* Louie Kids & Co. */}
            <div
              id="kids"
              onClick={() => navigateTo('#collection/kids')}
              className="relative group cursor-pointer aspect-[4/3] md:aspect-auto md:h-[500px] w-full overflow-hidden rounded-2xl shadow-lg hover:shadow-[0_20px_40px_rgba(0,0,0,0.15)] hover:-translate-y-1 transition-all duration-500 border border-white/5"
            >
              <img
                src={home.categoryImages.kids}
                alt="Louie Kids & Co."
                className="w-full h-full object-cover object-top transition-transform duration-[1.5s] group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent group-hover:opacity-80 transition-opacity duration-500"></div>
              <div className="absolute bottom-6 left-6 md:bottom-8 md:left-8 transform transition-transform duration-500 group-hover:-translate-y-2">
                <h3 className="font-serif text-2xl md:text-3xl text-white drop-shadow-md">Louie Kids & Co.</h3>
              </div>
            </div>

            {/* Blog */}
            <div
              id="journal"
              onClick={() => navigateTo('#blog')}
              className="relative group cursor-pointer aspect-[4/3] md:aspect-auto md:h-[500px] w-full overflow-hidden rounded-2xl shadow-lg hover:shadow-[0_20px_40px_rgba(0,0,0,0.15)] hover:-translate-y-1 transition-all duration-500 border border-white/5"
            >
              <img
                src={home.categoryImages.journal}
                alt="Blog"
                className="w-full h-full object-cover transition-transform duration-[1.5s] group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent group-hover:opacity-80 transition-opacity duration-500"></div>
              <div className="absolute bottom-6 left-6 md:bottom-8 md:left-8 transform transition-transform duration-500 group-hover:-translate-y-2">
                <h3 className="font-serif text-2xl md:text-3xl text-white drop-shadow-md">Blog</h3>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* 2. Fashion Categories (Detailed) */}
      <section className="py-20 px-4 md:px-12 bg-white">
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
                <div
                  onClick={() => navigateTo(`#collection/fashion?cat=${encodeURIComponent(cat.title)}`)}
                  className="relative aspect-[3/4] overflow-hidden rounded-2xl mb-4 shadow-md group-hover:shadow-[0_20px_40px_rgba(0,0,0,0.15)] group-hover:-translate-y-2 transition-all duration-500 border border-white/40"
                >
                  <img
                    src={cat.image}
                    alt={cat.title}
                    className="w-full h-full object-cover transition-transform duration-[1.5s] group-hover:scale-105"
                  />
                  {/* Subtle Inner Glow Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                </div>
                <h4
                  onClick={() => navigateTo(`#collection/fashion?cat=${encodeURIComponent(cat.title)}`)}
                  className="font-serif text-lg md:text-xl text-earth group-hover:text-bronze transition-colors px-1"
                >
                  {cat.title}
                </h4>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* 3. Recommended Products */}
      <section className="py-20 px-4 md:px-12 bg-cream-dark/30">
        <div className="container mx-auto">
          <FadeIn className="mb-12 text-center">
            <h2 className="font-serif text-3xl md:text-5xl text-earth leading-tight max-w-5xl mx-auto mb-6">
              Design your Home Interior with pieces we love at Louie Mae
            </h2>
            <div className="w-24 h-px bg-bronze mx-auto mb-6"></div>
            <h3 className="font-serif text-lg md:text-xl text-earth italic">Recommended Products</h3>
          </FadeIn>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 md:gap-8">
            {PRODUCTS.map((product, idx) => (
              <FadeIn key={product.id} delay={idx * 100} className="group cursor-pointer">
                <div
                  className="relative aspect-square overflow-hidden bg-white mb-4 rounded-2xl shadow-sm hover:shadow-[0_20px_40px_rgba(0,0,0,0.1)] hover:-translate-y-1 transition-all duration-500 border border-earth/5"
                  onClick={() => setSelectedProduct(product)}
                >
                  {product.isNew && (
                    <span className="absolute top-3 left-3 bg-white/90 backdrop-blur-md px-2 py-1 text-[9px] uppercase tracking-widest text-earth z-10 rounded-sm shadow-sm border border-white/50">
                      New
                    </span>
                  )}
                  <SafeImage
                    src={product.images[0]}
                    alt={product.name}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />

                  {/* Quick View Overlay (Glass) */}
                  <div className="absolute bottom-0 left-0 right-0 p-4 translate-y-full group-hover:translate-y-0 transition-transform duration-500">
                    <button className="w-full bg-white/80 backdrop-blur-md text-earth border border-white/50 py-3 rounded-lg text-[10px] uppercase tracking-[0.2em] shadow-[0_10px_20px_rgba(0,0,0,0.1)] hover:bg-earth hover:text-white transition-colors duration-300">
                      Quick View
                    </button>
                  </div>
                </div>
                <div onClick={() => setSelectedProduct(product)} className="px-1">
                  <h3 className="font-serif text-lg md:text-xl text-earth leading-tight mb-1 group-hover:text-bronze transition-colors">
                    {product.name}
                  </h3>
                  <p className="font-serif italic text-earth/80 text-base group-hover:text-bronze/80 transition-colors">${product.price}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* 4. Kids Categories (Detailed - Updated Asymmetrical Grid) */}
      <section className="py-24 bg-white px-4 md:px-12">
        <div className="container mx-auto">
          <FadeIn className="text-center mb-16">
            <h2 className="font-serif text-3xl md:text-5xl text-earth leading-tight mb-4">Louie Kids & Co.</h2>
            <p className="font-sans text-earth/70 text-sm tracking-widest uppercase">
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
                <div
                  onClick={() => navigateTo(`#collection/kids?cat=${encodeURIComponent(cat.title)}`)}
                  className="w-full h-full relative"
                >
                  {/* Mobile-only override for Girls category */}
                  {cat.id === 'girls' ? (
                    <picture>
                      <source
                        media="(max-width: 767px)"
                        srcSet="/images/brand/girls-dress1.png"
                      />
                      <img
                        src={cat.image}
                        alt={cat.title}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110"
                      />
                    </picture>
                  ) : (
                    <img
                      src={cat.image}
                      alt={cat.title}
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
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Brand Feature Section */}
      <section className="pb-20 px-4 md:px-12 bg-cream">
        <div className="container mx-auto flex flex-col items-center">
          <FadeIn className="text-center mb-10">
            <p className="text-bronze text-xs md:text-sm uppercase tracking-[0.25em] mb-3">Est. 2021</p>
            <h2 className="font-serif text-6xl md:text-8xl text-earth leading-none">Louie Mae</h2>
          </FadeIn>

          <FadeIn delay={200} className="w-full max-w-4xl overflow-hidden rounded-2xl shadow-lg">
            <img
              src={home.brand.image}
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
      <section className="relative py-32 text-center px-6 overflow-hidden">
        {/* Background Gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#1a130a] via-[#2d1f12] to-[#3a2a1a]"></div>
        {/* Ambient Glows */}
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-bronze/10 filter blur-[100px] rounded-full pointer-events-none opacity-50"></div>
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-white/5 filter blur-[100px] rounded-full pointer-events-none opacity-50"></div>

        <FadeIn className="relative z-10">
          <h2 className="font-serif text-4xl md:text-6xl text-cream mb-4 tracking-tight drop-shadow-lg">Join The Mae Letter</h2>
          <p className="font-serif text-2xl md:text-3xl italic text-bronze mb-12 font-light">Newsletter</p>

          <div className="max-w-xl mx-auto space-y-2 text-cream/70 font-sans text-sm md:text-base leading-relaxed mb-16">
            <p>To Get First Look At New Product Drops, Personal Notifications</p>
            <p>To New Blog Posts, And Exclusive Access To Discount Codes</p>
            <p>And Updates From Louie Mae.</p>
          </div>

          <form className="max-w-xl mx-auto space-y-8" onSubmit={handleSubscribe}>
            <div className="text-left group relative">
              <label className="block font-serif text-xl text-cream/90 mb-2 pl-4 transition-colors group-focus-within:text-bronze">First Name</label>
              <div className="absolute -inset-0.5 bg-gradient-to-r from-bronze/0 via-bronze/20 to-bronze/0 rounded-xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-500 blur-sm"></div>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full relative bg-white/5 backdrop-blur-md border border-white/10 rounded-xl py-4 px-6 text-cream focus:outline-none focus:border-bronze focus:bg-white/10 transition-all font-sans text-lg shadow-[inset_0_2px_10px_rgba(0,0,0,0.2)]"
              />
            </div>
            <div className="text-left group relative">
              <label className="block font-serif text-xl text-cream/90 mb-2 pl-4 transition-colors group-focus-within:text-bronze">Email</label>
              <div className="absolute -inset-0.5 bg-gradient-to-r from-bronze/0 via-bronze/20 to-bronze/0 rounded-xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-500 blur-sm"></div>
              <input
                type="email"
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

      {/* Product Modal - Frosted Glass Upgrade */}
      {selectedProduct && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 md:p-8">
          <div className="absolute inset-0 backdrop-blur-xl motion-reduce:backdrop-blur-none bg-black/50" onClick={() => setSelectedProduct(null)}></div>

          <div className="bg-white/95 backdrop-blur-xl w-full max-w-5xl h-[90vh] md:h-auto md:max-h-[85vh] rounded-3xl shadow-[0_30px_60px_rgba(0,0,0,0.3)] relative flex flex-col md:flex-row overflow-hidden animate-fade-in-up border border-white/60">
            <button
              onClick={() => setSelectedProduct(null)}
              className="absolute top-4 right-4 z-20 p-2 bg-black/5 hover:bg-black/10 rounded-full transition-colors backdrop-blur-md"
            >
              <X className="w-5 h-5 text-earth" />
            </button>

            {/* Image Gallery */}
            <div className="w-full md:w-1/2 bg-earth/5 h-1/2 md:h-auto overflow-hidden relative group">
              <SafeImage src={selectedProduct.images[0]} alt={selectedProduct.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-[1.5s]" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent pointer-events-none" />
            </div>

            {/* Details */}
            <div className="w-full md:w-1/2 p-8 md:p-12 overflow-y-auto flex flex-col relative bg-gradient-to-br from-white/40 to-white/10">
              <div className="mb-auto relative z-10">
                <div className="flex items-center gap-3 mb-6 text-[10px] uppercase tracking-[0.2em] text-earth/60 font-medium">
                  <span className="w-1.5 h-1.5 bg-bronze rounded-full shadow-[0_0_8px_rgba(139,90,43,0.5)]"></span>
                  <span>{selectedProduct.category}</span>
                </div>

                <h2 className="font-serif text-3xl md:text-5xl text-earth mb-3 leading-tight drop-shadow-sm">{selectedProduct.name}</h2>
                <p className="font-serif text-2xl italic text-bronze mb-8">${selectedProduct.price}</p>

                <div className="h-px w-full bg-gradient-to-r from-earth/20 via-earth/5 to-transparent mb-8"></div>

                <p className="font-sans text-earth/70 leading-relaxed mb-8 text-sm">
                  {selectedProduct.description}
                </p>

                <div className="space-y-4 mb-8">
                  <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50/50 backdrop-blur-sm px-4 py-2 rounded-lg border border-green-100/50 max-w-max">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-600 animate-pulse"></span>
                    {selectedProduct.inStock ? 'In Stock & Ready to Ship' : 'Made to Order'}
                  </div>
                </div>
              </div>

              <div className="relative z-10 mt-8">
                <GlassButton variant="primary" fullWidth className="py-4 shadow-xl">
                  <ShoppingBag className="w-4 h-4" /> Add to Bag
                </GlassButton>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
