import { useState } from 'react';
import { usePaginatedQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import { usePendingTimeout } from '../contexts/usePendingTimeout';
import { ErrorBoundary } from './ErrorBoundary';
import { SafeImage } from './SafeImage';
import { navigatePlainLink } from '../lib/navigation';

type Props = { term: string; onSelect: (id: string) => void };
const Failure = ({ retry }: { retry: () => void }) => (
  <div role="status" className="text-center py-12 text-cream">
    <p>Search is temporarily unavailable. Your search has been kept.</p>
    <button className="min-h-11 mt-4 underline" onClick={retry}>
      Try again
    </button>
  </div>
);

/** Each term owns a reactive cursor subscription; retry remounts only the failed results. */
export function PaginatedSearchResults(props: Props) {
  const [attempt, setAttempt] = useState(0);
  const retry = () => setAttempt((value) => value + 1);
  return (
    <ErrorBoundary key={`${props.term}:${attempt}`} fallback={<Failure retry={retry} />}>
      <SearchPage {...props} retry={retry} />
    </ErrorBoundary>
  );
}

function SearchPage({ term, onSelect, retry }: Props & { retry: () => void }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.publicSearch.search,
    { term },
    { initialNumItems: 20 }
  );
  const pending = status === 'LoadingFirstPage' || status === 'LoadingMore';
  const expired = usePendingTimeout(pending, term);
  if (expired) return <Failure retry={retry} />;
  if (status === 'LoadingFirstPage')
    return (
      <p role="status" className="text-cream py-12 text-center">
        Searching…
      </p>
    );
  return (
    <>
      <p role="status" className="text-muted-cream mb-6">
        {results.length
          ? `${results.length} results shown`
          : status === 'Exhausted'
            ? `No products found for “${term}”`
            : 'No available matches on this page. Load more to continue searching.'}
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
        {results.map((product) => (
          <a
            key={product._id}
            href={product.url}
            onClick={(event) => navigatePlainLink(event, product.url, () => onSelect(product._id))}
            className="block min-w-0 rounded-2xl overflow-hidden border border-white/20 bg-white/5 text-cream hover:bg-white/10"
          >
            <div className="aspect-[3/4] bg-black/20">
              <SafeImage
                src={product.image}
                alt={product.alt}
                fallbackSrc="/images/product-unavailable.svg"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="p-4">
              <h3 className="font-serif text-lg">{product.name}</h3>
              <p className="text-sm text-muted-cream mt-2">{product.category}</p>
              <p className="mt-3">
                {new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: product.currency,
                }).format(product.price)}
              </p>
              <p className="text-xs mt-2">
                {product.availability === 'available'
                  ? 'Available to order'
                  : product.availability === 'preview'
                    ? 'Preview collection'
                    : 'Currently unavailable'}
              </p>
            </div>
          </a>
        ))}
      </div>
      {status !== 'Exhausted' && (
        <button
          className="min-h-11 mt-6 border border-cream px-6 py-3 text-cream"
          disabled={pending}
          onClick={() => loadMore(20)}
        >
          {pending ? 'Loading more…' : 'Load more products'}
        </button>
      )}
    </>
  );
}
