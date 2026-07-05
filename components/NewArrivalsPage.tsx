
import React, { useMemo } from 'react';
import { FadeIn } from './FadeIn';
import { useSite } from '../contexts/BlogContext';
import { Product } from '../types';
import { ArrowRight } from 'lucide-react';
import { GlassButton } from './ui/GlassButton';
import { SafeImage } from './SafeImage';
import { isProductVisibleOnStorefront } from '../lib/productVisibility';

// Collection config for display
const COLLECTIONS = [
    { id: 'fashion', title: "Women's", subtitle: 'The Mae Collective', route: '#collection/fashion', accent: 'from-rose-900/20 to-amber-900/10' },
    { id: 'kids', title: 'Kids', subtitle: 'Louie Kids & Co.', route: '#collection/kids', accent: 'from-sky-900/15 to-indigo-900/10' },
    { id: 'furniture', title: 'Furniture', subtitle: 'Timeless Pieces', route: '#collection/furniture', accent: 'from-stone-800/15 to-amber-900/10' },
    { id: 'decor', title: 'Decor', subtitle: 'Home Accents', route: '#collection/decor', accent: 'from-emerald-900/10 to-stone-800/10' },
];

const navigateTo = (hash: string) => {
    window.location.hash = hash;
    // Explicitly dispatch hashchange for mobile reliability
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
};

// Reusable product card
const ProductCard: React.FC<{ product: Product; index: number }> = ({ product, index }) => (
    <FadeIn delay={index * 80} className="group cursor-pointer flex-shrink-0 w-[260px] md:w-[300px] snap-center">
        <div
            className="relative aspect-[3/4] overflow-hidden bg-white mb-3 rounded-xl shadow-sm"
            onClick={() => navigateTo(`#collection/${product.collection}?cat=${encodeURIComponent(product.category)}`)}
        >
            {product.isNew && (
                <span className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm px-2.5 py-1 text-[8px] uppercase tracking-widest text-earth z-10 rounded-full">
                    New
                </span>
            )}
            <SafeImage
                src={product.images[0]}
                alt={product.name}
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors" />
            <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-full group-hover:translate-y-0 transition-transform duration-300">
                <button className="w-full bg-white/90 backdrop-blur-sm text-earth py-2.5 text-[9px] uppercase tracking-[0.2em] shadow-lg hover:bg-earth hover:text-white transition-colors rounded-lg">
                    Quick View
                </button>
            </div>
        </div>
        <h3 className="font-serif text-base text-earth leading-tight mb-1 group-hover:text-bronze transition-colors truncate px-1">
            {product.name}
        </h3>
        <span className="font-serif italic text-earth/80 text-sm px-1">${product.price}</span>
    </FadeIn>
);

// Horizontal scroll section per collection
const CollectionRow: React.FC<{
    title: string;
    subtitle: string;
    products: Product[];
    route: string;
    accent: string;
    index: number;
}> = ({ title, subtitle, products, route, accent, index }) => {
    if (products.length === 0) return null;

    return (
        <FadeIn delay={index * 150}>
            <section className="mb-20 md:mb-28">
                {/* Section Header */}
                <div className="px-6 md:px-12 mb-8">
                    <div className="container mx-auto flex items-end justify-between">
                        <div>
                            <p className="text-[10px] uppercase tracking-[0.3em] text-bronze/70 mb-2">{subtitle}</p>
                            <h2 className="font-serif text-3xl md:text-5xl text-earth">{title}</h2>
                        </div>
                        <button
                            onClick={() => navigateTo(route)}
                            className="hidden md:flex items-center gap-2 text-[10px] uppercase tracking-widest text-earth/50 hover:text-earth transition-colors group"
                        >
                            Shop All {title}
                            <ArrowRight className="w-3.5 h-3.5 transform group-hover:translate-x-1 transition-transform" />
                        </button>
                    </div>
                </div>

                {/* Product Carousel */}
                <div className="relative">
                    {/* Fade edges */}
                    <div className="absolute left-0 top-0 bottom-0 w-6 md:w-12 bg-gradient-to-r from-cream to-transparent z-10 pointer-events-none" />
                    <div className="absolute right-0 top-0 bottom-0 w-6 md:w-12 bg-gradient-to-l from-cream to-transparent z-10 pointer-events-none" />

                    <div
                        className="flex gap-4 md:gap-6 overflow-x-auto scrollbar-hide px-6 md:px-12 pb-4 scroll-smooth snap-x snap-mandatory"
                        style={{ WebkitOverflowScrolling: 'touch' }}
                    >
                        {products.map((product, idx) => (
                            <ProductCard key={product.id} product={product} index={idx} />
                        ))}

                        {/* "Shop All" end card */}
                        <div className="flex-shrink-0 w-[200px] md:w-[240px] snap-center flex items-center justify-center">
                            <button
                                onClick={() => navigateTo(route)}
                                className="group flex flex-col items-center gap-4 text-earth/40 hover:text-earth transition-colors"
                            >
                                <div className="w-16 h-16 rounded-full border border-earth/15 flex items-center justify-center group-hover:border-earth/40 group-hover:bg-earth/5 transition-all">
                                    <ArrowRight className="w-5 h-5 transform group-hover:translate-x-1 transition-transform" />
                                </div>
                                <span className="text-[10px] uppercase tracking-widest">Shop All</span>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Mobile "Shop All" button */}
                <div className="md:hidden px-6 mt-6">
                    <button
                        onClick={() => navigateTo(route)}
                        className="w-full flex items-center justify-center gap-2 py-3 border border-earth/10 rounded-xl text-[10px] uppercase tracking-widest text-earth/60 hover:text-earth hover:border-earth/30 transition-all"
                    >
                        Shop All {title} <ArrowRight className="w-3 h-3" />
                    </button>
                </div>
            </section>
        </FadeIn>
    );
};

export const NewArrivalsPage: React.FC = () => {
    const { products } = useSite();

    // Get newest products per collection — auto-expire after 30 days
    const collectionProducts = useMemo(() => {
        const result: Record<string, Product[]> = {};
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

        COLLECTIONS.forEach(col => {
            const colProducts = products.filter(p => p.collection === col.id && isProductVisibleOnStorefront(p));

            // Filter to products published within last 30 days, or marked isNew (legacy fallback)
            const newArrivals = colProducts.filter(p => {
                if (p.publishedAt) {
                    return new Date(p.publishedAt).getTime() > thirtyDaysAgo;
                }
                // Legacy products without publishedAt — fall back to isNew flag
                return p.isNew === true;
            });

            // Sort by publish date (newest first), then by name for consistency
            newArrivals.sort((a, b) => {
                const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
                const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
                return dateB - dateA;
            });

            result[col.id] = newArrivals.slice(0, 12);
        });

        return result;
    }, [products]);

    // Total count for hero
    const totalNew = Object.values(collectionProducts).reduce((sum, arr) => sum + arr.length, 0);

    return (
        <div className="bg-cream min-h-screen pt-24 pb-20">

            {/* Hero */}
            <div className="text-center px-6 mb-20">
                <FadeIn>
                    <h1 className="font-serif text-5xl md:text-7xl text-earth mb-6">New Arrivals</h1>
                    <p className="font-sans text-earth/60 text-sm max-w-lg mx-auto leading-relaxed">
                        The latest additions to our curated collection — handpicked with love for your home, your wardrobe, and your little ones.
                    </p>
                </FadeIn>
            </div>

            {/* Quick Jump Nav */}
            <FadeIn delay={100}>
                <div className="flex flex-wrap justify-center gap-3 px-6 mb-16">
                    {COLLECTIONS.map((col) => {
                        const count = collectionProducts[col.id]?.length || 0;
                        if (count === 0) return null;
                        return (
                            <button
                                key={col.id}
                                onClick={() => {
                                    const el = document.getElementById(`new-${col.id}`);
                                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                }}
                                className="flex items-center gap-2 px-5 py-2.5 border border-earth/10 rounded-full text-[10px] uppercase tracking-widest text-earth/60 hover:text-earth hover:border-earth/30 hover:bg-white/50 transition-all"
                            >
                                {col.title}
                                <span className="bg-earth/5 px-2 py-0.5 rounded-full text-[9px] text-earth/40">{count}</span>
                            </button>
                        );
                    })}
                </div>
            </FadeIn>

            {/* Collection Rows */}
            {COLLECTIONS.map((col, idx) => (
                <div key={col.id} id={`new-${col.id}`}>
                    <CollectionRow
                        title={col.title}
                        subtitle={col.subtitle}
                        products={collectionProducts[col.id] || []}
                        route={col.route}
                        accent={col.accent}
                        index={idx}
                    />
                </div>
            ))}

            {/* Bottom CTA */}
            <FadeIn>
                <div className="text-center px-6 pt-8 pb-4">
                    <p className="font-serif text-earth/40 text-lg italic mb-6">Can't find what you're looking for?</p>
                    <div className="flex flex-wrap justify-center gap-4">
                        <GlassButton onClick={() => navigateTo('#shop')} variant="dark">
                            Browse All Collections
                        </GlassButton>
                    </div>
                </div>
            </FadeIn>
        </div>
    );
};
