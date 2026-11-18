import { startAfterVisibleContent } from '../lib/visibleStartup';
import { installPrivateLocationPolicy } from '../lib/privateIndexing';
import './style.css';
import { loadModule, showStartupFailure } from '../lib/moduleRecovery';

// Lazy photos stay clear until they have arrived, then fade in over their warm placeholder
// (style.css, "Photos arrive gently"). Load and error don't bubble, so listen in capture.
const arrived = (e: Event) => {
  if (e.target instanceof HTMLImageElement) e.target.dataset.lo = '';
};
document.addEventListener('load', arrived, true);
document.addEventListener('error', arrived, true);

installPrivateLocationPolicy(window);

// Let the visible server document paint, without delaying visitor interaction.
startAfterVisibleContent(() => {
  void loadModule(() => import('./boot')).catch(showStartupFailure);
});
