
import { JournalIndexLead, JournalArchive, JournalEmptyContent } from './JournalLead';
import React, { useState } from 'react';
import { FadeIn } from './FadeIn';
import { useSite } from '../contexts/BlogContext';
import { useNewsletter } from '../contexts/NewsletterContext';
import { Check } from 'lucide-react';
import { journalUrl } from '../lib/journalUrl';
import { navigatePlainLink } from '../lib/navigation';
import { navigateStorefront } from '../lib/storefrontNavigation';
import { useJournalMetadata } from './useJournalMetadata';

export const BlogPage: React.FC = () => {
   // Use the hook to get dynamic posts
   const { posts, editorialStatus } = useSite();
   const { addSubscriber } = useNewsletter();
   useJournalMetadata('index', editorialStatus === 'loading', editorialStatus === 'unavailable', undefined, posts.find(post => post.status === 'published' || !post.status)?.image);

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
         <main className="min-h-screen bg-cream flex items-center justify-center" data-lm-journal-ready={editorialStatus === 'empty' ? 'index' : undefined}>
            <JournalEmptyContent message={editorialStatus === 'loading' ? 'Loading stories…' : editorialStatus === 'unavailable' ? 'Stories are temporarily unavailable. Please try again later.' : 'New stories are coming soon.'} />
         </main>
      );
   }

   return (
      <main className="bg-cream min-h-screen pt-32 pb-20 w-full overflow-hidden" data-lm-journal-ready={editorialStatus === 'ready' || editorialStatus === 'empty' ? 'index' : undefined}>
         <JournalIndexLead featuredPost={featuredPost} onNavigate={event => navigatePlainLink(event, journalUrl(featuredPost.id), navigateStorefront)} />

         <JournalArchive recentPosts={recentPosts} onNavigate={event => navigatePlainLink(event, event.currentTarget.getAttribute('href') || '/blog', navigateStorefront)} />

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
               <p className="font-sans text-xs uppercase tracking-[0.25em] text-muted-earth mb-10">— Leonardo da Vinci</p>

               <form onSubmit={(event) => { event.preventDefault(); void handleSubscribe(); }} className="flex flex-col md:flex-row items-center justify-center gap-4 max-w-md mx-auto">
                  <input
                     type="email"
                     value={email}
                     onChange={(e) => setEmail(e.target.value)}
                     placeholder="Your email address" required aria-label="Email address" autoComplete="email"
                     className="w-full bg-transparent border-b border-earth/20 py-2 text-center md:text-left text-earth placeholder:text-muted-earth focus:outline-none focus:border-bronze transition-colors font-sans"
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
      </main>
   );
};
