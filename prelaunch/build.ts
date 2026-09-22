import { readFileSync } from 'node:fs';
import { loadEnv, type Plugin } from 'vite';

// Keep the original HTML and React entry untouched. Launch day: set
// VITE_PRELAUNCH_MODE=false and redeploy to restore the original storefront.
export function prelaunchPlugin(): Plugin {
  let enabled = true;
  return {
    name: 'louie-mae-prelaunch',
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, 'VITE_');
      enabled = (process.env.VITE_PRELAUNCH_MODE ?? env.VITE_PRELAUNCH_MODE) !== 'false';
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (ctx.filename.replace(/\\/g, '/').endsWith('/furniture/index.html')) return html;
        return enabled ? readFileSync(new URL('./index.html', import.meta.url), 'utf8') : html;
      },
    },
  };
}
