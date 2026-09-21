import type { Plugin } from 'vite';
/** Development-only routing; production routes are explicit in vercel.json. */
export function furniturePlugin(): Plugin {
  return {
    name: 'house-of-louie-mae-route',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [pathname, search] = (req.url || '').split('?');
        if (/^\/furniture(?:\/admin)?\/?$/.test(pathname))
          req.url = `/furniture/index.html${search ? `?${search}` : ''}`;
        next();
      });
    },
  };
}
