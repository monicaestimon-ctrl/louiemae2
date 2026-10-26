import './style.css';

// Lazy photos stay clear until they have arrived, then fade in over their warm placeholder
// (style.css, "Photos arrive gently"). Load and error don't bubble, so listen in capture.
const arrived = (e: Event) => {
  if (e.target instanceof HTMLImageElement) e.target.dataset.lo = '';
};
document.addEventListener('load', arrived, true);
document.addEventListener('error', arrived, true);

// index.html paints the hero on its own. Start the app once that first paint has happened
// so the bundle never stands between the visitor and the hero. Without the shell (other
// routes) or in a background tab, start at once.
let started = false;
const start = () => {
  if (started) return;
  started = true;
  void import('./boot');
};

if (document.getElementById('holm-shell') && document.visibilityState === 'visible' && 'PerformanceObserver' in window) {
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
