import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Instagram, X } from 'lucide-react';
import { NavLink } from '../types';

interface SiteMenuProps {
  open: boolean;
  links: NavLink[];
  onClose: () => void;
  onNavigate: (href: string) => void;
}

/** Plain-language "see everything here" row for a section, or null when the section
 *  already lists one (e.g. "Shop All Girls") or has no page of its own. */
const overviewRow = (link: NavLink): NavLink | null => {
  if (!link.href || link.href === '#') return null;
  if (link.children?.some(child => child.href === link.href)) return null;
  const label = link.href.startsWith('#collection/') ? `Shop all ${link.label}` : `All of ${link.label}`;
  return { label, href: link.href };
};

/**
 * The storefront's side menu. It shows one level of the navigation at a time:
 * a section with sub-sections opens as its own page with a Back link, instead of
 * unfolding every level of the tree in place.
 */
export const SiteMenu: React.FC<SiteMenuProps> = ({ open, links, onClose, onNavigate }) => {
  // The chain of sections the shopper has stepped into; empty means the top level.
  const [trail, setTrail] = useState<NavLink[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  // Every visit starts at the top level (reset while rendering, so the old level never flashes).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTrail([]);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (trail.length > 0) setTrail(prev => prev.slice(0, -1));
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, trail.length, onClose]);

  // Keep keyboard and screen-reader focus at the top of whichever level is showing.
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>('[data-menu-focus]')?.focus();
  }, [open, trail.length]);

  const current = trail[trail.length - 1];
  const items = current ? current.children ?? [] : links;
  const overview = current ? overviewRow(current) : null;
  const atTop = !current;

  const choose = (link: NavLink) => {
    if (link.children && link.children.length > 0) setTrail(prev => [...prev, link]);
    else onNavigate(link.href);
  };

  return (
    <div
      inert={!open}
      aria-hidden={!open}
      className={`fixed inset-0 z-50 [transition-behavior:allow-discrete] transition-[visibility] duration-300 ${open ? 'visible' : 'invisible [content-visibility:hidden]'}`}
    >
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-earth/30 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0'}`}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Site menu"
        className={`absolute inset-y-0 left-0 w-full max-w-sm flex flex-col bg-cream text-earth shadow-[0_0_40px_rgba(74,59,50,0.15)] transition-transform duration-300 ease-out motion-reduce:transition-none ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center justify-between h-16 px-6 shrink-0">
          {atTop ? (
            <span data-menu-focus tabIndex={-1} className="font-serif text-2xl tracking-tight outline-none">Louie Mae</span>
          ) : (
            <button
              type="button"
              data-menu-focus
              onClick={() => setTrail(prev => prev.slice(0, -1))}
              className="flex items-center gap-1 -ml-1 py-2 text-sm text-earth/60 hover:text-earth transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              {trail.length > 1 ? trail[trail.length - 2].label : 'Menu'}
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close menu" className="p-2 -mr-2 text-earth/60 hover:text-earth transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav aria-label={current ? current.label : 'Main'} className="flex-1 overflow-y-auto no-scrollbar px-6 pb-6">
          {current && <h2 className="font-serif text-3xl pt-2 pb-4">{current.label}</h2>}
          <ul className="divide-y divide-earth/10 border-t border-earth/10">
            {overview && (
              <li>
                <button type="button" onClick={() => onNavigate(overview.href)} className="w-full text-left py-4 text-[15px] text-bronze hover:text-earth transition-colors">
                  {overview.label}
                </button>
              </li>
            )}
            {items.map(link => {
              const hasChildren = Boolean(link.children && link.children.length > 0);
              return (
                <li key={`${link.label}-${link.href}`}>
                  <button
                    type="button"
                    onClick={() => choose(link)}
                    className={`w-full flex items-center justify-between gap-4 text-left py-4 hover:text-bronze transition-colors ${atTop ? 'font-serif text-2xl' : 'text-[15px]'}`}
                  >
                    <span>{link.label}</span>
                    {hasChildren && <ChevronRight className="w-4 h-4 shrink-0 text-earth/35" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {atTop && (
          <div className="flex items-center justify-between px-6 py-5 border-t border-earth/10 text-sm text-earth/55">
            <a href="/trade/" className="hover:text-earth transition-colors">Trade program</a>
            <div className="flex items-center gap-5">
              <a href="https://www.instagram.com/itslouiemae/" target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="hover:text-earth transition-colors">
                <Instagram className="w-4 h-4" />
              </a>
              <button type="button" onClick={() => onNavigate('#admin')} className="hover:text-earth transition-colors">Atelier</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
