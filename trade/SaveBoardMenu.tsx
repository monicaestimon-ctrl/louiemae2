import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { HolmProduct } from './catalog';
import type { SavedProductIdentity } from './projectIdentity';
import { useSavedBoardShelf } from './useSavedBoardShelf';

export type SaveBoard = {
  id: string;
  title: string;
  secret?: boolean;
  pins: SavedProductIdentity[];
};
export type SaveBoardMenuProps = {
  boards: readonly SaveBoard[];
  catalog: ReadonlyMap<number, HolmProduct>;
  product: HolmProduct;
  onSave: (product: HolmProduct, boardId: string) => void;
  onCreate: (title: string, product: HolmProduct) => string | null;
  onClose: () => void;
  returnFocus?: HTMLElement | null;
  align?: 'left' | 'right';
};

/** Saving uses the selected source and variant, independently of the browse page. */
export function SaveBoardMenu({
  boards,
  catalog,
  product,
  onSave,
  onCreate,
  onClose,
  returnFocus,
  align = 'right',
}: SaveBoardMenuProps) {
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const closing = useRef(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const headingId = useId();
  const nameId = useId();
  const errorId = useId();
  const { productFor } = useSavedBoardShelf(boards, [], catalog);
  const matches = boards.filter((board) => board.title.toLowerCase().includes(query.toLowerCase()));
  useLayoutEffect(() => {
    if (returnFocus) opener.current = returnFocus;
  }, [returnFocus]);

  useLayoutEffect(() => {
    const place = () => {
      const element = panel.current;
      if (!element) return;
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 12;
      const topEdge = (viewport?.offsetTop ?? 0) + 12;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      element.style.maxWidth = `${Math.max(0, width - 24)}px`;
      element.style.minWidth = '0';
      element.style.maxHeight = `${Math.max(0, Math.min(380, height - 24))}px`;
      element.style.left = align === 'left' ? '0px' : 'auto';
      element.style.right = align === 'left' ? 'auto' : '0px';
      element.style.top = align === 'left' ? '52px' : 'calc(100% + 8px)';
      const rect = element.getBoundingClientRect();
      const targetLeft = Math.max(
        leftEdge,
        Math.min(rect.left, leftEdge + width - 24 - rect.width)
      );
      const targetTop = Math.max(topEdge, Math.min(rect.top, topEdge + height - 24 - rect.height));
      element.style.left = `${element.offsetLeft + targetLeft - rect.left}px`;
      element.style.right = 'auto';
      element.style.top = `${element.offsetTop + targetTop - rect.top}px`;
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, { capture: true, passive: true });
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place, { passive: true });
    const observer =
      typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(place) : null;
    if (panel.current) {
      observer?.observe(panel.current);
      if (panel.current.offsetParent instanceof Element)
        observer?.observe(panel.current.offsetParent);
    }
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [align, creating, matches.length, error]);

  useEffect(() => {
    if (!opener.current)
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    search.current?.focus();
  }, []);
  useEffect(() => {
    if (creating) nameInput.current?.focus();
    else search.current?.focus();
  }, [creating]);
  useEffect(() => {
    const outside = (event: Event) => {
      // The owning toggle closes this picker on click. Dismissing during its
      // preceding pointer/focus events would make that click reopen it.
      if (event.target instanceof Node && opener.current?.contains(event.target)) return;
      if (
        !closing.current &&
        event.target instanceof Node &&
        panel.current &&
        !panel.current.contains(event.target)
      ) {
        closing.current = true;
        onClose();
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.isComposing || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.stopPropagation();
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (closing.current) return;
      closing.current = true;
      onClose();
      if (opener.current?.isConnected) opener.current.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    panel.current?.addEventListener('keydown', escape);
    const element = panel.current;
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      element?.removeEventListener('keydown', escape);
    };
  }, [onClose]);

  const finish = () => {
    if (closing.current) return;
    closing.current = true;
    onClose();
    if (opener.current?.isConnected) opener.current.focus();
  };
  return (
    <div
      ref={panel}
      className="pop boardpick"
      role="dialog"
      aria-labelledby={headingId}
      style={{ animation: 'none' }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="row" style={{ padding: '2px 8px 6px', justifyContent: 'space-between' }}>
        <span id={headingId} className="st-h">
          Save to board
        </span>
        <button type="button" className="btn btn-line btn-sm" onClick={finish}>
          Close
        </button>
      </div>
      {creating ? (
        <form
          style={{ display: 'grid', gap: 10, padding: 6 }}
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) {
              setError('Enter a board name.');
              nameInput.current?.focus();
              return;
            }
            const id = onCreate(name.trim(), product);
            if (id) finish();
            else setError('This product needs review before it can be saved.');
          }}
        >
          <label className="lbl" htmlFor={nameId}>
            Board name
          </label>
          <input
            ref={nameInput}
            id={nameId}
            className="field"
            value={name}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setError('');
            }}
            placeholder="e.g. Fernwood Café, patio"
          />
          {error && (
            <p id={errorId} role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button
              type="button"
              className="btn btn-line btn-sm"
              onClick={() => {
                setCreating(false);
                setError('');
              }}
            >
              Back
            </button>
            <button type="submit" className="btn btn-ink btn-sm">
              Create and save
            </button>
          </div>
        </form>
      ) : (
        <>
          <div style={{ padding: '4px 6px 8px' }}>
            <input
              ref={search}
              className="field"
              style={{ height: 38 }}
              placeholder="Search your boards"
              aria-label="Search your boards"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {matches.map((board) => {
            const cover = board.pins[0] ? productFor(board.pins[0]) : null;
            return (
              <button
                type="button"
                key={board.id}
                className="bp"
                onClick={() => {
                  onSave(product, board.id);
                  finish();
                }}
              >
                <span
                  className="th"
                  style={{ backgroundImage: cover ? `url(${cover.img})` : 'none' }}
                />
                <span>
                  <b style={{ fontWeight: 500, fontSize: 14 }}>{board.title}</b>
                  <br />
                  <small className="mute">
                    {board.pins.length} pins{board.secret ? ' · Secret' : ''}
                  </small>
                </span>
                <span className="go btn btn-cog btn-sm">Save</span>
              </button>
            );
          })}
          {!matches.length && (
            <p role="status">
              {query ? 'No boards match your search.' : 'Create a board to save this piece.'}
            </p>
          )}
          <button type="button" className="bp" onClick={() => setCreating(true)}>
            <span
              className="th"
              aria-hidden="true"
              style={{ display: 'grid', placeItems: 'center', background: 'var(--plaster)' }}
            >
              +
            </span>
            <b style={{ fontWeight: 500 }}>Create board</b>
          </button>
        </>
      )}
    </div>
  );
}
