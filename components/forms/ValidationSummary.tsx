import React from 'react';

type Entry = { message?: string; label?: string; fieldId?: string };
export function ValidationSummary({
  entries,
  summaryRef,
}: {
  entries: Entry[];
  summaryRef: React.Ref<HTMLDivElement>;
}) {
  const errors = entries.filter((entry) => Boolean(entry.message));
  if (!errors.length) return null;
  return (
    <div ref={summaryRef} role="alert" tabIndex={-1} className="delivery-error-summary">
      <p>Please check the following details.</p>
      <ul>
        {errors.map((entry, index) => (
          <li key={entry.fieldId ?? index}>
            {entry.fieldId ? (
              <a
                href={`#${entry.fieldId}`}
                onClick={(event) => {
                  event.preventDefault();
                  document.getElementById(entry.fieldId!)?.focus();
                }}
              >
                {entry.label}: {entry.message}
              </a>
            ) : (
              entry.message
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
