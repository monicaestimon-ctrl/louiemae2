import { useId, useState } from 'react';

type Props = { label: string; value: number; min: number; max: number; step?: number; disabled?: boolean; onCommit: (value: number) => void };

/** Keep an incomplete typed number local; commit only a finite, bounded value on blur/Enter. */
export function EditorNumberField({ label, value, min, max, step = .5, disabled = false, onCommit }: Props) {
  const errorId = useId();
  const [invalid, setInvalid] = useState<{ value: number; message: string } | null>(null);
  const error = invalid?.value === value ? invalid.message : '';
  const setError = (message: string) => setInvalid(message ? { value, message } : null);
  const commit = (input: HTMLInputElement) => {
    if (disabled) return;
    const next = input.value.trim() ? Number(input.value) : NaN;
    if (!Number.isFinite(next) || next < min || next > max) {
      setError(`Enter a number from ${min} to ${max}.`);
      return;
    }
    setError('');
    if (next !== value) onCommit(next);
  };
  return <label className="sx-number">
    <span className="sx-lbl">{label}</span>
    <input key={value} className="field num" type="number" defaultValue={value} min={min} max={max} step={step}
      disabled={disabled} aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
      onInput={() => setError('')} onBlur={event => commit(event.currentTarget)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); event.currentTarget.value = String(value); setError(''); event.currentTarget.blur(); }
      }} />
    {error && <span id={errorId} className="sx-note" role="alert">{error}</span>}
  </label>;
}
