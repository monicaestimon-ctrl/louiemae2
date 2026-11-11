import React, { useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { CollectionConfig } from '../types';
import { usePendingTimeout } from '../contexts/usePendingTimeout';
import { useStoreCatalog } from './useStoreCatalog';
import { SectionBoundary, SectionUnavailable } from './SectionBoundary';
import { FadeIn } from './FadeIn';
import { SafeImage } from './SafeImage';

type Props = { config: CollectionConfig; onOpen: (id: string) => void };

/** Keep recommendation requests and their failures below the persistent homepage content. */
export function HomeRecommendations(props: Props) {
  const [attempt, setAttempt] = useState(0);
  return <div className="min-h-[26rem]"><SectionBoundary key={attempt} label="Recommendations"><RecommendationResults {...props} retry={() => setAttempt(value => value + 1)} /></SectionBoundary></div>;
}

/** Only expose catalog readiness after verified nonempty products have loaded. */
function RecommendationResults({ config, onOpen, retry }: Props & { retry: () => void }) {
  const readiness = useQuery(api.catalogReadiness.status, {});
  const recommendations = useStoreCatalog(config, 'All', readiness?.ready === true, 'featured', 6);
  const pending = readiness === undefined || recommendations.loading;
  const timedOut = usePendingTimeout(pending);
  if (timedOut || recommendations.unavailable || (readiness !== undefined && !readiness.ready)) return <SectionUnavailable label="Products" retry={retry} />;
  return <>
          {pending && <p role="status" className="text-center text-earth/80 mb-6">Loading recommendations…</p>}
          {recommendations.complete && recommendations.products.length === 0 && <p className="text-center text-earth/80 mb-6">New pieces are coming soon.</p>}
          <div data-catalog-ready={readiness?.ready === true && !recommendations.loading && recommendations.products.length > 0 ? 'true' : 'false'} className="grid grid-cols-2 lg:grid-cols-3 gap-4 md:gap-8">
            {recommendations.products.map((product, idx) => (
              <FadeIn key={product.id} delay={idx * 100} className="group cursor-pointer">
                <button type="button" aria-label={`Quick view ${product.name}`}
                  className="block w-full relative aspect-square overflow-hidden bg-white mb-4 rounded-2xl shadow-sm hover:shadow-[0_20px_40px_rgba(0,0,0,0.1)] hover:-translate-y-1 transition-all duration-500 border border-earth/5"
                  onClick={() => onOpen(product.id)}
                >
                  {product.isNew && (
                    <span className="absolute top-3 left-3 bg-white/90 backdrop-blur-md px-2 py-1 text-[9px] uppercase tracking-widest text-earth z-10 rounded-sm shadow-sm border border-white/50">
                      New
                    </span>
                  )}
                  <SafeImage
                    src={product.images[0]}
                    alt={product.name}
                    className="w-full h-full object-contain"
                  />

                  {/* Quick View Overlay (Glass) */}
                  <span className="absolute bottom-0 left-0 right-0 p-4 translate-y-0 md:translate-y-full md:group-hover:translate-y-0 group-focus-within:translate-y-0 transition-transform duration-500">
                    <span className="block w-full bg-white/80 backdrop-blur-md text-earth border border-white/50 py-3 rounded-lg text-[10px] uppercase tracking-[0.2em] shadow-[0_10px_20px_rgba(0,0,0,0.1)] hover:bg-earth hover:text-white transition-colors duration-300">
                      Quick View
                    </span>
                  </span>
                </button>
                <div className="px-1">
                  <h3 className="font-serif text-lg md:text-xl text-earth leading-tight mb-1 group-hover:text-bronze transition-colors">
                    <button type="button" onClick={() => onOpen(product.id)}>{product.name}</button>
                  </h3>
                  {!product.inStock && <p className="text-xs uppercase tracking-widest text-bronze">Coming Soon</p>}<p className="font-serif italic text-earth/80 text-base group-hover:text-bronze/80 transition-colors">${product.price}</p>
                </div>
              </FadeIn>
            ))}
          </div>
  </>;
}
