# Shop and story public HTML

Direct `/shop` and `/story` requests serve public content from the current site configuration instead of a metadata page that immediately redirects. GET and HEAD are supported; unknown route identities return 404 and unavailable configuration returns 503 with noindex and Retry-After. HTML is not cached. No authenticated query, raw rich HTML or unrelated configuration fields are exposed.

The shop document provides native links to each collection and the journal. The story document includes its configured hero, prologue, four narrative chapters and text/image fields from additional sections. Complex dynamic section layouts still belong to the interactive renderer. Public metadata and AboutPage/CollectionPage structured data identify the actual route. Referral query parameters remain in the original URL for the existing attribution code.

The initial document remains visible while configuration and the interactive module load, then the matching page removes it. Route changes and source failure remove stale content and schema. Error boundaries reveal recovery. Shop category cards are native anchors, both pages have main landmarks, hero images load eagerly and the story's small text uses accessible opaque colors.

API tests cover public-field selection, escaping, unsafe image URLs, methods, missing identities and unavailable sources. The unbundled Node runtime verifies both functions against the built template. Anonymous production-content browser checks cover both pages at 390 and 1440 pixels with and without JavaScript: matching canonicals, one heading, no page errors or overflow, and no collection-content accessibility violations. Representative interactive layouts were visually reviewed. These are local candidate checks, not a production release or repeated Lighthouse acceptance.

Remaining public-rendering work includes journal/post HTML, dynamic section parity, generated sitemap coverage, global unknown-route responses and the rest of the route/state registry.
