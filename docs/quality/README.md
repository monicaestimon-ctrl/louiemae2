# Lighthouse implementation status

The measurement foundation introduces a public, read-only harness and acceptance policy. It does not certify the storefront or complete the full route matrix. Phase 1 of lighthouse-spec.md covers the resilience work tracked below; see that specification for the full implementation contract.

## Reproduce

Use Node 24 and npm ci. Set CHROME_PATH to a clean Chrome executable and AUDIT_CHROME_VERSION to its exact four-part version. Set AUDIT_BASE_URL to the public deployment origin and AUDIT_DEPLOYMENT_COMMIT to the independently verified deployed commit. Run npm run audit:lighthouse. Lighthouse 13.6.0, chrome-launcher and Puppeteer Core are pinned in package-lock.json.

The runner launches a fresh temporary Chrome profile per run, measures serially and saves Lighthouse JSON/HTML, a viewport screenshot, content-health receipt and assessment under artifacts/lighthouse. Do not use a signed-in personal browser profile. Private routes and authentication are deliberately not supported by this initial public harness.

AUDIT_RUNS=1 runs four diagnostic measurements (two routes and two devices). It always fails the release batch-size gate; it is useful for checking the harness without implying release acceptance. The default is five measurements per route/device. Every run is retained, including failures. The process exits nonzero if any batch fails.

The content check inspects the actual tab Lighthouse measured. Retail requires its populated, loaded recommendations marker. HOLM requires the live application's home main, which is not rendered by its startup or error shell. Both reject known outage messages, redirects and browser console errors. These are baseline guards, not proof of complete product or checkout correctness.

## Current coverage and remaining work

routes.json explicitly lists pending route families. Do not call a successful landing-page batch full-spec acceptance. Future phases must add real product/collection fixtures, authenticated personas, cart/delivery interactions, metadata checks, budget enforcement, accessibility scans, manual reviews and deployment-specific CI collection. This first phase adds policy tests to normal CI; it does not pretend that a healthy preview backend exists.

Run npm run test:lighthouse-policy to verify rejection of high-scoring error pages, missing results, redirects, wrong device profiles, console errors, incomplete batches and below-target repeated scores.

Lighthouse navigation metrics and content health are distinct. A later DOM check cannot prove every interaction worked or the page was healthy throughout measurement; retain screenshots and console audits and add flow tests before production acceptance. Never relax the data/health checks to make an outage score pass.

No billing changes, production data writes, purchases or supplier dispatch are performed by this harness.

## Resilience implementation: editorial isolation

The public blog subscription now returns a local unavailable state instead of throwing through SiteProvider. Pending editorial UI is bounded to ten seconds; the existing Convex subscription may recover without a reload. There is no added polling or automatic retry loop. The blog index and article view distinguish pending, unavailable, confirmed empty and confirmed missing results. Public failures cannot trigger owner-only seed mutations.

This does not complete the resilience phase. Commerce qualification and admin query error behavior remain strict. Run the editorialResilience and HomePage.catalog test suites for this increment.

## Resilience implementation: shell and cart recovery

Public site settings and custom pages now have independent ten-second pending limits and unavailable states. Default navigation remains available during configuration failure. Unknown settings cannot trigger seeding or be saved over through configuration actions. An unresolved custom page shows loading or unavailable content; a confirmed missing page is no longer silently replaced by the homepage.

Direct useQueries request descriptors must retain stable identities: the installed Convex subscription hook updates state when its request identity changes. A real-SDK lifecycle test covers rerenders, query failure, disabling and cleanup; mocked query-return tests alone cannot catch a resubscription render loop. The production-build outage check retains navigation and reaches the visibly rendered Support page at 390px and 1440px widths. This checks recovery during the actual disabled-backend condition, not healthy commerce or Lighthouse scores.

Page content has a route-keyed error boundary below navigation and the cart provider. Manual retry remounts only the failed page. The error view has a main landmark and readable body text. Cart credit is requested only for an open, authenticated legacy cart; unresolved or failed credit blocks that checkout instead of silently treating it as zero. V2 checkout failures remain inside the cart, with retry by closing and reopening it. None of these paths bypass server price, stock or delivery validation.

Tests cover retained cart drafts and navigation, local retry, route recovery, configuration failure and timeout, blocked fallback writes, absent closed/anonymous credit subscriptions, credit recovery and v2 checkout failure isolation. The further resilience increments below address account lookup, HOLM startup and recommendation boundaries. Remaining work includes private owner-data queries, detail dialogs, lazy-chunk timeouts, complete manual retry experiences, and browser layout measurements against a healthy backend. This remains partial implementation, not production acceptance.

## Resilience implementation: HOLM startup and viewer transitions

HOLM account resolution and catalog loading each have a ten-second pending limit. Query errors, timeouts and a confirmed empty catalog expose recovery links and manual retry, remove the decorative startup hero, and never render the verified-catalog marker. Authentication must agree with the account response before catalog loading begins. Logout, account changes and trade-role changes remount pagination with a fresh SDK query identity; old viewer rows are removed. The legacy module-level catalog is installed in a layout effect and cleared on subscription/viewer changes instead of being mutated during render.

Six tests include the real Convex pagination lifecycle across logout and approval transitions. Production-build browser checks at 390px and 1440px confirm recovery links, one main landmark, no horizontal overflow, no retained startup hero and no catalog during the real backend outage. This does not verify healthy prices or purchasing. The full-catalog startup requirement and monolithic trade application still need the Phase 4 progressive-loading/module work; the legacy module-level catalog remains an implementation constraint. The retail signed-in account lookup is addressed by the next increment below; other outstanding resilience work remains open.

## Resilience implementation: recommendation and account isolation

Homepage recommendations now own their catalog queries inside a local boundary. A failed request keeps the hero, categories and surrounding page content mounted. Pending recommendations have a ten-second limit, local retry and reserved section space; no sample products or verified-ready marker appears during failure. Staff permission lookup uses stable error-returning subscriptions with an independent timeout. Unknown account permissions cannot enable owner reads or seeding, and the admin entry displays an unavailable state rather than an indefinite access spinner.

Focused tests cover recommendation error/retry/timeout, retained homepage content, absent ready markers, account permission failure, auth transitions and real SDK subscription stability. This is still partial Phase 1: private owner-data queries, detail dialogs and lazy-chunk failure handling need further isolation, and healthy layout stability must be verified after backend recovery. The current production backend remains unavailable; synthetic and outage checks are not storefront acceptance.

## Resilience implementation: overlays, owner reads and module loading

Search, selected product details and owner catalog/editorial reads now use an error-returning query wrapper with stable SDK request identities, a ten-second budget per query/arguments and explicit retry. Unknown or failed data cannot seed owner records, display stale selected-product purchase controls or become a false empty search. Search text survives failure. Product dialogs and featured sections distinguish missing records from transport failure. Catalog preview/grid and quote-status waits also have bounded unavailable states.

Route modules and both startup modules have ten-second import deadlines. A failed cached React lazy import offers document reload rather than a futile subtree retry. Search chunk failures stay inside a dismissible overlay, and startup chunk failure has a non-React recovery screen. Saved cart storage is not cleared. Financial mutation retries and reconciliation are unchanged; this increment does not abort or retry payments.

The real browser reproduction previously showed a failed search removing all navigation. Production-build checks now preserve search input and navigation at 390px and 1440px, allow Escape dismissal, and verify recovery with blocked retail/HOLM startup, search and support chunks. Module timers, account/catalog/error distinctions and real-SDK request transitions have regression coverage. These checks remain outage/synthetic evidence; healthy geometry, complete accessibility/dialog behavior and the later commerce/monitoring acceptance matrix remain outstanding.

Product delivery availability and HOLM project checkout settings also have local error/timeout recovery. Unknown flags or pack profiles cannot expose estimate, checkout or quote controls. These changes do not change delivery pricing or automatically retry financial commands.

Review corrections retain already-loaded catalog cards when another page times out, with a local recovery message instead of an indefinite spinner. Product dialogs distinguish request failure from confirmed absence, and unconfigured/confirmed-missing editorial feature slots are omitted. The lazy page helper retains each component's prop types. Regression tests cover these cases.


## Accessibility implementation: retail dialogs and navigation

Search (including pending/failed lazy modules), cart, site menu, product quick views and newsletter now share a native dialog primitive. It owns modal inertness, explicit forward/backward Tab containment, topmost-only Escape, initial and restored focus, and reference-counted scroll locking. Restoration runs after React removes route content and uses a surviving trigger or main-content fallback. Newsletter defers opening while another dialog is present, including when that dialog unmounts instead of emitting a bubbling close event.

Category navigation uses links, quick views use named native buttons, variants expose selection, and cart controls name their product. A first-focus skip link, page main landmarks and meaningful page headings replace the header logo heading. Muted text and placeholders use centralized readable tokens; support fields have persistent labels and autocomplete. Decorative category images do not repeat their link text. No payment, price, eligibility or delivery calculation changes are included.

Validation: 199 test files passed (1,248 tests, one existing skipped), plus focused newsletter-removal coverage and TypeScript/build checks. Clean Chrome 156 browser checks at 320 and 1440 CSS pixels cover menu/cart/search: no automated axe violations, no Tab escape, Escape dismissal and restored trigger focus. A real-browser nested-dialog fixture covers forward/backward Tab, background inertness, inner/outer Escape, missing triggers and exact overflow-priority restoration. Local route scans cover homepage, support, blog and catalog failure states. JSDOM lifecycle tests deliberately do not claim native focus/inertness proof.

This increment is not complete Phase 2 acceptance. Populated catalog/product variants, authenticated HOLM/application/sign-in/project forms, asynchronous delivery feedback, actual browser zoom, mobile landscape and NVDA/Chrome plus VoiceOver/Safari remain in the required matrix. Automated scans contain manual-review/incomplete checks and outage states are not healthy storefront acceptance. Backend billing remains externally blocked. Support submission behavior and delivery-policy consistency are tracked separately for Phase 8.
