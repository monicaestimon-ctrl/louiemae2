# Catalog subscription scope

The shared site provider subscribes to product lists only while a mounted
consumer requests them. Authentication alone does not request either list.
Requests are reference counted and cleanup is idempotent for StrictMode and
overlapping mounted consumers.

| Consumer | Catalog source |
| --- | --- |
| New arrivals / new collection | Explicit public context demand; released on unmount |
| Store collection | Its existing direct public list subscription |
| Product modal / configured featured product | One authoritative public detail record |
| Home, story, blog, support, shop landing | No context catalog subscription |
| Admin dashboard, products, page/content editors | Explicit private context demand |
| CJ settings | Its own operational readers; product editor opens by ID |
| Product import | Collection configuration and import mutations; no catalog list |

The public collection pages expose an explicit loading state while their
requested catalog is unavailable. The product seeding guard still depends on
an authenticated, loaded empty private catalog, never an unrequested public
catalog. Public and private API authorization and contracts are unchanged.

This release does not require summary activation. It removes unnecessary
subscriptions while preserving the existing list behavior for actual consumers.
Catalog pagination and the held health/queue/sourcing frontend cutovers remain
separate release gates. Measure execution frequency after backend availability
is restored; do not infer live savings from disabled production functions.
