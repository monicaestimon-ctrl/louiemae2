import { useCallback, useEffect, useRef, useState } from 'react';

/** Focus validation feedback only after a failed submit, never after routine edits/results. */
export function useFormValidation<Field extends string>() {
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [failure, setFailure] = useState(0);
  const summaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (failure) summaryRef.current?.focus();
  }, [failure]);
  const report = useCallback((next: Partial<Record<Field, string>>) => {
    setErrors(next);
    if (Object.keys(next).length) setFailure((value) => value + 1);
  }, []);
  const clear = useCallback(
    (field: Field) =>
      setErrors((current) => {
        if (!current[field]) return current;
        const next = { ...current };
        delete next[field];
        return next;
      }),
    []
  );
  const reset = useCallback(() => setErrors({}), []);
  return { errors, summaryRef, report, clear, reset };
}
