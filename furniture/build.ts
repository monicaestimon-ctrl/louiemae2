import type { Plugin } from 'vite';
/** Development-only routing; production routes are explicit in vercel.json. */
export function furniturePlugin(): Plugin {
  return {
    name: 'house-of-louie-mae-route',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [pathname, search] = (req.url || '').split('?');
        const query = search ? `?${search}` : '';
        // Mirrors the vercel.json redirect: the furniture catalog moved to /trade; its admin stays.
        if (/^\/furniture\/?$/.test(pathname)) {
          res.statusCode = 307;
          res.setHeader('Location', `/trade${query}`);
          res.end();
          return;
        }
        if (/^\/furniture\/admin\/?$/.test(pathname)) req.url = `/furniture/index.html${query}`;
        if (/^\/trade\/?$/.test(pathname)) req.url = `/trade/index.html${query}`;
        next();
      });
    },
  };
}
