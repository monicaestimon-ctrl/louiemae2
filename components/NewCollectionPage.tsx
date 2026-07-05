import React, { useMemo, useState } from 'react';
import { FadeIn } from './FadeIn';
import { useSite } from '../contexts/BlogContext';
import { useNewsletter } from '../contexts/NewsletterContext';
import { Product } from '../types';
import { ArrowRight, Check } from 'lucide-react';
import { SafeImage } from './SafeImage';
import { isProductVisibleOnStorefront } from '../lib/productVisibility';

// Collection drop configuration
const DROP_NAME = "Consider the Lilies";
const DROP_TAGLINE = "Curated pieces for the season ahead";

const CATEGORY_SECTIONS = [
    { id: 'fashion', title: 'The Mae Collective', subtitle: 'Womenswear', route: '#collection/fashion' },
    { id: 'kids', title: 'Louie Kids & Co.', subtitle: 'Childrenswear', route: '#collection/kids' },
    { id: 'furniture', title: 'Furniture', subtitle: 'Modern Organic', route: '#collection/furniture' },
    { id: 'decor', title: 'Home Decor', subtitle: 'Curated Objects', route: '#collection/decor' },
];

const navigateTo = (hash: string) => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
};

// Luxury Product Card with floating effects and staggered layout
const LuxuryProductCard: React.FC<{ product: Product; index: number }> = ({ product, index }) => {
    // Offset every other item on desktop for a staggered editorial grid look
    const isOffset = index % 2 !== 0;
    const offsetClass = isOffset ? "md:mt-24" : "";

    return (
        <FadeIn delay={index * 150} className={`group cursor-pointer flex flex-col w-full ${offsetClass}`}>
            <div
                className="relative aspect-[3/4] overflow-hidden bg-stone-50 mb-6 rounded-sm shadow-sm transition-all duration-700 hover:shadow-[0_30px_60px_-15px_rgba(0,0,0,0.15)] hover:-translate-y-3"
                onClick={() => navigateTo(`#collection/${product.collection}?cat=${encodeURIComponent(product.category)}`)}
            >
                <SafeImage
                    src={product.images[0]}
                    alt={product.name}
                    className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-[1.03]"
                />

                {/* Floating glass overlay on hover */}
                <div className="absolute inset-0 bg-stone-900/0 group-hover:bg-stone-900/10 transition-colors duration-500" />

                {/* Information Pill ascending on hover */}
                <div className="absolute bottom-4 left-4 right-4 translate-y-8 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-500 flex justify-between items-center bg-white/90 backdrop-blur-md px-5 py-3 rounded-sm">
                    <span className="text-[10px] uppercase tracking-[0.2em] text-earth font-medium">View Piece</span>
                    <span className="font-serif italic text-earth text-sm">${product.price}</span>
                </div>
            </div>

            <div className="text-center md:text-left px-2">
                <h3 className="font-serif text-xl md:text-2xl text-earth leading-tight transition-colors">
                    {product.name}
                </h3>
                <p className="text-earth/60 text-[10px] uppercase tracking-[0.2em] mt-3">{product.category}</p>
            </div>
        </FadeIn>
    );
};

const LuxuryCategorySection: React.FC<{
    title: string;
    subtitle: string;
    products: Product[];
    route: string;
}> = ({ title, subtitle, products, route }) => {
    if (products.length === 0) return null;

    return (
        <section className="py-12 md:py-20 border-b border-stone-200/40 last:border-0 relative">
            <div className="container mx-auto px-6 md:px-12">
                {/* Centered Editorial Section Header with Line Art */}
                <FadeIn className="flex flex-col items-center text-center mb-10 md:mb-16">
                    {/* Decorative Line Art */}
                    <div className="flex items-center gap-4 md:gap-6 w-full max-w-lg mb-6">
                        <div className="flex-1 h-[1px] bg-gradient-to-r from-transparent to-earth/20" />
                        <div className="w-2 h-2 rotate-45 border border-earth/30" />
                        <div className="flex-1 h-[1px] bg-gradient-to-l from-transparent to-earth/20" />
                    </div>

                    <h2 className="font-serif text-4xl md:text-6xl lg:text-7xl text-earth mb-4 tracking-tight italic font-light">{title}</h2>
                    <p className="text-[10px] text-earth/50 uppercase tracking-[0.3em] leading-relaxed mb-8">{subtitle}</p>

                    <button
                        onClick={() => navigateTo(route)}
                        className="group flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-earth/60 hover:text-earth transition-colors"
                    >
                        <span className="relative">
                            Explore Collection
                            <span className="absolute -bottom-1 left-0 w-0 h-[1px] bg-earth transition-all group-hover:w-full" />
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-2" />
                    </button>
                </FadeIn>

                {/* Staggered Masonry-style Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-8 lg:gap-x-12 gap-y-16">
                    {products.map((product, idx) => (
                        <LuxuryProductCard key={product.id} product={product} index={idx} />
                    ))}
                </div>
            </div>
        </section>
    );
};

export const NewCollectionPage: React.FC = () => {
    const { products } = useSite();
    const { addSubscriberWithTags } = useNewsletter();

    // VIP signup form state
    const [firstName, setFirstName] = useState('');
    const [email, setEmail] = useState('');
    const [signupStatus, setSignupStatus] = useState<'idle' | 'loading' | 'success'>('idle');

    const handleVipSignup = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) return;
        setSignupStatus('loading');
        await addSubscriberWithTags(email, firstName || 'Friend', ['vip', 'inner-circle', 'early-access']);
        setSignupStatus('success');
        setFirstName('');
        setEmail('');
    };

    const dropProducts = useMemo(() => {
        const result: Record<string, Product[]> = {};

        CATEGORY_SECTIONS.forEach(sec => {
            const colProducts = products.filter(p => p.collection === sec.id && isProductVisibleOnStorefront(p));

            colProducts.sort((a, b) => {
                const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
                const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
                if (!dateA && !dateB) {
                    return (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0);
                }
                return dateB - dateA;
            });

            result[sec.id] = colProducts.slice(0, 4);
        });

        return result;
    }, [products]);

    return (
        <div className="bg-[#FAF9F6] min-h-screen pt-[72px] selection:bg-stone-200">
            {/* Extremely Luxury Editorial Hero */}
            <div className="relative h-screen w-full overflow-hidden bg-stone-900 flex items-center justify-center">
                {/* Parallax Background */}
                <div
                    className="absolute inset-0 w-full h-full bg-cover bg-center opacity-80"
                    style={{
                        backgroundImage: `url('/images/brand/hero-living-organic.png')`,
                        backgroundAttachment: 'fixed' // Creates the parallax effect
                    }}
                />
                <div className="absolute inset-0 bg-gradient-to-b from-stone-900/30 via-stone-900/10 to-stone-900/50" />

                <div className="relative z-10 flex flex-col items-center justify-center w-full px-6">
                    <FadeIn delay={300}>
                        <h1 className="font-serif text-6xl md:text-8xl lg:text-[130px] leading-none text-white drop-shadow-2xl text-center tracking-tight italic font-light">
                            {DROP_NAME}
                        </h1>
                    </FadeIn>
                    <FadeIn delay={500}>
                        <p className="font-sans text-white/70 text-xs md:text-sm uppercase tracking-[0.4em] mt-6">
                            Collection
                        </p>
                    </FadeIn>
                    <FadeIn delay={700}>
                        <p className="font-sans text-white/50 text-[10px] md:text-xs uppercase tracking-[0.3em] mt-3">
                            Spring 2026
                        </p>
                    </FadeIn>
                </div>

                {/* Frosted Glass Pill — toward the bottom */}
                <FadeIn delay={900} className="absolute bottom-24 left-1/2 -translate-x-1/2">
                    <div className="px-6 py-2.5 backdrop-blur-md bg-white/5 border border-white/20 rounded-full shadow-2xl shadow-black/20">
                        <p className="font-sans text-white/90 text-[9px] md:text-[10px] uppercase tracking-[0.4em] font-medium">
                            {DROP_TAGLINE}
                        </p>
                    </div>
                </FadeIn>

                {/* Floating scroll indicator */}
                <FadeIn delay={1200} className="absolute bottom-12 left-1/2 -translate-x-1/2 flex flex-col items-center">
                    <div className="w-[1px] h-16 bg-gradient-to-b from-white/0 via-white/50 to-white/0 animate-pulse" />
                    <span className="text-[9px] text-white/50 uppercase tracking-[0.3em] mt-4">Scroll to discover</span>
                </FadeIn>
            </div>

            {/* Quiet Luxury Intro Text */}
            <section className="pt-20 md:pt-28 pb-8 md:pb-12 px-6 text-center max-w-3xl mx-auto relative">
                <FadeIn>
                    <p className="font-serif text-2xl md:text-3xl lg:text-4xl text-earth leading-relaxed md:leading-snug italic text-stone-600/90 font-light tracking-tight">
                        "A celebration of pristine textures, earthy tones, and the profound joy of curating a sanctuary. Elevated intention for your home and wardrobe."
                    </p>
                </FadeIn>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-[1px] bg-gradient-to-r from-transparent via-earth/10 to-transparent -z-10" />
            </section>

            {/* Collection Gallery Sections */}
            <div className="pb-32 bg-gradient-to-b from-[#FAF9F6] to-white">
                {CATEGORY_SECTIONS.map((section) => (
                    <LuxuryCategorySection
                        key={section.id}
                        title={section.title}
                        subtitle={section.subtitle}
                        products={dropProducts[section.id] || []}
                        route={section.route}
                    />
                ))}
            </div>

            {/* The Velvet Rope - Waitlist */}
            <section className="relative py-32 md:py-48 flex items-center justify-center overflow-hidden">
                <div
                    className="absolute inset-0 w-full h-full bg-cover bg-center opacity-90"
                    style={{
                        backgroundImage: `url('/images/brand/hero-living.png')`,
                        backgroundAttachment: 'fixed'
                    }}
                />
                <div className="absolute inset-0 bg-earth/40" />

                <FadeIn className="relative z-10 w-full max-w-2xl mx-auto px-6">
                    <div className="backdrop-blur-2xl bg-earth/15 border border-white/10 p-10 md:p-16 rounded-[2rem] shadow-2xl relative overflow-hidden">
                        {/* Subtle light effect inside the card */}
                        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-white/30 to-transparent" />

                        <div className="text-center mb-12">
                            <h2 className="font-serif text-5xl md:text-6xl text-white mb-6 tracking-tight">Never Miss<br /><span className="italic text-white/80 font-light">a Drop</span></h2>
                            <p className="text-[10px] md:text-xs text-white/60 uppercase tracking-[0.2em] leading-relaxed max-w-md mx-auto">
                                Join the inner circle. Receive 24-hour early access to curated drops before they open to the public.
                            </p>
                        </div>

                        {signupStatus === 'success' ? (
                            <FadeIn className="text-center py-8">
                                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full border border-white/20 mb-6 bg-white/5">
                                    <Check className="w-6 h-6 text-white" />
                                </div>
                                <h3 className="font-serif text-3xl md:text-4xl text-white mb-3">Welcome In.</h3>
                                <p className="text-[10px] text-white/50 uppercase tracking-[0.2em]">Your early access is secured.</p>
                            </FadeIn>
                        ) : (
                            <form onSubmit={handleVipSignup} className="space-y-10">
                                <div className="space-y-8">
                                    <div className="relative group">
                                        <input
                                            type="text"
                                            value={firstName}
                                            onChange={(e) => setFirstName(e.target.value)}
                                            placeholder="First Name"
                                            className="w-full bg-transparent border-b border-white/20 pb-3 text-lg text-white placeholder:text-white/30 focus:outline-none focus:border-white transition-colors"
                                        />
                                    </div>
                                    <div className="relative group">
                                        <input
                                            type="email"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            placeholder="Email Address"
                                            required
                                            className="w-full bg-transparent border-b border-white/20 pb-3 text-lg text-white placeholder:text-white/30 focus:outline-none focus:border-white transition-colors"
                                        />
                                    </div>
                                </div>

                                <button
                                    type="submit"
                                    disabled={signupStatus === 'loading'}
                                    className="w-full bg-white text-stone-900 py-5 text-[10px] uppercase tracking-[0.25em] hover:bg-stone-200 transition-colors disabled:opacity-70 font-medium"
                                >
                                    {signupStatus === 'loading' ? 'Requesting Access...' : 'Request Early Access'}
                                </button>
                                <p className="text-[9px] text-center text-white/30 uppercase tracking-[0.2em] pt-4">
                                    A quiet, curated inbox experience.
                                </p>
                            </form>
                        )}
                    </div>
                </FadeIn>
            </section>
        </div>
    );
};

export default NewCollectionPage;
