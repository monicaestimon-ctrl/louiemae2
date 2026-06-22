
import React from 'react';
import { CustomPage, PageSection } from '../types';
import { FadeIn } from './FadeIn';
import { ArrowUpRight, ArrowRight } from 'lucide-react';
import { useSite } from '../contexts/BlogContext';
import { SafeImage } from './SafeImage';

interface DynamicPageProps {
  page?: CustomPage;
  sections?: PageSection[];
}

export const DynamicSectionRenderer: React.FC<{ section: PageSection, index: number }> = ({ section, index }) => {
    const { products } = useSite();

    switch (section.type) {
        case 'hero':
        return (
            <section className="px-6 md:px-12 mb-20 md:mb-32">
                <div className="container mx-auto max-w-5xl">
                    <FadeIn className="text-center mb-12">
                    <span className="text-bronze text-xs md:text-sm font-sans uppercase tracking-[0.4em] block mb-6 opacity-80">
                        {section.subheading}
                    </span>
                    <h1 className="font-serif text-4xl md:text-6xl text-earth leading-tight">
                        {section.heading}
                    </h1>
                    </FadeIn>
                    {section.image && (
                    <FadeIn delay={200} className="relative w-full aspect-[16/9] md:aspect-[21/9] overflow-hidden rounded-sm shadow-sm mx-auto">
                        <img src={section.image} alt={section.heading} className="w-full h-full object-cover" />
                    </FadeIn>
                    )}
                </div>
            </section>
        );
        
        case 'text':
        return (
            <section className="container mx-auto px-6 md:px-12 max-w-3xl mb-24">
                <FadeIn>
                    {section.heading && (
                    <h2 className={`font-serif text-3xl md:text-4xl text-earth mb-8 ${section.layout === 'center' || !section.layout ? 'text-center' : ''}`}>{section.heading}</h2>
                    )}
                    <div className={`font-sans text-earth/80 text-base leading-[2.2] space-y-6 whitespace-pre-line ${section.layout === 'center' || !section.layout ? 'text-center' : ''}`}>
                    {section.content}
                    </div>
                </FadeIn>
            </section>
        );

        case 'image-text':
        return (
            <section className="container mx-auto px-6 md:px-12 max-w-6xl mb-24">
                <FadeIn className={`flex flex-col md:flex-row gap-12 items-center ${index % 2 !== 0 ? 'md:flex-row-reverse' : ''}`}>
                    <div className="flex-1 w-full aspect-[4/5] rounded-sm overflow-hidden">
                    {section.image && <img src={section.image} alt="" className="w-full h-full object-cover" />}
                    </div>
                    <div className="flex-1 space-y-6">
                    <h3 className="font-serif text-3xl text-earth">{section.heading}</h3>
                    <p className="font-sans text-earth/80 leading-loose">{section.content}</p>
                    </div>
                </FadeIn>
            </section>
        );

        case 'manifesto':
        return (
            <section className="container mx-auto px-6 md:px-12 mb-24">
                <FadeIn>
                    <div className="p-10 md:p-14 bg-earth text-cream text-center rounded-sm relative shadow-xl max-w-3xl mx-auto">
                        <div className="absolute top-3 left-3 right-3 bottom-3 border border-white/10"></div>
                        <p className="font-serif text-2xl md:text-3xl italic leading-tight relative z-10">
                        "{section.content}"
                        </p>
                    </div>
                </FadeIn>
            </section>
        );

        case 'full-image':
            return (
                <section className="px-4 md:px-12 mb-24">
                    <FadeIn className="w-full h-[60vh] md:h-[80vh] overflow-hidden rounded-sm relative">
                        {section.image && <img src={section.image} alt="" className="w-full h-full object-cover" />}
                        {(section.heading || section.subheading) && (
                            <div className="absolute inset-0 bg-black/20 flex flex-col items-center justify-center text-center p-8">
                                {section.subheading && <p className="text-white/80 text-xs uppercase tracking-[0.3em] mb-4">{section.subheading}</p>}
                                {section.heading && <h2 className="font-serif text-4xl md:text-7xl text-white drop-shadow-lg">{section.heading}</h2>}
                            </div>
                        )}
                    </FadeIn>
                </section>
            );

        case 'grid':
            return (
                <section className="px-6 md:px-12 mb-24">
                    <div className="container mx-auto">
                        {section.heading && (
                            <FadeIn className="text-center mb-12">
                                <h2 className="font-serif text-3xl md:text-5xl text-earth mb-4">{section.heading}</h2>
                                {section.subheading && <p className="text-xs uppercase tracking-widest text-earth/50">{section.subheading}</p>}
                            </FadeIn>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {section.items?.map((item, i) => (
                                <FadeIn key={i} delay={i * 100} className="group cursor-pointer">
                                    <div 
                                        className="relative aspect-[3/4] overflow-hidden rounded-sm mb-4"
                                        onClick={() => item.link && (window.location.hash = item.link)}
                                    >
                                        <img src={item.image} alt={item.title} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors"></div>
                                        {item.link && (
                                            <div className="absolute top-4 right-4 bg-white/20 backdrop-blur-md p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                                                <ArrowUpRight className="w-4 h-4 text-white" />
                                            </div>
                                        )}
                                    </div>
                                    <div className="text-center">
                                        <h3 className="font-serif text-xl text-earth">{item.title}</h3>
                                        {item.subtitle && <p className="text-[10px] uppercase tracking-widest text-earth/50 mt-1">{item.subtitle}</p>}
                                    </div>
                                </FadeIn>
                            ))}
                        </div>
                    </div>
                </section>
            );

        case 'product-feature': {
            const product = products.find(p => p.id === section.productId);
            if (!product) {
                // Return a placeholder or null, but for admin preview purposes, user might want to see that something is there.
                // For now, returning null is standard, but let's at least log it or check if we should show a placeholder.
                return null;
            }
            return (
                <section className="px-6 md:px-12 mb-24 bg-cream-dark/30 py-20">
                    <div className="container mx-auto flex flex-col md:flex-row items-center gap-12 max-w-6xl">
                        <FadeIn className="flex-1 w-full aspect-square bg-white p-8 md:p-12 relative group">
                            <SafeImage src={product.images[0]} alt={product.name} className="w-full h-full object-contain mix-blend-multiply" />
                            {product.isNew && <span className="absolute top-6 left-6 text-[9px] uppercase tracking-widest bg-earth text-white px-2 py-1">New Arrival</span>}
                        </FadeIn>
                        <FadeIn className="flex-1 space-y-6 md:pl-10 text-center md:text-left">
                            <span className="text-bronze text-xs uppercase tracking-[0.3em]">Featured Product</span>
                            <h2 className="font-serif text-4xl md:text-5xl text-earth leading-tight">{product.name}</h2>
                            <p className="font-sans text-earth/70 leading-loose max-w-md mx-auto md:mx-0">{product.description}</p>
                            <p className="font-serif italic text-2xl text-earth">${product.price}</p>
                            <button onClick={() => window.location.hash = `#shop`} className="inline-flex items-center gap-3 bg-earth text-cream px-8 py-3 text-[10px] uppercase tracking-[0.2em] hover:bg-bronze transition-colors">
                                View In Shop <ArrowRight className="w-3 h-3" />
                            </button>
                        </FadeIn>
                    </div>
                </section>
            );
        }

        default:
        return null;
    }
}

export const DynamicPage: React.FC<DynamicPageProps> = ({ page, sections }) => {
  const contentSections = page ? page.sections : sections || [];

  return (
    <div className="bg-cream min-h-screen w-full overflow-hidden pt-32 pb-32">
       {contentSections.map((section, idx) => (
          <DynamicSectionRenderer key={section.id} section={section} index={idx} />
       ))}
    </div>
  );
};
