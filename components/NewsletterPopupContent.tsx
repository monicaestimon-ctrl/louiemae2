import React from 'react';
import { Mail, Check } from 'lucide-react';
import { responsiveImage } from '../lib/responsiveImage';
type Props = {
  handleDismiss: () => void;
  email: string;
  status: 'idle' | 'loading' | 'success';
  error: string;
  setEmail: (email: string) => void;
  handleSubmit: (event: React.FormEvent) => void;
};
export default function NewsletterPopupContent({
  email,
  status,
  error,
  setEmail,
  handleSubmit,
  handleDismiss,
}: Props) {
  return (
    <>
      <div className="relative w-full max-w-3xl h-auto md:min-h-[520px] rounded-3xl shadow-[0_40px_100px_rgba(139,90,43,0.35),inset_0_1px_0_rgba(255,255,255,0.15)] flex flex-col md:flex-row overflow-hidden border border-bronze/30 bg-gradient-to-br from-[#3a2a1a]/95 via-[#2d1f12]/90 to-[#1a130a]/95 backdrop-blur-3xl">
        {/* Image Side */}
        <div className="w-full md:w-1/2 h-44 sm:h-56 md:h-auto shrink-0 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent z-10"></div>
          <img
            {...responsiveImage(
              '/images/brand/mae-collective-home.png',
              '(min-width: 768px) 384px, 100vw'
            )}
            decoding="async"
            alt="LouieMae — Curated living, designed with intention"
            className="absolute inset-0 w-full h-full object-cover object-[50%_18%] md:object-center"
          />
          <div className="absolute bottom-4 left-5 right-5 z-20 text-cream">
            <p className="font-serif italic text-xl md:text-2xl drop-shadow-lg">
              "Where home meets heritage."
            </p>
          </div>
        </div>

        {/* Form Side */}
        <div className="w-full md:w-1/2 p-6 sm:p-8 md:p-10 flex flex-col justify-center text-center md:text-left relative">
          {status === 'success' ? (
            <div className="flex flex-col items-center justify-center h-full animate-fade-in-up">
              <div className="w-16 h-16 rounded-full bg-bronze/20 border border-bronze/30 text-amber-400 flex items-center justify-center mb-6 shadow-[0_0_20px_rgba(193,154,107,0.3)]">
                <Check className="w-8 h-8" />
              </div>
              <h3 className="font-serif text-3xl text-cream mb-2">You're In.</h3>
              <p className="font-sans text-cream/80 text-sm">
                Welcome to the collective — check your inbox for something special.
              </p>
            </div>
          ) : (
            <>
              <span className="text-[#D6B99C] text-[10px] uppercase tracking-[0.3em] mb-4 block drop-shadow-[0_0_5px_rgba(193,154,107,0.3)]">
                The Mae Letter
              </span>
              <h2 className="font-serif text-3xl sm:text-4xl md:text-5xl text-cream mb-4 leading-tight">
                Be First to Know
              </h2>
              <p className="font-sans text-cream/80 text-sm leading-relaxed mb-5">
                New drops, restocks, and behind-the-scenes stories — delivered before anyone else
                sees them. No spam, just thoughtfully curated finds for your home and closet.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cream/60" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Your email address"
                    aria-label="Email address"
                    autoComplete="email"
                    className="w-full bg-black/40 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-cream placeholder-readable-light focus:outline-none focus:border-bronze/50 focus:ring-1 focus:ring-bronze/20 transition-all font-sans"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="w-full bg-gradient-to-r from-[#3a2a1a] to-[#2d1f12] text-cream border border-bronze/30 rounded-xl px-8 py-4 text-[10px] uppercase tracking-[0.2em] hover:shadow-[0_8px_25px_rgba(139,90,43,0.35)] hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2 shadow-[0_4px_15px_rgba(0,0,0,0.3)] relative overflow-hidden group"
                >
                  <span className="absolute inset-0 bg-gradient-to-r from-bronze/0 via-bronze/20 to-bronze/0 transform -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></span>
                  <span className="relative z-10">
                    {status === 'loading' ? 'Joining...' : 'Join the List'}
                  </span>
                </button>
                {error && (
                  <p role="alert" className="text-sm text-cream">
                    {error}
                  </p>
                )}
              </form>
              <p className="text-[11px] leading-relaxed text-cream/70 mt-5 text-center md:text-left">
                By signing up, you agree to our{' '}
                <a
                  href="#support/privacy"
                  onClick={handleDismiss}
                  className="underline underline-offset-2 hover:text-cream"
                >
                  Privacy Policy
                </a>
                . Unsubscribe anytime.
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
