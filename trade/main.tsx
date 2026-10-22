import './style.css';

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
