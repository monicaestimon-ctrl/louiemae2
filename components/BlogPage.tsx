
import React, { useState } from 'react';
import { FadeIn } from './FadeIn';
import { useSite } from '../contexts/BlogContext';
import { useNewsletter } from '../contexts/NewsletterContext';
import { ArrowRight, Calendar, Check } from 'lucide-react';

export const BlogPage: React.FC = () => {
   // Use the hook to get dynamic posts
   const { posts } = useSite();
   const { addSubscriber } = useNewsletter();

   // Newsletter Form State
   const [email, setEmail] = useState('');
   const [subscribeError, setSubscribeError] = useState('');
   const [subStatus, setSubStatus] = useState<'idle' | 'loading' | 'success'>('idle');

   // Filter only published posts for the public view
   const publishedPosts = posts.filter(post => post.status === 'published' || !post.status);

   const featuredPost = publishedPosts[0];
   const recentPosts = publishedPosts.slice(1);

   const handleSubscribe = async () => {
      if (!email) return;
      setSubStatus('loading');
      setSubscribeError('');
      try {
        const success = await addSubscriber(email.trim());
        if (success) {
           setSubStatus('success');
           setEmail('');
        } else {
           setSubStatus('idle');
           setSubscribeError('You are already on the list.');
        }
      } catch {
         setSubStatus('idle');
         setSubscribeError('We could not save your signup. Please try again.');
      }
   };

   if (!featuredPost) {
      return (
         <div className="min-h-screen bg-cream flex items-center justify-center">
            <FadeIn>
               <h1 className="font-serif text-4xl text-earth opacity-50">Coming Soon...</h1>
            </FadeIn>
         </div>
      );
   }

   return (
      <div className="bg-cream min-h-screen pt-32 pb-20 w-full overflow-hidden">
         {/* Header */}
         <section className="px-6 md:px-12 mb-20 text-center relative">
            <div aria-hidden="true" className="mx-auto mb-6 h-10 w-px bg-gradient-to-b from-transparent to-bronze/40" />
            <FadeIn>
               <span className="text-bronze text-xs tracking-[0.4em] uppercase mb-4 block font-sans">Blog</span>
               <h1 className="font-serif text-5xl sm:text-6xl md:text-8xl text-earth mb-6 leading-tight tracking-tight">Simply Mae</h1>
               <div className="flex items-center justify-center gap-4 mb-6">
                  <div className="h-px w-8 bg-earth/20"></div>
                  <p className="font-serif text-earth/70 text-xl italic">Curated Reflections</p>
                  <div className="h-px w-8 bg-earth/20"></div>
               </div>
               <p className="font-sans text-earth/60 max-w-lg mx-auto leading-relaxed text-sm tracking-wide">
                  On faith, family, design, and finding beauty in the everyday rhythms of life.
               </p>
            </FadeIn>
         </section>

         {/* Featured Post */}
         <section className="px-6 md:px-12 mb-28">
            <div className="container mx-auto">
               <FadeIn delay={200} className="group cursor-pointer relative">
                  <div onClick={() => { window.location.hash = `#blog/${featuredPost.id}`; window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                     <div className="relative aspect-[4/5] md:aspect-[21/9] overflow-hidden rounded-sm mb-10 shadow-sm">
                        <div className="absolute inset-0 bg-black/10 group-hover:bg-black/5 transition-colors z-10"></div>
                        <img
                           src={featuredPost.image}
                           alt={featuredPost.title}
                           className="w-full h-full object-cover transition-transform duration-[1.5s] ease-out group-hover:scale-105"
                        />
                        <div className="absolute top-6 left-6 md:top-10 md:left-10 z-20">
                           <div className="bg-white/95 backdrop-blur-md px-5 py-3 shadow-sm border border-white/50">
                              <span className="text-earth text-[10px] uppercase tracking-[0.25em]">Featured Story</span>
                           </div>
                        </div>
                     </div>

                     <div className="text-center max-w-4xl mx-auto px-4">
                        <div className="flex items-center justify-center gap-4 mb-4 text-bronze/80 text-[10px] uppercase tracking-widest font-sans">
                           <span>{featuredPost.category}</span>
                           <span className="w-1 h-1 rounded-full bg-bronze/40"></span>
                           <span>{featuredPost.date}</span>
                        </div>
                        <h2 className="font-serif text-4xl md:text-6xl text-earth mb-6 group-hover:text-bronze transition-colors duration-300 leading-tight">
                           {featuredPost.title}
                        </h2>
                        <p className="font-sans text-earth/70 leading-loose mb-8 text-sm md:text-base max-w-2xl mx-auto">
                           {featuredPost.excerpt}
                        </p>
                        <button
                           onClick={() => { window.location.hash = `#blog/${featuredPost.id}`; window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                           className="inline-flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-earth border-b border-earth/20 pb-2 hover:text-bronze hover:border-bronze hover:gap-4 transition-all duration-300"
                        >
                           Read The Story <ArrowRight className="w-3 h-3" />
                        </button>
                     </div>
                  </div>
               </FadeIn>
            </div>
         </section>

         {/* Recent Posts Grid */}
         <section className="px-6 md:px-12 pb-24">
            <div className="container mx-auto">
               <FadeIn className="mb-12 flex items-baseline justify-between border-b border-earth/10 pb-4">
                  <h3 className="font-serif text-3xl text-earth">Blog</h3>
                  <span className="text-[10px] uppercase tracking-widest text-earth/50 hidden md:inline-block">Archive</span>
               </FadeIn>

               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-16">
                  {recentPosts.map((post, idx) => (
                     <FadeIn key={post.id} delay={300 + idx * 100} className="group cursor-pointer flex flex-col h-full">
                        <div className="flex flex-col h-full" onClick={() => { window.location.hash = `#blog/${post.id}`; window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                           <div className="aspect-[3/4] overflow-hidden rounded-sm mb-6 relative shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
                              <img
                                 src={post.image}
                                 alt={post.title}
                                 className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                              />
                              <div className="absolute top-4 left-4 bg-cream/95 backdrop-blur-sm px-3 py-1.5 text-[9px] uppercase tracking-widest text-earth shadow-sm">
                                 {post.category}
                              </div>
                           </div>

                           <div className="flex flex-col flex-1 items-start pr-4">
                              <div className="flex items-center gap-2 mb-3 text-[9px] uppercase tracking-widest text-earth/40">
                                 <Calendar className="w-3 h-3" />
                                 <span>{post.date}</span>
                              </div>
                              <h3 className="font-serif text-2xl md:text-3xl text-earth mb-4 leading-tight group-hover:text-bronze transition-colors duration-300">
                                 {post.title}
                              </h3>
                              <p className="font-sans text-earth/60 text-sm leading-relaxed mb-6 line-clamp-3">
                                 {post.excerpt}
                              </p>
                              <div className="mt-auto pt-4 w-full border-t border-earth/5 flex justify-between items-center opacity-60 group-hover:opacity-100 transition-opacity duration-300">
                                 <span className="text-[9px] uppercase tracking-widest text-earth">Read Article</span>
                                 <ArrowRight className="w-3 h-3 text-bronze -translate-x-2 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all duration-300" />
                              </div>
                           </div>
                        </div>
                     </FadeIn>
                  ))}
               </div>
            </div>
         </section>

         {/* Newsletter / Quote */}
         <section className="px-6 md:px-12 py-24 bg-white/50 border-t border-earth/5">
            <FadeIn className="text-center max-w-3xl mx-auto">
               <div className="mb-8 opacity-20">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" className="mx-auto text-earth">
                     <path d="M14.017 21L14.017 18C14.017 16.8954 13.1216 16 12.017 16H9.01699V12.999L12.017 13V10.999L9.01699 11V8L11.017 8V6H5.01699V21H14.017ZM21.017 21V6H15.017V21H21.017ZM9.01699 6H7.01699V8H9.01699V6Z" />
                  </svg>
               </div>
               <h3 className="font-serif text-3xl md:text-5xl text-earth italic mb-8 leading-tight">
                  "Simplicity is the ultimate sophistication."
               </h3>
               <p className="font-sans text-xs uppercase tracking-[0.25em] text-earth/40 mb-10">— Leonardo da Vinci</p>

               <form onSubmit={(event) => { event.preventDefault(); void handleSubscribe(); }} className="flex flex-col md:flex-row items-center justify-center gap-4 max-w-md mx-auto">
                  <input
                     type="email"
                     value={email}
                     onChange={(e) => setEmail(e.target.value)}
                     placeholder="Your email address" required aria-label="Email address" autoComplete="email"
                     className="w-full bg-transparent border-b border-earth/20 py-2 text-center md:text-left text-earth placeholder:text-earth/30 focus:outline-none focus:border-bronze transition-colors font-sans"
                  />
                  <button
                     type="submit"
                     disabled={subStatus === 'loading' || subStatus === 'success'}
                     className="whitespace-nowrap bg-earth text-cream px-8 py-3 min-h-11 text-[10px] uppercase tracking-[0.2em] hover:bg-bronze transition-colors flex items-center gap-2 justify-center min-w-[120px]"
                  >
                     {subStatus === 'loading' ? '...' : subStatus === 'success' ? <><Check className="w-4 h-4" /> Subscribed</> : 'Subscribe'}
                  </button>
               </form>
               {subscribeError && <p role="status" className="mt-4 text-sm text-earth">{subscribeError}</p>}
            </FadeIn>
         </section>
      </div>
   );
};
