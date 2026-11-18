import { useId, useState, type ReactNode } from 'react';
import { SafeImage } from '../components/SafeImage';
import type { HolmProduct } from './catalog';
import { sameProjectSelection, type SavedProductIdentity } from './projectIdentity';
import type { SaveBoard } from './SaveBoardMenu';
import { formatHolmPrice } from './formatHolmPrice';

type Props = {
  product: HolmProduct;
  boards: readonly SaveBoard[];
  mode: 'retail' | 'trade';
  available: boolean;
  pinterestUrl: string;
  icons: { down: ReactNode; pinterest: ReactNode; studio: ReactNode; add: ReactNode };
  onOpen: (identity: SavedProductIdentity) => void;
  onSave: (product: HolmProduct, boardId: string) => void;
  onStudio: (identity: SavedProductIdentity) => void;
  onAdd: (product: HolmProduct, image: HTMLImageElement | null) => void;
  renderSaveMenu: (close: () => void, trigger: HTMLButtonElement) => ReactNode;
};

/** Catalog controls retain source and variant identity across independently loaded pages. */
export function CatalogProductCard({
  product: p,
  boards,
  mode,
  available,
  pinterestUrl,
  icons,
  onOpen,
  onSave,
  onStudio,
  onAdd,
  renderSaveMenu,
}: Props) {
  const [menu, setMenu] = useState<HTMLButtonElement | null>(null);
  const menuId = useId();
  const identity = { pid: p.id, lid: p.lid, vid: p.vid };
  const saved = boards.some((board) =>
    board.pins.some((pin) => sameProjectSelection(pin, identity))
  );
  const lastBoard = boards[0];
  // A withdrawn source must not reopen a stale picker when it becomes available again.
  if (!available && menu) setMenu(null);
  if (!available)
    return (
      <div className="pin">
        <div className="pin-img">
          <SafeImage src={p.img} alt="Unavailable saved product" style={{ aspectRatio: 1 }} />
        </div>
        <div className="pin-meta">
          <b>{p.name}</b>
          <p>{p.line}. Use Organize to remove this saved item.</p>
        </div>
      </div>
    );
  return (
    <div className="pin">
      <div className="pin-img">
        <button
          type="button"
          className="pin-open"
          aria-label={`View ${p.name} ${p.line}`}
          onClick={() => onOpen(identity)}
        >
          <SafeImage
            src={p.img}
            media={p.imageMedia}
            sizes="(min-width: 1024px) 25vw, 50vw"
            alt={`${p.name} ${p.line}`}
            loading="lazy"
            style={{ aspectRatio: p.ar }}
          />
        </button>
        {p.oos && <span className="oos">Restock on request</span>}
        <div className="pin-ov">
          <div className="r1" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="pin-board"
              onClick={(event) => setMenu(menu ? null : event.currentTarget)}
              aria-label={`Choose board for ${p.name}`}
              aria-haspopup="dialog"
              aria-expanded={Boolean(menu)}
              aria-controls={menu ? menuId : undefined}
            >
              <span>{lastBoard?.title || 'Boards'}</span>
              {icons.down}
            </button>
            <button
              type="button"
              className={`pin-save${saved ? ' saved' : ''}`}
              aria-label={`${saved ? 'Saved ' : 'Save '}${p.name} to board`}
              onClick={(event) =>
                saved || !lastBoard ? setMenu(event.currentTarget) : onSave(p, lastBoard.id)
              }
            >
              {saved ? 'Saved' : 'Save'}
            </button>
          </div>
          <div className="r2" onClick={(event) => event.stopPropagation()}>
            <span className="pin-board" style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>
              {formatHolmPrice(mode === 'trade' ? (p.trade ?? p.price) : p.price)}
            </span>
            <span className="row" style={{ gap: 6 }}>
              <a
                className="pin-act"
                title="Save to Pinterest"
                aria-label={`Save ${p.name} to Pinterest`}
                href={pinterestUrl}
                target="_blank"
                rel="noopener"
              >
                {icons.pinterest}
              </a>
              <button
                type="button"
                className="pin-act"
                title="Place in Studio"
                aria-label={`Place ${p.name} in Studio`}
                onClick={() => onStudio(identity)}
              >
                {icons.studio}
              </button>
              <button
                type="button"
                className="pin-act"
                title="Add to project tray"
                aria-label={`Add ${p.name} to project tray`}
                onClick={(event) =>
                  onAdd(p, event.currentTarget.closest('.pin')?.querySelector('img') ?? null)
                }
              >
                {icons.add}
              </button>
            </span>
          </div>
        </div>
      </div>
      {menu && <div id={menuId}>{renderSaveMenu(() => setMenu(null), menu)}</div>}
      <div className="pin-meta">
        <b>
          {p.name}{' '}
          <span className="mute" style={{ fontWeight: 400 }}>
            {p.line}
          </span>
        </b>
      </div>
    </div>
  );
}
