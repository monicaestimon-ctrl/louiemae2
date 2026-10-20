import { readFileSync } from 'node:fs';
import { loadEnv, type Plugin } from 'vite';

// The storefront is live by default; opt in explicitly for a future waitlist.
// The trade site (/trade) and the furniture catalog (/furniture) always keep their own pages.
export const keepsOwnPage = (filename: string) =>
  /\/(furniture|trade)\/index\.html$/.test(filename.replace(/\\/g, '/'));

export function prelaunchPlugin(): Plugin {
  let enabled = true;
  return {
    name: 'louie-mae-prelaunch',
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, 'VITE_');
      enabled = (process.env.VITE_PRELAUNCH_MODE ?? env.VITE_PRELAUNCH_MODE) === 'true';
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (keepsOwnPage(ctx.filename)) return html;
        return enabled ? readFileSync(new URL('./index.html', import.meta.url), 'utf8') : html;
      },
    },
  };
}
