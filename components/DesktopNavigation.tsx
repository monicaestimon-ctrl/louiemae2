import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { NavLink } from '../types';
import { navigatePlainLink } from '../lib/navigation';

type Props = { links: NavLink[]; scrolled: boolean; onNavigate: (href: string) => void };

function DestinationList({
  links,
  onNavigate,
  depth = 0,
}: {
  links: NavLink[];
  onNavigate: (href: string) => void;
  depth?: number;
}) {
  return (
    <ul className={depth ? 'ml-3 border-l border-white/20 pl-2' : 'space-y-1'}>
      {links.map((link) => (
        <li key={`${link.href}:${link.label}`}>
          <a
            href={link.href}
            onClick={(event) => navigatePlainLink(event, link.href, onNavigate)}
            className={`block min-h-11 rounded-lg px-3 py-3 text-left uppercase tracking-wider hover:bg-white/10 hover:text-white ${depth ? 'text-xs text-muted-cream' : 'text-sm text-cream'}`}
          >
            {link.label}
          </a>
          {link.children?.length ? (
            <DestinationList links={link.children} onNavigate={onNavigate} depth={depth + 1} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Ordinary navigation links with separate, keyboard-operable disclosure buttons. */
export function DesktopNavigation({ links, scrolled, onNavigate }: Props) {
  const id = useId();
  const nav = useRef<HTMLElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !nav.current?.contains(event.target)) setOpen(null);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const navigate = (href: string) => {
    setOpen(null);
    onNavigate(href);
  };
  const items = (entries: NavLink[], offset: number) => (
    <ul className="flex items-center gap-4">
      {entries.map((link, index) => {
        const key = `${id}-${index + offset}`;
        const expanded = open === key;
        const children = Boolean(link.children?.length);
        return (
          <li key={`${link.href}:${link.label}`} className="relative">
            <div className="flex items-center">
              <a
                href={link.href}
                onClick={(event) => navigatePlainLink(event, link.href, navigate)}
                className="flex min-h-11 items-center whitespace-nowrap py-2 text-[0.65rem] font-medium uppercase tracking-[0.15em] text-earth hover:underline"
              >
                {link.label}
              </a>
              {children && (
                <button
                  id={`${key}-toggle`}
                  type="button"
                  aria-label={`${link.label} sections`}
                  aria-expanded={expanded}
                  aria-controls={`${key}-links`}
                  onClick={() => setOpen(expanded ? null : key)}
                  className="flex min-h-11 min-w-8 items-center justify-center text-earth hover:bg-earth/5"
                >
                  <ChevronDown
                    aria-hidden="true"
                    className={`h-3 w-3 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`}
                  />
                </button>
              )}
            </div>
            {children && (
              <div
                id={`${key}-links`}
                hidden={!expanded}
                className="absolute left-1/2 top-full z-50 w-max min-w-[240px] max-w-[min(90vw,420px)] -translate-x-1/2 pt-2"
              >
                {expanded && (
                  <div className="max-h-[75vh] overflow-y-auto rounded-2xl border border-white/20 bg-[#2d1f12] p-4 text-cream shadow-2xl">
                    <DestinationList links={link.children!} onNavigate={navigate} />
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
  return (
    <nav
      ref={nav}
      aria-label="Main"
      className="flex items-center gap-6"
      onBlur={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          document.getElementById(`${open}-toggle`)?.focus();
          setOpen(null);
        }
      }}
    >
      {items(links.slice(0, 3), 0)}
      <div className="px-4 text-center text-earth">
        {!scrolled && (
          <span className="mb-1 block text-[0.55rem] uppercase tracking-[0.3em] text-muted-earth">
            Est. 2021
          </span>
        )}
        <a
          href="#"
          aria-label="Louie Mae home"
          onClick={(event) => navigatePlainLink(event, '#', navigate)}
          className={`block whitespace-nowrap font-serif tracking-tight ${scrolled ? 'text-2xl' : 'text-3xl xl:text-4xl'}`}
        >
          Louie Mae
        </a>
      </div>
      {items(links.slice(3), 3)}
    </nav>
  );
}
