type QueryState = { status: 'idle' | 'loading' | 'unavailable' | 'ready'; retry: () => void };

/** Keep subscription failure local so other staff tabs and unsaved drafts remain available. */
export function StaffQueryState({ query }: { query: QueryState }) {
  if (query.status === 'unavailable') {
    return (
      <section aria-label="Staff data unavailable">
        <p role="alert">This information could not be loaded. Your edits are still here.</p>
        <button type="button" className="btn btn-line btn-sm" onClick={query.retry}>
          Try again
        </button>
      </section>
    );
  }
  return (
    <p className="help" role="status">
      Loading staff information…
    </p>
  );
}
