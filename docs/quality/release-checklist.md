# Production quality release checklist

This is an evidence checklist, not a declaration that the platform is complete. A green PR validates that change; it does not override incomplete route coverage, supplier evidence, accessibility review or operational gates in `lighthouse-spec.md`.

## Record the release

Create one dated release record under `outputs/lighthouse-audit-20261109` with the proposed commit, PR, reviewed head, CI run, frontend deployment, backend deployment run, configuration version and previous compatible production deployment. Record UTC times and exact paths to retained reports. Record no credentials, session cookies, customer records or private supplier documents in public CI artifacts.

- [ ] Read current branch status and confirm unrelated changes are excluded.
- [ ] Verify all review comments against the current head; link fixes or explain stale findings.
- [ ] Record required CI results for that head, not an earlier green commit.
- [ ] Confirm frontend and backend order. Deploy additive contracts before consumers; migrations need verified readiness before cutover.
- [ ] Record previous healthy deployment and compatible backend/schema range. A previous frontend is not automatically compatible with newer eligibility rules.

## Before merge

- [ ] Application types, strict backend types, relevant unit/integration tests and build pass.
- [ ] Existing bundle, API boundary, repository-secret, catalog-writer and immutable-ledger checks pass without weakening limits.
- [ ] Verify changed public endpoints expose only public fields. Authenticated trade, account and project data remain access-controlled.
- [ ] Test errors, timeouts, denied storage, late responses, retries, navigation/unmount and keyboard focus where the change introduces asynchronous state.
- [ ] Review actual mobile and desktop screenshots, including long labels, missing media and error states.
- [ ] Test the exact preview commit and report synthetic fixtures separately from live data. Production credentials must never be sent to an unrelated origin.
- [ ] Confirm private routes retain noindex and private cache policy. Do not turn a login wall into an apparently successful authenticated test.
- [ ] Confirm no test requires a real charge, transfer, payout or supplier dispatch. Existing restrictions still apply.

## Deploy and verify

- [ ] Merge the reviewed head after required checks pass.
- [ ] Wait for frontend readiness and any required backend deployment/configuration checks; a Vercel success alone does not prove Convex deployed.
- [ ] Read `/build-info.json` before and after verification and require the expected full commit. Preserve evidence if identity changes during a run.
- [ ] Exercise changed public read contracts and real eligible records. Use independent privacy assertions on responses and HTML.
- [ ] Exercise applicable browser journeys without submitting prohibited commands. Verify preserved cart/project contents, visible prices, availability gates and focus after transitions.
- [ ] Verify unavailable variants cannot proceed on either storefront. A source quantity read is not a reservation; authoritative checkout remains required.
- [ ] Verify product images match the selected product/variant. A successful image response alone is insufficient visual review.
- [ ] Record live, synthetic, blocked and not-tested states explicitly. Never replace an unknown with a passing result.

## Repeated Lighthouse acceptance

- [ ] Use the pinned runner, browser, Node and lockfile and retain all raw reports, health assertions, screenshots and environment metadata.
- [ ] Run every applicable registered route on mobile and desktop: five fresh runs each. A selected subset or one diagnostic run cannot pass the release gate.
- [ ] Every scored run must show healthy intended content. An error, login or placeholder page cannot establish acceptance.
- [ ] Accessibility, Best Practices and applicable SEO must be 100 in each valid public run. Performance must display 100 in at least four of five runs, median 100, with no run below 98.
- [ ] Report remaining `pendingCoverage` entries; registered routes passing is not full-spec acceptance while required personas or states are absent.
- [ ] Include interaction tests for filters, search, cart and delivery changes; navigation scores do not measure those states.
- [ ] Retain failed runs and the reason for a subsequent batch. Do not select only favorable reports or silently relax thresholds.

## Commerce, accessibility and operations

- [ ] Confirm supplier evidence by effective date, SKU, warehouse, quantity basis and freshness. Distinguish available-to-sell from on-hand and preserve unknowns.
- [ ] Qualify approved prices, MAP, cost completeness, commissions, trade savings and delivery policy independently. Draft/unqualified records remain blocked; quality work cannot grant eligibility.
- [ ] Verify supplier split routing and customer shipment disclosure using permitted tests. Do not send an actual fulfillment order as a test.
- [ ] Complete manual keyboard and assistive-technology review, with reviewer, date, browser/AT version and results recorded. Axe alone cannot close this gate.
- [ ] Verify privacy-conscious field monitoring, consent behavior, retention, sample counts, duplicate handling and insufficient-data states before claiming field-health results.
- [ ] Verify read-only synthetic schedules, ownership and authorized alert delivery/recovery. A checked-in schedule without a completed run does not establish working monitoring.
- [ ] Record legal/terms, funding or account-owned blockers separately; do not claim that code changes resolved them.

## Rollback and completion

Stop rollout for an eligibility bypass, private-data leak, invalid price authority, persistent application error or broken core journey. Preserve the failed evidence. Restore a known compatible frontend or disable the affected feature only when doing so retains current inventory, authorization and pricing restrictions. Verify deployment identity and core journeys again. Do not delete or rewrite immutable orders, commissions, inventory evidence or pricing revisions to roll back a feature.

The final handoff must name all deployed commits, covered routes/devices/personas, repeated scores, functional and visual evidence, manual accessibility results, monitoring owner, rollback target and unresolved blockers. Mark full-spec completion only when every required gate is satisfied or the user has explicitly approved a named, scoped exception. No blanket exception is implied by merging an incremental phase.
