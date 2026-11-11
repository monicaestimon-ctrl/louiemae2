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

Follow-up browser checks verify the first Tab reaches the skip link before the static hero, and that newsletter deferral/dismissal works at 320px, 1440px and 844x390 landscape without submitting a form. Entrance animations immediately reveal focused descendants and honor reduced motion; an actual-component browser fixture checks both. Dark search/newsletter accent text uses a readable light accent.


Review corrections identify cart actions by product and variant, include iframe elements in the focusable selector, and avoid outlining the static main-content/menu-title targets while retaining outlines on interactive controls. Newsletter scheduling observes direct body children and native close events rather than every subtree mutation; removal and mounted-close cases have tests. Its initial close-button focus is deliberate for an automatically opened promotion, avoiding an unsolicited mobile keyboard.

Run `npm run test:dialogs:browser` with installed Chrome (or set `CHROME_PATH`) to reproduce native nested-dialog, mixed-control Tab/Shift+Tab, background-inertness and trigger-removal checks. It writes a receipt under `artifacts/lighthouse/shared-modal-browser.json` and performs no network/financial mutation. The fixture is now tracked; esbuild is pinned to the already locked version for bundling the actual component. Unit tests additionally cover preferred focus, restoration and reaching a trailing iframe; they do not establish cross-origin embedded-payment behavior.


## Accessibility implementation: desktop disclosures and delivery forms

Desktop navigation now has one named navigation landmark, destination links and separate disclosure buttons with expanded state and controlled lists. Tab reaches ordinary links, Escape closes a disclosure and restores its button, and focus/pointer departure closes the open list. Opening is explicit to avoid hover/click races on touch devices. Modified link clicks retain browser behavior. The cart announces quantity changes separately from its stable button name.

Product estimates, delivery quote requests and the address-review step share field-level errors and a linked, focused validation summary. Validation is local before a request; edits clear the corresponding error without stealing focus, and estimate results remain polite announcements without moving focus. ZIP+4 remains supported at checkout and quote entry. Existing estimate revision guards, quote idempotency, supplier pack rules, checkout eligibility and payment requests are preserved. Shared scoped form CSS supplies readable labels, focus indicators and input dimensions in both retail and HOLM without importing one storefront's global reset into the other.

`npm run test:forms:browser` requires a production build and Chrome (or `CHROME_PATH`). It renders actual components with explicit local query/auth/request fixtures and a connect-src none policy. At 320×900, 844×390 and 1440×900 in both storefront styles it checks invalid-submit focus, linked field focus, result focus preservation, input height and horizontal overflow. It never requests a real quote or initiates payment. Screenshots and JSON are written under ignored artifacts/lighthouse. Product-estimate axe scanning is additional local evidence, not complete checkout or healthy production acceptance.

Validation: targeted navigation/delivery tests pass. The full run passed 1,258 tests with one existing skipped; its only failure was the existing loopback HTTP test blocked by sandbox EACCES, and that complete three-test file passed when rerun with loopback access. Source lint excluding ignored local audit artifacts, TypeScript and the production build are checked separately. Creator/HOLM enrollment and sign-in, populated product variants, actual zoom and assistive-technology review remain in Phase 2. No 100-score or healthy commerce acceptance is claimed while the production backend is disabled.


The diagnostic run also exposed a runner configuration error: the Node API does not apply the CLI-only `preset` option. Desktop runs now pass Lighthouse's exported desktop configuration as the third API argument. The existing integrity policy rejected incorrectly mobile-shaped desktop reports; those reports were never valid acceptance evidence. Verify the emitted `configSettings.formFactor` and screen-emulation dimensions, not just a report filename.


Review corrections preserve an open desktop disclosure during pointer blur inside its panel; release/cancel/keyboard activity clears the pointer guard, and later outside focus still closes it. Chrome confirms panel-padding clicks keep it open and outside focus dismisses it. Checkout email/state errors are siblings of labels to avoid duplicate accessible names. Quote submit remains reachable while fields are incomplete, so local validation can show all missing details; only an in-flight request disables it. Focused regressions and the six storefront/viewport form fixtures pass after these corrections.

## Accessibility implementation: shared credentials and HOLM overlays

Creator and trade sign-in now share a typed credentials form with persistent labels, autocomplete, local validation, linked field errors and a focused error summary. Pending requests disable mode changes and guard duplicate dispatch. Rejected requests preserve typed values. Existing password/Google provider payloads and return destinations are retained; account permissions remain server-owned. Trade welcome is extracted into a typed component; the full-catalog startup dependency remains Phase 4 work.

HOLM product detail, menu, project tray and client-quote overlays now use the shared native dialog. Structural dialog CSS travels with the component, so retail and trade receive the same inertness, focus containment, restoration and scroll locking. Modal keyboard events do not reach background page shortcuts; menu/product arrow navigation is local. Product cards have named native open buttons, navigation destinations are links, hidden sticky actions are inert, and project switches form a labeled button group. Mobile back controls retain an accessible name.

Validation: the full suite passed 1,267 tests with one existing skip. TypeScript, source lint and production build checks pass. `test:credentials:browser` exercises both forms at 320, 844 landscape and 1440 pixels with mocked authentication and network blocked. `test:holm:browser` exercises the actual App with 24 explicit fixture products: keyboard product opening, contained focus, nested unverified quote gate, independent Escape, menu arrow navigation, restored focus/scroll and zero backend commands. The shared dialog fixture also checks background keyboard isolation. Retail menu/cart/search regression scans at 320 and 1440 pixels found no axe violations or focus escape; HOLM product/tray/menu scans found no axe violations.

These are bounded fixture/outage checks, not healthy commerce acceptance. The verified quote editor, remaining legacy HOLM tools and overlays, application/enrollment forms, actual zoom and assistive-technology reviews remain open. The production backend billing block still prevents healthy catalog/checkout acceptance. No account, quote, payment or supplier command was submitted by these browser checks.

Both `test:credentials:browser` and `test:holm:browser` require `npm run build` first. They check the required storefront stylesheets before bundling the fixture or launching Chrome, and report the build prerequisite when the assets are missing.

## Accessibility implementation: HOLM tools and applications

Studio piece lists, Compose, sharing, inspiration details, board creation, planner snapshots, render briefs, render results and the floor-plan editor use native dialogs. The piece list exposes a focusable scroll region in landscape. An unfinished floor-plan polygon consumes the first Escape; the next Escape dismisses the editor and restores its opener. Canvas focus makes Enter complete the polygon without invoking a focused toolbar button. Inspiration image/upload actions are native buttons. Studio, planner and Trade Hub states have primary headings, and piece-list naming includes its visible quantity and price.

The trade application is a typed component with validation before step changes and before upload/submission, linked field errors, focused step headings, a native certificate input and a synchronous duplicate-command guard. A rejected request retains the draft; review displays only the last four EIN digits. Existing approval, tax-exemption and optional-certificate policy remains server-owned. Creator profile validation shares the server's existing ordered validation rules through field-keyed feedback. Enrollment commands are guarded while pending, and rejected profiles retain their input. The retail program heading hierarchy now matches its membership and earnings sections.

Build first, then run `test:holm-tools:browser`, `test:planner-dialogs:browser`, `test:application:browser` and `test:enrollment:browser` with Chrome or `CHROME_PATH`. The scripts use actual components with explicit local fixtures, block network connections and never issue real application, enrollment, upload, generation or financial commands. Tests include 15 tool-dialog/viewport combinations, floor-plan draft handling, three render-display states, 18 application stage/viewport combinations and six enrollment storefront/viewport combinations. axe-core is a pinned direct test dependency. Artifacts record fixture scope and are not production commerce evidence.

Remaining Phase 2 acceptance includes the full authenticated portal/table and quote matrix, actual browser zoom and assistive-technology review. Healthy catalog and checkout verification remains blocked by the disabled production backend. Subsequent search, progressive catalog, asset, SEO, security, commerce-regression, CI and production-acceptance phases remain separate work.

TypeScript excludes build output, audit artifacts, generated output and temporary worktrees. This prevents checking stale bundles during a build and avoids recursively checking local task copies; application source and tests remain included.
Validation for this increment: all 205 test files passed (1,272 tests, one existing skip). The production build and client-secret verification passed. Type-check input verification confirms application source/tests are included and generated audit/build files are excluded. Browser fixture results are scoped as described above; no healthy production or four-score acceptance is claimed.

`test:quote-dialog:browser` exercises the verified-trade client quote editor with local fixtures. Missing client/studio/email details produce linked feedback; pending creation disables edits and duplicate commands, and a rejected mock request retains the draft. Real quote creation is prohibited. This does not establish the downstream client approval or payment journey.

## Accessibility implementation: partner portals and delivery requests

The v2 partner portal keeps invitation drafts, validation and pending commands separate for each organization. Owners receive member-specific removal controls; non-owners retain their existing read-only view. Link creation and clipboard operations are guarded while pending. Changing the destination or sharing channel clears old output. Clipboard failure now explains how to copy the visible link, and never announces a false success. Payout-setup command failures use focused safe feedback; no payout policy or financial transaction behavior changed.

Populated earnings tables have focusable horizontal scroll regions and readable captions. Grid children and selects can shrink at narrow widths. The legacy Creator Hub receives the same layout, contrast, heading, clipboard-feedback and duplicate-command protections, with safe enrollment/credit-setting errors. Existing membership, commission, trade and credit policies are unchanged.

Legacy HOLM delivery requests now associate contact errors with fields, focus step headings and failed-submit summaries, expose delivery-option selection, and disable project edits while a request is pending. Failed requests retain their contact draft and existing retry token. v2 delivery eligibility and server pricing remain authoritative; this change does not enable a held product or bypass qualification.

Build before running `test:portal:browser`, `test:legacy-creator:browser` and `test:tray-request:browser`. These use real components with synthetic records, blocked external connections and mocked commands. They cover populated tables, rejected invitations/link creation, clipboard failure and legacy delivery-request validation/pending/rejection states at 320px, 844px landscape and 1440px. The existing nested client-quote browser checks also pass with the changed tray. No real invitation, payout setup, quote, payment or credit mutation is performed. Actual browser zoom, assistive-technology review and healthy production commerce remain separate acceptance work.

Validation for this increment: build/client-secret verification, TypeScript and targeted lint passed. Twenty-five focused tests passed, including changed account flows and isolated reruns of the local HTTP/admin tests. All 12 new browser viewport/theme cases passed without axe violations or page overflow. A contended local full-suite run was stopped after timing failures; full CI remains required before merge. The OAuth feedback test now waits for focused feedback rather than only the alert's presence.

Review corrections: legacy payout setup resets its pending guard only on a persisted pageshow event, preserving duplicate protection during outbound navigation. Quote validation and hourly limits now carry typed customer-safe guidance. Eight focused tests and the three-viewport mocked quote-request browser suite pass; the latter verifies the hourly-limit message and retained draft. No live payout or quote command was executed.
