import { installOptionalFieldMonitoring } from './lib/quality/fieldEntry';
import { startAfterVisibleContent } from './lib/visibleStartup';
import { installPrivateLocationPolicy } from './lib/privateIndexing';
import './index.css';
import { loadModule, showStartupFailure } from './lib/moduleRecovery';

installPrivateLocationPolicy(window);
installOptionalFieldMonitoring();

// Let the visible server document paint, without delaying visitor interaction.
startAfterVisibleContent(() => {
  void loadModule(() => import('./boot')).catch(showStartupFailure);
});
