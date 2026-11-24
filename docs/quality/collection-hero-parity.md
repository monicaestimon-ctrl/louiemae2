# Shared collection category rendering

Collection roots now use one typed `CollectionRootHero` for initial HTML and the interactive page. The server renders the configured root categories, titles, captions, image framing and responsive layouts instead of replacing a generic text-only preview with different cards. Filtered/product views keep their existing product-preview document.

Category cards use genuine collection URLs; safe configured cross-collection destinations are retained. Unsafe destinations fall back to the category's own encoded URL. Unsafe/missing images are omitted while the visible category name remains. Decorative images do not duplicate the link label. Above-fold category images are visible without an opacity/load-event gate and advertise a 200-pixel mobile card width. Product previews below the root hero load lazily at low priority.

Current product/catalog authorization, filters, sorting and checkout qualification remain authoritative. This change does not turn server HTML into purchasing permission. The current live configuration and catalog readiness still control removal of the initial document. No late-ready marker can rescue an invalid Lighthouse run.

Validation: 22 focused component/catalog/API tests pass, along with TypeScript, lint, build and unbundled Node runtime checks. All four collection roots passed read-only source/live browser checks at 390 and 1440 pixels, with one primary heading and no axe violations, horizontal overflow or page errors. Filtered navigation and missing collection 404 behavior passed. Evidence is retained under `artifacts/lighthouse/collection-root-*` and `collections-all-browser.json`.

The retained local diagnostic `2026-11-17T11-21-31-106Z` scored furniture 84 mobile/98 desktop and kids 82 mobile/98 desktop; other categories scored 100 and health checks passed. Layout shift was zero or below 0.001. This does **not** establish a performance improvement or release acceptance. Image/data latency and the remaining controlled production score target still require work; do not omit these failed diagnostics.
