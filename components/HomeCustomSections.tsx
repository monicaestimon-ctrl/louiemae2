import React, { lazy, Suspense } from 'react';
import type { PageSection } from '../types';
import { ErrorBoundary } from './ErrorBoundary';
import { loadModule } from '../lib/moduleRecovery';
const Renderer = lazy(() =>
  loadModule(() =>
    import('./DynamicPage').then((module) => ({ default: module.DynamicSectionRenderer }))
  )
);
/** Download the custom-page renderer only when this homepage actually has custom sections. */
export function HomeCustomSections({ sections }: { sections?: PageSection[] }) {
  if (!sections?.length) return null;
  return (
    <ErrorBoundary
      fallback={
        <section role="alert" className="px-6 py-8 text-earth">
          <p>Additional homepage content could not be loaded.</p>
          <button
            type="button"
            className="min-h-11 underline"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </section>
      }
    >
      <Suspense
        fallback={
          <p role="status" className="px-6 py-8 text-earth">
            Loading additional homepage content…
          </p>
        }
      >
        <div className="pb-24">
          {sections.map((section, index) => (
            <Renderer key={section.id} section={section} index={index} />
          ))}
        </div>
      </Suspense>
    </ErrorBoundary>
  );
}
