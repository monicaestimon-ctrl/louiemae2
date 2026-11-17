import { useLayoutEffect, useState } from 'react';
export function useInitialJournalDocument(activePage: string) {
  const [present, setPresent] = useState(() =>
    Boolean(document.getElementById('lm-journal-document'))
  );
  useLayoutEffect(() => {
    const id =
      activePage === 'blog'
        ? 'index'
        : activePage.startsWith('#blog/')
          ? activePage.slice(6)
          : null;
    for (const name of ['lm-journal-document', 'lm-journal-structured-data']) {
      const element = document.getElementById(name);
      if (element && element.dataset.postId !== id) element.remove();
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPresent(Boolean(document.getElementById('lm-journal-document')));
  }, [activePage]);
  return present;
}
