import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/** Debounce ordinary edits but flush the last committed draft before leaving the editor. */
export function usePlannerPersistence<T extends { wallImg?: string | null }>(doc: T, save: (doc: T) => void) {
  const latest = useRef(doc);
  useLayoutEffect(() => { latest.current = doc; }, [doc]);
  const persist = useCallback((value: T) => save({ ...value, wallImg: value.wallImg?.startsWith('data:') ? null : value.wallImg }), [save]);
  useEffect(() => {
    const timer = setTimeout(() => persist(doc), 400);
    return () => clearTimeout(timer);
  }, [doc, persist]);
  useEffect(() => () => persist(latest.current), [persist]);
}
