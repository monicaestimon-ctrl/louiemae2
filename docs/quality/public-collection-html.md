# Public collection HTML

Public collection routes serve meaningful navigation before JavaScript loads. Furniture, decor and fashion roots read only public category configuration, matching their interactive category-only view. Kids root reads its verified eight-card preview. Filtered and product-grid requests read at most twelve candidates from each applicable public catalog reader. It never reads partner prices or private supplier costs. These previews are not complete inventory counts or purchasing authority.

Missing collections return 404; unavailable configuration or catalog sources return 503 with `Retry-After` and `noindex`. Responses are not cached. Client navigation removes the initial document and collection schema when their route or availability no longer matches. Once the current collection has loaded, the normal interactive catalog replaces the preview.

The HTML includes a collection heading, category links, responsive category imagery and canonical metadata. Kids and product-grid previews additionally include product links and public retail prices. CollectionPage/ItemList structured data describes the returned preview only. Filtered links retain their query parameters. HTML, metadata and JSON are escaped independently. Product purchase eligibility remains enforced by the existing current server authority.

Validation includes API failure/method/input cases, route decoding, initial-document lifecycle and error-boundary recovery. Anonymous browser checks cover all four collections at 390 and 1440 pixels with JavaScript enabled and disabled, plus a filtered furniture route and a missing collection. Those checks use production public catalog data without account, cart or payment commands.

This phase expands the audit registry; it does not claim full Lighthouse acceptance. The preview and interactive collection layouts differ, so layout shift and mobile performance must be measured in the controlled audit. Filter/empty-state coverage, the remaining public routes and the commerce/persona journeys remain required by the full spec.
