import './index.css';

// index.html paints the home hero on its own. Start the app once that first paint has
// happened so the bundle never stands between the visitor and the hero. Other entry
// routes have no shell to show, and background tabs don't paint, so they start at once.
let started = false;
const start = () => {
  if (started) return;
  started = true;
  void import('./boot');
};

if (document.documentElement.dataset.shell === 'home' && document.visibilityState === 'visible' && 'PerformanceObserver' in window) {
  try {
    new window.PerformanceObserver((list, observer) => {
      if (list.getEntriesByName('first-contentful-paint').length) {
        observer.disconnect();
        start();
      }
    }).observe({ type: 'paint', buffered: true });
  } catch {
    start();
  }
  setTimeout(start, 300);
} else {
  start();
}
