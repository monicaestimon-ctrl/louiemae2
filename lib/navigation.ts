import type { MouseEvent } from 'react';

/** Keep native modified-click/new-tab behavior while using the client route handler. */
export function navigatePlainLink(
  event: MouseEvent<HTMLAnchorElement>,
  href: string,
  navigate: (href: string) => void
) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.currentTarget.target === '_blank' ||
    event.currentTarget.hasAttribute('download')
  )
    return;
  event.preventDefault();
  navigate(href);
}
