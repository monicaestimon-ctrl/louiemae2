/* global PerformanceObserver */
/** Let meaningful server content paint before competing application work starts.
 * Every visitor follows the same rule; interaction and unavailable paint APIs start immediately.
 */
export function startAfterVisibleContent(start: () => void, timeoutMs = 1500): () => void {
  const content = document.querySelector(
    '#lm-shell, #holm-shell, #lm-product-document, #lm-collection-document, #lm-page-document, #lm-journal-document'
  );
  if (
    !content ||
    document.visibilityState !== 'visible' ||
    typeof window.PerformanceObserver !== 'function' ||
    !window.PerformanceObserver.supportedEntryTypes?.includes('paint')
  ) {
    start();
    return () => {};
  }
  let stopped = false;
  let observer: PerformanceObserver | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const events = ['pointerdown', 'keydown', 'click', 'hashchange', 'popstate'] as const;
  const clean = () => {
    observer?.disconnect();
    if (timer !== undefined) clearTimeout(timer);
    for (const event of events) window.removeEventListener(event, run, true);
    document.removeEventListener('visibilitychange', visibility);
  };
  const run = () => {
    if (stopped) return;
    stopped = true;
    clean();
    start();
  };
  const visibility = () => {
    if (document.visibilityState !== 'visible') run();
  };
  for (const event of events) window.addEventListener(event, run, { capture: true, passive: true });
  document.addEventListener('visibilitychange', visibility);
  try {
    observer = new window.PerformanceObserver((list) => {
      if (list.getEntriesByName('first-contentful-paint').length) run();
    });
    observer.observe({ type: 'paint', buffered: true });
    if (!stopped) timer = setTimeout(run, timeoutMs);
  } catch {
    run();
  }
  return () => {
    stopped = true;
    clean();
  };
}
