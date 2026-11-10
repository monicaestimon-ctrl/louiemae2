# Louie Mae and HOLM Lighthouse 100 Implementation Specification

Prepared November 10, 2026 for Louie Mae and House of Louie Mae. This specification targets 100 Performance, 100 Accessibility, 100 Best Practices and 100 SEO on public, indexable storefront routes, on mobile and desktop. It also requires accessible, fast, secure private trade and checkout journeys without exposing them to search engines.

Status: implementation handoff, not a claim that these changes are implemented or production is healthy. The last known production blocker is Convex account suspension; the owner is handling billing separately. Engineering and fixture-based testing can proceed while that is unresolved. Production acceptance requires the restored backend and real eligible catalog data.

# 1 Success criteria and scope

The deliverable is a functioning shopping platform with repeatable high scores, not an empty landing page that scores well. Existing product information, imagery, delivery estimates, trade authentication, price eligibility and referral protections must remain intact.

Lighthouse scores vary with the browser, machine, network and page state. Pin the measurement environment and retain all runs. The goal is a displayed 100 in every applicable category under the agreed test profile; do not promise that every external PageSpeed test, visitor device or network condition will always show 100. Lighthouse calculates performance from measured metrics, and environmental variation changes results. [Lighthouse performance scoring](https://developer.chrome.com/docs/lighthouse/performance/performance-scoring)

## 1.1 Acceptance contract

| Surface | Performance | Accessibility | Best Practices | SEO |
| --- | --- | --- | --- | --- |
| Public retail home, collections and product pages | Target 100 | 100 | 100 | 100 |
| Public HOLM introduction and application information | Target 100 | 100 | 100 | 100 where intentionally indexable |
| Authenticated HOLM catalog, projects and account | Target 100 in authenticated lab profile | 100 plus manual checks | 100 | Correct noindex and authorization; no 100 indexability requirement |
| Retail cart, checkout, order confirmation and private referral/account pages | Target 100 for first-party surface | 100 plus manual checks | 100 for first-party surface | Correct noindex and privacy |
| Deliberate outages, missing pages and unavailable products | Stable usable fallback; measure separately | 100 where measurable | Investigate all failures | Correct HTTP and indexing behavior; no misleading 200 success |
| Stripe-hosted pages or other third-party destinations | Record separately | Verify handoff and accessible return | Record vendor-owned limits | Outside first-party score gate |

The four-score public release target is five fresh mobile runs and five fresh desktop runs per required public route. Every run must first pass healthy-content assertions. Require Accessibility, Best Practices and SEO at 100 in each valid run. Require displayed Performance 100 in at least four of five runs, median 100, and no valid run below 98. A lower result is an optimization failure to investigate, not permission to select a favorable report. Record raw fractional scores and displayed scores separately.

This repeated-run rule is the proposed reliability definition for the 100 target, not a guarantee on every environment. Any exception must be documented against the affected route and approved before describing that route as accepted.

Do not target SEO 100 by removing noindex from confidential pages. A test that reaches a login wall instead of its intended authenticated route is invalid.

## 1.2 What is outside a Lighthouse score

A score of 100 does not establish complete accessibility, commercial accuracy, security, legal compliance or successful fulfillment. Automated accessibility scoring excludes manual checks; manual keyboard and assistive-technology review is required in addition. [Lighthouse accessibility scoring](https://developer.chrome.com/docs/lighthouse/accessibility/scoring)

Separately verify product eligibility, inventory freshness, delivery policy, retail and trade pricing, commission eligibility, cart calculations and supplier-specific order routing. Keep real test payments, supplier orders, transfers and payouts prohibited under the existing restriction; no alternative payment-testing method is authorized by this specification.

# 2 Evidence baseline and initial audit

The November 9 Central time audit used Lighthouse 13.6.0, one run per route/device. Reviewed code commit: 9b4ada898f1a2e93f319db2ce9e08b9de8e8d0e8. Recorded production merge: 5d1b5f3cd191e133e1fd5dfcf4b8c5cc3d7fe883. Recheck current main before implementation; file references below identify inspected locations, not a guarantee that subsequent commits are unchanged.

| Audited page | Performance | Accessibility | Best Practices | SEO | CLS |
| --- | --- | --- | --- | --- | --- |
| Retail mobile | 75 | 86 | 96 | 100 | 1.000 |
| Retail desktop | 76 | 86 | 96 | 100 | 0.697 |
| HOLM mobile | 75 | 100 | 96 | 100 | 1.0004 |
| HOLM desktop | 77 | 100 | 96 | 100 | 0.704 |

All four runs encountered Convex errors. These are error-state measurements, not healthy catalog benchmarks. Do not infer that healthy performance will equal these numbers or that the error alone explains every point lost.

Evidence is stored in outputs/lighthouse-audit-20261109, including raw JSON, HTML reports, audit-summary.json and screenshots.

At implementation start:

1. Record current main commit, frontend deployment ID, backend deployment, dependency lockfile and active feature flags.
2. Read each raw audit's failing scored audits, diagnostic opportunities, console errors and layout-shift attribution. Produce an issue register with exact audit IDs and affected elements.
3. Reproduce each recorded defect on the current head. Close obsolete findings with evidence rather than changing already-fixed code.
4. Capture healthy baselines after backend recovery. Until then label local results synthetic fixture results.
5. Inventory actual routes and select representative product fixtures from both suppliers. Never invent URLs for completed-test claims.
6. Identify whether other public domains redirect here or serve a separate app. Audit every actual first-party storefront entry point; do not assume /trade covers a different production domain.

# 3 Measurement system and route coverage

## 3.1 Repeatable test environment

Pin Lighthouse 13.6.0 for initial comparison, an exact compatible Chrome build, Node version, package lockfile, OS image and runner hardware class. Version changes require a separate baseline review. Use built production output, never the development server.

Use Lighthouse default mobile simulated throttling and its desktop preset as two explicit profiles. Commit the resolved configuration, viewport, device scale, CPU/network throttling and browser version with each report. Run serially on a dedicated runner to avoid audit contention.

Use a clean browser without extensions. Disable only test-runner noise, not actual customer scripts or application functionality. Start cold-cache navigation runs independently. Run warm-cache and interaction tests separately. Preserve authentication for private-route tests without preserving unrelated cached assets. Never upload cookies, tokens, payment details or private customer data with artifacts.

Test anonymous consent states and returning-user consent states. Include first-visit banners in the appropriate baseline. Do not hide consent UI, errors or required scripts specifically when Lighthouse is detected.

## 3.2 Required route and state registry

Create a checked-in route manifest. Each entry contains route ID, resolved URL pattern, route owner, device profiles, authentication persona, fixture ID, expected heading/main marker, expected data marker, indexing policy, applicable score categories, readiness check and permitted data freshness.

| Group | Required examples and states |
| --- | --- |
| Retail home | Healthy featured products; optional editorial request fails; first visit; returning visit |
| Collections | Furniture; decor including lighting; populated, empty, filter applied, sorted, second page |
| Product detail | Zuo ground item; Zuo LTL item; Ashcroft item; multi-variant item; unavailable item; missing image; invalid slug |
| Search | Name search from each supplier; no results; keyboard selection; interrupted request |
| Retail cart | Empty; one item; quantity update; mixed suppliers; stale price; stock reduction; unavailable delivery |
| Delivery estimator | Valid mainland ZIP; changed ZIP; invalid ZIP; Alaska/Hawaii; remote/oversize quote-required; mixed shipments |
| HOLM public | Landing; application information; sign-in entry |
| HOLM authenticated | Approved partner catalog; pending applicant; rejected/ineligible account; expired session |
| Project cart | One item; mixed suppliers; saved project reload; project tier boundary; quote-required order |
| Referrals | Eligible public product link; preserved attribution through navigation; ineligible product; no trade-purchase commission |
| Resilience | Backend unavailable; timeout; media failure; expired authentication; offline transition |
| Metadata | Direct product request; collection request; social preview; robots; sitemap; missing URL |

Navigation Lighthouse does not measure every open drawer or interaction. Use browser interaction tests, accessibility scans after each state transition and performance traces for search, cart, filters and delivery changes. Do not mislabel a static snapshot score as a full navigation performance result.

## 3.3 Initial engineering budgets

These are project budgets to create headroom, not official thresholds that guarantee a Lighthouse 100. Recalibrate using healthy traces and preserve the final score gate.

| Metric | Mobile target | Desktop target |
| --- | --- | --- |
| FCP | At most 1.0 seconds | At most 0.7 seconds |
| LCP | At most 1.5 seconds | At most 1.0 seconds |
| Speed Index | At most 1.5 seconds | At most 1.0 seconds |
| Total Blocking Time | At most 50 milliseconds; aim for zero | At most 25 milliseconds |
| CLS | At most 0.01 | At most 0.01 |
| Initial first-party compressed JS | Public routes at most 150 KiB; private catalog at most 200 KiB | Same |
| Initial compressed CSS | At most 35 KiB per route | Same |
| Initial critical font transfer | At most 80 KiB | Same |
| Above-fold image transfer | Aim at most 300 KiB mobile combined | Aim at most 500 KiB combined |
| Initial public/catalog payload | At most 100 KiB compressed for first page | Same |

Store both compressed transfer size and decoded resource size. Do not compare unused-code estimates with compressed network bytes as if they were identical.

# 4 Phase 1 Production resilience and stable application shell

Primary files: contexts/BlogContext.tsx, components/ErrorBoundary.tsx, components/HomePage.tsx and trade/boot.tsx.

## 4.1 Isolate dependencies

Render a persistent page shell containing header, navigation, main region, meaningful heading and footer independently of optional editorial content. A failed blog query must not replace the storefront with a full-page error.

Separate query ownership by section. Place boundaries around optional blog, editorial, recommendations and account-specific widgets. Error boundaries handle rendering/query errors; asynchronous command failures also need explicit handling.

Use explicit states: loading, ready, empty, unavailable and retrying. Give each remote request a bounded timeout and bounded retry policy appropriate to its transport. Prevent retry loops on permanent errors. Proposed interactive request budget: show a retryable unavailable state by 10 seconds; retain the user's input and last non-sensitive view.

Authentication unresolved must not look like an approved trade account. Never use cached wholesale prices as an anonymous fallback.

## 4.2 Stable layout

Define shared dimensions for the startup shell and final shell. Reserve header, hero, product-grid, image and optional-section geometry before content arrives. Error messages render inside the affected section without replacing the entire viewport.

Use skeletons matching the final card aspect ratio and approximate text rows. Respect reduced motion. Do not indefinitely retain fake skeletons after failure or insert late content above what the customer is reading.

Fonts must not materially change line wrapping after first paint. Banners should occupy reserved space or use a non-obstructive overlay with accessible controls. Do not move focused controls when stock or delivery state changes.

## 4.3 Safe outage behavior

Navigation, support and nontransactional information remain available. Purchasing is disabled with a clear explanation when current price, stock or delivery qualification cannot be verified. Preserve cart drafts but revalidate before checkout.

Return typed public error codes and safe messages; capture private diagnostics server-side. Do not suppress console errors to pass Best Practices. Fix expected failure handling and investigate every unexpected error.

Acceptance: force optional-blog failure, backend failure and auth failure independently. Verify no lost cart, misleading eligibility, full-page collapse, unbounded spinner or large layout shift. Healthy-path score tests remain blocked until real data is healthy.

# 5 Phase 2 Accessible controls and complete interaction states

Primary files: components/ErrorBoundary.tsx, components/HomePage.tsx, components/cart/CartDrawer.tsx, components/SearchModal.tsx and components/SiteMenu.tsx.

## 5.1 Semantics and visual readability

Provide one primary main landmark per page, a meaningful page heading, logical heading hierarchy, correctly labeled navigation regions and a working skip link. Replace clickable category divs with actual links to real destinations.

Centralize color tokens. Correct the measured error text contrast of 3.32:1 to at least 4.5:1 for ordinary text. Review muted text, placeholder/help text, price labels, disabled explanations, badges, focus rings and image-overlaid text in every theme and state. Preserve the Louie Mae aesthetic through accessible colors rather than removing information.

Provide descriptive alt text for meaningful product imagery and empty alt text for decorative duplicates. Image captions, color swatches and variants need useful accessible names. Icon-only controls need labels describing their actions.

## 5.2 Dialogs and drawers

Use a shared accessible dialog primitive for search, cart, site menu and relevant product overlays. It must provide an accessible name, modal semantics when modal, initial focus, focus containment, Escape dismissal, trigger-focus restoration and background inertness.

Restore focus to a logical surviving element if the original trigger disappears. Prevent scroll-lock leaks when closing through navigation or errors. Nested dialogs need a defined stack; Escape closes the topmost dialog only. Never hide a focused descendant with aria-hidden.

Use links for navigation and buttons for actions. Ensure visible focus at all times, adequate touch targets and no hover-only functionality. Test at 320 CSS pixels, 200 percent zoom, 400 percent reflow and mobile landscape.

## 5.3 Forms, tables and asynchronous feedback

Delivery ZIP, quantity, trade application and sign-in fields need persistent labels, instructions, appropriate input types, autocomplete where applicable and programmatically associated errors. Focus an error summary after failed submission when several fields fail.

Announce cart count, search-result count and delivery results through restrained live regions. Do not repeatedly announce loading skeletons. Do not move focus automatically after routine price calculations.

Use table headers for genuine tabular project data. Retain accessible reading order when adapting to mobile cards. Color alone must not communicate availability or validation.

Acceptance: zero applicable Lighthouse accessibility failures, zero serious/critical automated accessibility violations in the required state matrix, and completed manual keyboard plus NVDA/Chrome and VoiceOver/Safari checks. Any remaining lower-severity issue requires explicit resolution or documented disposition; 100 alone is insufficient.

# 6 Phase 3 Search and canonical product navigation

Primary files: App.tsx, components/SearchModal.tsx, convex/products.ts and the canonical listing/mapping services identified during implementation.

The inspected search callback stored a selected ID in unused state and closed the modal. Replace it with navigation to the canonical public listing and selected variant. Browser Back must restore prior query/filter/scroll state where practical.

## 6.1 Unified public search contract

Create one bounded search service across legacy products and commerceProducts/commerceListings. Reuse the existing publication and channel eligibility authority rather than duplicating business rules.

A result contains public product/listing ID, public name, canonical URL, optional variant identifier, verified image and alt text, public price/currency, public availability state and permitted category. Never return supplier cost, internal margin or authenticated trade pricing in public payloads.

Apply access and publication filters on the server. Define handling of sold-out published pages explicitly: they may remain discoverable with truthful unavailable labels, but held, unpublished or private records cannot appear as purchasable. Discontinued records follow the product-retirement policy.

Debounce typing approximately 200 milliseconds, cancel or ignore stale responses, enforce a server result cap and support explicit pagination. Begin with 20 results per response. Avoid downloading the catalog into the browser for every query.

Normalize supplier identifiers internally but make public-name search work after product renaming. Choose and document whether supplier-SKU search is public or authenticated; never expose internal fields accidentally.

Acceptance: search an eligible Ashcroft and Zuo item, select by keyboard and pointer, open the correct variant, reload the URL and navigate back. Test duplicate names, empty queries, no results, stale responses, unpublished variants and expired authentication.

# 7 Phase 4 HOLM progressive catalog and typed modules

Primary files: trade/boot.tsx, trade/app.ts, v2 settings and approved trade-price services.

Remove startup behavior that fetches every 50-record page until Exhausted before rendering the application. Render the shell immediately; fetch identity and required first-page data through independent gates. Render approved trade prices only after permission is established.

Use server filtering, sorting and cursor pagination. Proposed initial page size: 24 products. Load additional pages on an explicit Load more action or carefully bounded viewport prefetch; do not auto-fetch the entire catalog. Provide keyboard-accessible pagination and restore position when returning from a product.

Keep cart/project state independent from the catalog list. Adding a product uses its stable variant and approved price revision, not a copied card label. Server authorization and repricing remain authoritative.

Split trade/app.ts into typed modules by catalog, product, project cart, delivery, application, referrals/earnings and account. Remove whole-file TypeScript/lint suppression incrementally. Do not replace suppressions with broad any types. Define typed boundary DTOs and validate server inputs.

Lazy-load project tools, earnings, onboarding, PDF/3D viewers and nonessential calculators only when needed. An authenticated customer must not download admin or supplier-evidence tooling.

Read approved project tier settings and actual trade prices from v2 authorities. If the existing savings calculator remains in scope, keep it a separate module from delivery estimation: savings use actual approved retail/trade prices; commissions apply only to eligible retail referrals, never a trade purchase.

Acceptance: first page usable without later pages; no private-price flash during login/logout; filter changes reset cursors; stale requests cannot overwrite current results; catalog-to-project connection preserves variants and correct prices; unauthorized users cannot fetch trade payloads directly.

# 8 Phase 5 Assets and rendering performance

## 8.1 Product image pipeline

Maintain supplier original assets privately with provenance. Generate verified display derivatives with deterministic versioned URLs, dimensions, aspect ratio, format, byte size and content hash. Preserve product colors and details; do not substitute unrelated images to save bytes.

Produce responsive widths appropriate to cards, product hero and zoom, initially 320, 480, 640, 960, 1280 and 1600 pixels where source resolution permits. Avoid upscaling. Use AVIF/WebP where supported with a compatible fallback.

Render responsive srcset and accurate sizes. All images have intrinsic width/height or a stable aspect-ratio container. The actual LCP image is eagerly discoverable and may receive high fetch priority; do not lazy-load it. Lazy-load below-fold images. Do not preload an entire carousel or every catalog card.

Only load full-resolution zoom assets when requested. Provide a stable, accessible missing-image state. Audit both appearance and product identity after transformation. Supplier originals, costs and restricted documents must not become public through the image pipeline.

## 8.2 JavaScript and CSS

Generate a production bundle report per entry point. Identify import paths pulling Stripe, editors, PDF tooling, 3D modules, admin panels or trade calculators into initial retail/HOLM render.

Split by meaningful route and feature boundaries. Preserve the existing lazy 3D loading. Load payment-related code when checkout needs it, without introducing a slow or broken handoff. Use bounded intent-based prefetch for likely next navigation.

Remove dead code and unused dependencies only after verifying usage. Avoid a blanket shared vendor chunk that forces unrelated screens into every route. Measure parse/evaluation time as well as transfer size.

Reduce unused CSS through correct content scanning and explicit safe lists for real dynamic classes. Do not remove styles needed by later modal states. Keep critical styles available before the first paint.

## 8.3 Fonts and main-thread work

Use licensed self-hosted WOFF2 assets where appropriate, limited families/weights and language subsets. Set a deliberate display strategy and metric-compatible fallbacks. Preload only critical fonts actually used above the fold.

Keep expensive filtering, sorting and large data transforms out of render loops. Use server pagination first; virtualize only where measured need justifies it and keyboard/screen-reader behavior remains correct. Break up long tasks; avoid unnecessary synchronous layout reads/writes.

Use transform/opacity animations where suitable and respect reduced motion. Start video and heavy decorative animation after meaningful content, with accessible controls and a static fallback.

Acceptance: meet byte budgets, inspect network waterfalls, verify no duplicate hero downloads, and compare before/after traces. Performance optimizations may not hide products, lower image identity accuracy or disable interactions.

# 9 Phase 6 Crawlable public routes and correct SEO

Primary locations: App.tsx, api/og.ts, public/sitemap.xml, route/deployment configuration and a public product projection.

## 9.1 Rendering architecture

Keep the existing Vite application unless a separate migration is justified. Introduce server-rendered or build-rendered public HTML for indexable routes, then hydrate interactive controls. Select the supported Vercel/Vite integration in an architecture decision before implementation; do not assume the current SPA produces crawlable product HTML.

Prefer an explicit public read model shared by HTML rendering and client hydration. It includes only published public fields and a revision identifier. Initial HTML must contain meaningful product name, description, image, public price/availability when trustworthy, and navigation.

Prevent hydration mismatches by using the same public projection and revision. Avoid a second full fetch before usable content. Cached content is descriptive; checkout always revalidates live stock, price and delivery.

## 9.2 URLs and status codes

Adopt stable product URLs such as /products/{slug}, bound internally to immutable product identity. Variants have explicit stable selection behavior. Maintain redirects when names/slugs change.

Replace collection meta-refresh wrappers with actual routes and appropriate permanent redirects where necessary. Preserve legitimate referral parameters through redirects and client navigation. Canonical URLs omit attribution/tracking parameters.

Return genuine 404 for unknown products and a documented retired-product policy for discontinued listings. Temporary stock-outs may retain a useful 200 product page with accurate unavailable content. Do not redirect every removed product to the homepage or return soft-404 HTML.

During a backend outage, either serve a valid last-known public representation with clear limitations or an appropriate unavailable response. Never fabricate current offers from unknown costs or inventory.

## 9.3 Metadata and structured data

Provide unique title, description, canonical URL and social metadata per public page. Add visible breadcrumbs and corresponding structured data where appropriate.

Generate Product/Offer structured data only from public verified fields that match visible content. Preserve manufacturer/brand identifiers truthfully despite Louie Mae product names; private labeling must not invent GTINs, brand claims, ratings or review counts. Never expose wholesale or authenticated trade prices.

Generate the sitemap from canonical, public, indexable records. Use meaningful last-modified dates; omit private project links, carts, checkout, search-result combinations and unpublished products. Define facet indexing rules to avoid an unbounded number of near-duplicate URLs.

Private trade, accounts and confirmation pages use noindex and real authorization. Robots rules are not access control. Public marketing pages can be indexed; confidential catalog/prices remain private according to the channel policy.

Acceptance: direct HTTP fetches return meaningful HTML/status; metadata matches the selected product; structured data validates; redirects preserve referrals; unpublished/private data cannot be found in HTML, public APIs, caches or sitemap. Homepage SEO 100 is not evidence that these tests pass.

# 10 Phase 7 Best Practices and security compatibility

Resolve the exact failing Best Practices audit IDs from healthy reports. The current 96 result is not enough to infer every cause.

Eliminate unexpected browser errors, broken asset requests, mixed content, deprecated browser APIs, invalid image sizing and source-map/privacy mistakes. Verify TLS and all external resources. Classify third-party-cookie and vendor-script issues rather than hiding them.

Review CSP, HSTS, referrer policy, frame restrictions, permissions policy and MIME handling. These are security requirements, not all guaranteed Lighthouse scoring factors. Roll out a restrictive CSP in report-only mode first where needed, then enforce after testing authentication, images, Convex connections and Stripe. Never weaken protections to make an audit pass.

Keep privileged data out of client bundles, public source maps, logs and test artifacts. Preserve the existing client-secret and repository-secret checks. Use server authorization for every private trade and project operation.

Cache hashed static assets immutably. Cache public catalog HTML/data only under explicit public keys and freshness policy. Authenticated price, identity, project and order responses must not be shared between customers; configure private/no-store where required. Prevent service-worker or CDN caches from bypassing server eligibility checks.

Test dependency updates separately and retain lockfile reproducibility. Review actionable advisories and production reachability; an audit score is not a substitute for dependency and authorization review.

Acceptance: 100 applicable Best Practices audits, zero unexpected console errors on healthy flows, no cross-user cache leakage, no mixed content and successful auth/payment-provider compatibility checks within the existing testing permissions.

# 11 Phase 8 Shopping and delivery regression protection

This phase ensures optimizations do not damage the actual business. It does not independently approve missing supplier evidence or activate unqualified products.

## 11.1 Authoritative commerce boundaries

Public product display, retail cart and HOLM project cart must use stable product/variant IDs with channel-specific approved price revisions. Recheck eligibility server-side when quoting and before payment-session creation. Do not let a public cached card authorize a purchase.

A stale price produces an explicit refreshed total that the customer can review. A stock reduction produces an accessible correction, not silent quantity changes. Preserve selections across recoverable errors.

Maintain the approved pricing model: supplier cost, modeled expenses, $10 per-product allocation, delivery allowance, applicable margin floor, trade discount and referral commission eligibility. Performance work cannot silently alter those values or invent missing evidence.

## 11.2 Delivery estimator

Use the existing approved estimator policy as the source of truth. Product-level ZIP estimation and full-cart estimation must call the same versioned policy. A lightweight UI does not mean a less complete calculation.

Validate ZIP input; group shipments by supplier/origin/service; account for quantity, shipping dimensions/weight, LTL/parcel classification and quote-required conditions. Never treat order value or distance alone as a carrier quote.

Display estimate status, included service and material exclusions. Alaska/Hawaii, oversized orders, unsupported destinations and abnormal trade quantities retain their quote-required path. The $49.99 through $199.99 ladder is not a universal maximum freight liability.

Recalculate on ZIP, quantity, variant, channel and cart changes. Ignore out-of-order responses. Preserve ZIP/cart input through failures. The final cart delivery amount must match the accepted server quote and policy revision.

## 11.3 Mixed suppliers and referrals

Mixed Zuo/Ashcroft baskets remain one understandable customer order with supplier-specific fulfillment groups. Display possible separate shipments in cart/checkout and confirmation. Any future EDI dispatch includes only the intended supplier's lines.

Keep referral attribution intact across direct URLs, canonical redirects, search, cart and checkout. Trade purchases do not earn referral commissions. Record existing earned commission terms immutably; moving lighting into decor cannot rewrite historical earnings.

Acceptance: browser/API tests cover mixed cart, delivery refresh, stock change, trade tier boundaries, invalid destination, expired session, duplicate request and referral preservation. No real supplier dispatch or financial action is performed by these tests.

# 12 Phase 9 Automated quality gates and test fixtures

## 12.1 Proposed repository deliverables

| Deliverable | Purpose |
| --- | --- |
| docs/quality/lighthouse-spec.md | Version-controlled implementation contract |
| docs/quality/route-matrix.json | Actual route fixtures, permissions, indexing and readiness expectations |
| scripts/lighthouse/run.mjs | Version-pinned serial mobile/desktop collection |
| scripts/lighthouse/assert.mjs | Healthy-content checks, repeated-run acceptance and metric budgets |
| scripts/lighthouse/summarize.mjs | Comparable HTML/JSON results with all runs retained |
| lighthouserc configuration | Explicit environment and scoring settings |
| tests/e2e/storefront, trade, delivery and accessibility suites | Interaction and failure-state coverage |
| .github/workflows/quality.yml | Preview gates and artifacts |
| docs/quality/release-checklist.md | Production proof, exceptions, rollback and owner sign-off |

Names are proposed; align with existing repository conventions instead of creating duplicate infrastructure.

Use deterministic, non-sensitive fixtures in an isolated test backend. Include eligible and held Zuo/Ashcroft variants, ground/LTL products, approved/pending trade accounts, stock/price changes and quote-required deliveries. Clearly distinguish fixtures from live records. Never seed production for Lighthouse.

Mocks may validate controlled resilience and business logic, but a passing mocked run cannot establish live checkout readiness. Full payment-lifecycle tests remain blocked by the existing test-payment restriction until separately authorized.

## 12.2 CI stages

1. Existing lint, TypeScript, strict Convex checks, unit/integration tests, catalog-writer checks, append-only checks, secret checks and production build.
2. Browser route smoke tests: correct content, no server error screen, valid data, expected authentication state and no unexpected console error.
3. Accessibility scans after navigation and representative modal/form states.
4. Mobile and desktop Lighthouse navigation audits on deterministic public routes.
5. Authenticated first-party route measurements and interaction traces.
6. Bundle/asset budget checks and route metadata/status checks.
7. Upload raw JSON, HTML, screenshots, trace summaries and a machine-readable result manifest.

PRs may begin with a smaller representative route set and three runs for efficiency; the complete five-run release matrix remains mandatory. Once a route meets the final gate, enforce that gate against future regressions. During remediation, record baseline thresholds transparently rather than describing transitional thresholds as the final 100 target.

Wait for preview deployment readiness and verify commit identity before auditing it. A preview password/login page is not an acceptable audit target. Handle preview protection through an approved test mechanism without exposing bypass credentials in artifacts.

On flaky results, retain the failure, investigate runner/load/network state and repeat the full affected batch with a reason. Do not loop until one favorable score appears.

# 13 Phase 10 Production rollout and monitoring

## 13.1 PR sequence

| PR phase | Scope | Exit evidence |
| --- | --- | --- |
| 1 | Measurement harness and route inventory | Reproducible baseline; healthy-content validation rejects error pages |
| 2 | Failure isolation, stable shell and basic semantics | Failure-injection tests; reduced CLS; readable errors |
| 3 | Accessible controls and dialogs | Keyboard/axe evidence across interaction states |
| 4 | Unified search and canonical navigation | Both suppliers searchable; correct direct URLs and Back behavior |
| 5 | HOLM progressive loading and typed module boundaries | First-page readiness; private-price authorization; project continuity |
| 6 | Image pipeline and JS/CSS/font optimization | Size budgets, visual review and before/after traces |
| 7 | Public HTML rendering, metadata, redirects and sitemap | Crawlable verified products; private routes remain protected |
| 8 | Best Practices/security/cache cleanup | Exact failing audits resolved; auth and cache tests |
| 9 | Complete shopping/delivery regression suite and CI enforcement | Full applicable fixture matrix; no unauthorized financial tests |
| 10 | Healthy production verification and monitoring | Repeated scores, functional proof and rollback readiness |

Each PR uses the repository default base branch, is ready for review, and has a description explaining behavior changes and validation. Let CodeRabbit start automatically. Resolve applicable findings against the current head; do not repeatedly request manual reviews. Follow repository instructions to stop review cycling when no unresolved critical or major CodeRabbit issues remain, while tracking any lower-priority issue that still violates an acceptance requirement.

Merge phases only after their checks pass and dependencies are satisfied. Use additive, backward-compatible backend changes before frontend consumers. A merged PR, deployed frontend and successfully deployed backend are distinct statuses.

## 13.2 Production gate

Billing restoration is owner-managed. After service resumes, verify backend health and latest inventory before activating or testing eligible commercial flows. A Nov9/Nov10 stock snapshot must not be treated as current indefinitely.

Verify frontend/backend compatibility, deployed commit identity, configuration presence and real eligible catalog responses. Run read-only production smoke tests and the full applicable score matrix. Inspect actual mobile and desktop screenshots for product correctness, cropping, typography, focus and overlays.

No phase is called live until its frontend and required backend/configuration changes are verified in production. No catalog is called purchasable until its eligibility and checkout path are verified separately.

## 13.3 Telemetry and operations

Collect privacy-conscious field LCP, CLS and INP, segmented by route template, mobile/desktop and release version. Avoid full query strings, referral tokens, ZIP codes, personal identifiers or order details in performance telemetry.

Evaluate real-user Core Web Vitals at the 75th percentile: LCP at most 2.5 seconds, INP at most 200 milliseconds and CLS at most 0.1. These are field-health thresholds, separate from the stricter laboratory engineering budgets. Low traffic requires reporting sample count and insufficient-data status rather than claiming a statistically established pass. [Web Vitals](https://web.dev/articles/vitals)

Run scheduled read-only synthetic checks on representative public routes, and a broader weekly audit. Alert on unexpected errors, missing products, private-data leakage, severe metric regressions or failed health assertions. Record whom each alert reaches and how it is triaged; do not claim monitoring exists until delivery is tested.

## 13.4 Rollback

Record the previous healthy frontend deployment and backend compatibility range before release. Keep new features independently reversible where practical, without exposing private data or bypassing eligibility. Do not roll back by deleting immutable orders, pricing revisions, inventory evidence or commissions.

For a bad release, stop further rollout, restore the last compatible frontend, disable the affected new feature if safe, and verify the core journey. A rollback that restores an older frontend must not accidentally reopen products blocked by newer stock/eligibility evidence.

# 14 Completion checklist and handoff requirements

Implementation is complete only when:

- All recorded findings have a tested resolution or an explicitly approved, accurately scoped exception.
- Public indexable route/device pairs satisfy the four-category acceptance contract.
- Private routes meet their applicable performance, accessibility and Best Practices checks while retaining noindex and authorization.
- Healthy-data assertions prove reports measured actual pages rather than error, login or placeholder states.
- Search, product navigation, HOLM catalog/project connection and delivery interactions pass the required tests.
- Automated accessibility scans and manual assistive-technology/visual reviews are complete.
- Product HTML, canonical URLs, sitemap and visible/structured price and stock data agree.
- No private prices, costs, account/project data or credentials leak through public payloads, HTML, caches or artifacts.
- Current supplier evidence and commerce eligibility are verified separately; unqualified records remain blocked.
- Frontend/backend deployment identity, rollback instructions, monitoring ownership and retained reports are recorded.
- No unauthorized payment, supplier order, transfer or payout has been used as a test.

The final evidence packet must list every route, device and persona; all repeated scores and metric values; failing and resolved audit IDs; browser and Lighthouse versions; commit/deployment IDs; fixture versus live-data designation; accessibility review results; visual-review screenshots; functional test results; and any remaining operational blocker.

This work can begin immediately with the measurement harness, resilience, accessibility, search, pagination and asset work. Production acceptance and eligible checkout activation remain dependent on backend restoration and current commercial qualification. This specification does not itself authorize billing changes, live payments or supplier dispatch.

