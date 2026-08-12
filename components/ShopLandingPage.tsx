
import React from 'react';
import { FadeIn } from './FadeIn';
import { useSite } from '../contexts/BlogContext';
import { ArrowUpRight } from 'lucide-react';

export const ShopLandingPage: React.FC = () => {
   const { siteContent } = useSite();
   const { home } = siteContent;

   const categories = [
      { id: 'furniture', title: 'Furniture', image: home.categoryImages.furniture, link: '#collection/furniture', subtitle: 'Timeless Pieces' },
      { id: 'decor', title: 'Home Decor', image: home.categoryImages.decor, link: '#collection/decor', subtitle: 'Accents & Details' },
      { id: 'fashion', title: 'The Mae Collective', image: home.categoryImages.fashion, link: '#collection/fashion', subtitle: 'Apparel', objectPosition: 'object-top' },
      { id: 'kids', title: 'Louie Kids & Co.', image: home.categoryImages.kids, link: '#collection/kids', subtitle: 'Little Ones' },
      { id: 'journal', title: 'Simply by Mae', image: home.categoryImages.journal, link: '#blog', subtitle: 'Blog' },
   ];

   return (
      <div className="bg-cream min-h-screen pt-32 pb-20">
         {/* Header - Cloned from Home Brand Feature */}
         <section className="px-6 md:px-12 mb-20">
            <div className="container mx-auto flex flex-col items-center">
               <FadeIn className="text-center mb-10">
                  <p className="text-bronze text-xs md:text-sm uppercase tracking-[0.25em] mb-3">Est. 2021</p>
                  <h1 className="font-serif text-6xl md:text-8xl text-earth leading-none">Louie Mae</h1>
               </FadeIn>

               <FadeIn delay={200} className="w-full relative overflow-hidden rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-earth/5">
                  <img
                     src={home.shop?.headerImage || "/images/brand/DINNERTABLE.png"}
                     alt="Louie Mae Signature"
                     fetchPriority="high"
                     decoding="async"
                     className="w-full h-[300px] md:h-[450px] object-cover"
                  />
                  {/* Subtle edge highlight */}
                  <div className="absolute inset-0 border border-white/30 rounded-[2.5rem] pointer-events-none mix-blend-overlay"></div>
               </FadeIn>
            </div>
         </section>

         {/* Categories Grid - Asymmetrical Layout */}
         <section className="px-4 md:px-12">
            <div className="container mx-auto">
               <FadeIn className="text-center mb-16">
                  <h2 className="font-serif text-4xl text-earth mb-4">Explore Collections</h2>
                  <div className="w-24 h-px bg-bronze mx-auto opacity-50"></div>
               </FadeIn>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-6 auto-rows-[minmax(300px,auto)]">
                  {categories.map((cat, idx) => (
                     <FadeIn
                        key={cat.id}
                        delay={idx * 100}
                        className={`group cursor-pointer relative overflow-hidden rounded-[2.5rem] shadow-lg hover:shadow-[0_30px_60px_rgba(0,0,0,0.2)] hover:-translate-y-2 transition-all duration-700 border border-white/20 ${idx === 0 ? 'md:row-span-2 h-[600px] md:h-auto' : 'h-[300px] md:h-[400px]'
                           }`}
                     >
                        <div
                           onClick={() => { window.location.hash = cat.link; window.scrollTo(0, 0); }}
                           className="w-full h-full relative"
                        >
                           <img
                              src={cat.image}
                              alt={cat.title}
                              className={`w-full h-full object-cover transition-transform duration-[1.5s] group-hover:scale-110 ${(cat as any).objectPosition || ''}`}
                           />

                           {/* Inner Glow Highlight */}
                           <div className="absolute inset-0 border-[2px] border-white/0 group-hover:border-white/10 rounded-[2.5rem] transition-colors duration-700 pointer-events-none z-20 mix-blend-overlay"></div>

                           {/* Overlay Gradient (Elevated) */}
                           <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-80 group-hover:opacity-100 transition-opacity duration-700 z-10"></div>

                           {/* Content */}
                           <div className="absolute bottom-0 left-0 right-0 p-8 md:p-10 flex flex-col justify-end items-start transform transition-transform duration-700 group-hover:-translate-y-3 z-30">
                              <span className="text-[10px] uppercase tracking-[0.3em] text-white/80 mb-2 drop-shadow-sm">{cat.subtitle}</span>
                              <div className="flex items-center justify-between w-full">
                                 <h3 className="font-serif text-3xl md:text-5xl text-white leading-none drop-shadow-md">{cat.title}</h3>
                                 <div className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-500 transform translate-x-4 group-hover:translate-x-0 shadow-lg">
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
      </div>
   );
};
