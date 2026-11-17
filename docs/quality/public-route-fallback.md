# Unknown public paths

Unknown paths return HTTP 404 rather than a successful home page. The response is a small, independent HTML document with a main landmark, page title, responsive type, visible keyboard focus, and home/shop links. It requires neither JavaScript nor a working catalog backend. It does not reflect the requested URL, include a canonical for nonexistent content, or allow indexing. HEAD returns the same status with no body; other methods return 405 with Allow.

Known product, collection, journal, shop, story, policy, board and trade rewrites remain ahead of the fallback. Admin and valid retail referral entry paths explicitly retain the application document. Referral processing and authentication are unchanged. Existing hash links continue through the root application. API paths remain outside the public fallback.

Vercel checks existing filesystem content before these rewrites, so the home document, assets, robots and sitemap retain their existing behavior. See the [official rewrite configuration](https://vercel.com/docs/project-configuration/vercel-json#rewrites). Preview and production verification must still check this hosted ordering, including the home page, a static asset, admin entry and a deliberately missing path. Do not visit a real referral link as a smoke test: that records attribution activity.

Local validation covers handler statuses, headers, recovery links, no URL reflection, rewrite matches, and keyboard/axe/overflow checks at 320, 390 and 1440 pixels. This phase does not implement dynamic sitemap generation or validate all Lighthouse acceptance routes.
