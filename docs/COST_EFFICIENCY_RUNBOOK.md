# Louie Mae Cost-Efficiency Runbook

This runbook keeps useful storefront, AI, import, inventory, and fulfillment
features intact while preventing accidental spend and cross-environment data
access.

## Environment boundaries

| Runtime | Frontend Convex target | Convex secrets | Intended data |
| --- | --- | --- | --- |
| Local development | Personal/development deployment | Development provider keys | Test data |
| Vercel Preview | Shared staging or branch preview deployment | Staging provider keys | Test data |
| Vercel Production | Production deployment | Production provider keys | Live data |

Set LOUIE_MAE_PRODUCTION_CONVEX_URL and
LOUIE_MAE_PRODUCTION_CONVEX_DEPLOYMENT in local/preview environments. The
pre-build guard fails if either environment points at those production values.

GEMINI_API_KEY and LOUIE_MAE_AI_MODEL belong in each Convex deployment's
environment settings. They must not be configured as VITE_ variables.

## Required one-time security steps

These changes require dashboard access and are intentionally not automated:

1. Deploy the server-side AI actions and frontend together.
2. Confirm concierge, page generation, category suggestions, variant
   translation, newsletter copy, and blog excerpts in Preview.
3. Remove VITE_GEMINI_API_KEY and any browser Gemini aliases from all Vercel
   environments.
4. Rotate the previously browser-exposed Gemini key, restrict the replacement
   key to the required Gemini APIs, and store it only in Convex.
5. Run npm run build; the post-build scanner must report
   “Client-secret verification passed.”

## Vercel build controls

The repository's ignoreCommand runs scripts/vercel-ignore-build.mjs.
Documentation-only and GitHub-automation-only commits skip a Vercel build;
runtime changes still build normally. CI cancels superseded runs and deploys
Convex without repeating the already completed frontend build.

Review monthly:

- Vercel Usage: Build CPU time by project and deployment.
- Vercel Deployments: repeated builds for the same commit or inactive branches.
- Vercel Observability: function invocations, duration, and transfer. A sudden
  increase should be tied to a feature or investigated before raising limits.
- Convex Usage: database reads/writes, action compute, storage, and bandwidth by
  function.
- Convex Logs: AIUsage records by operation, duration, and success. Logs do not
  contain prompts or secrets.

Keep Preview deployments for active work. Close stale pull requests and remove
inactive Git branches rather than disabling useful previews globally.

## Convex data lifecycle and usage controls

The storefront receives only public product projections. Full products,
newsletter subscribers, campaigns, draft posts, and write operations require
the configured admin allowlist (`CJ_ADMIN_EMAILS` or `ADMIN_EMAILS`). Search is
skipped until the modal is open with at least two characters and returns at
most 20 indexed matches.

Batch import scraper results are normalized into versioned
`batchImportPayloads`; raw provider HTML is not retained. Progress rows remain
small, while the next 12 review records are loaded through a dual-read path so
legacy inline payloads remain usable during migration.

Production rollout order:

1. Deploy schema and dual-read code to Preview and run the protected 1688 and
   generic import fixtures.
2. Run `batchImports:migrateLegacyPayloads` with `dryRun: true` and cursor
   pagination; record before/after bytes.
3. After approval, repeat with `dryRun: false` in batches of at most 25,
   advancing `continueCursor` until `isDone`.
4. Run `dataLifecycle:backfillRetentionMetadata` once per legacy record kind,
   first with `dryRun: true`, then (after approval) in bounded write batches.
5. Run `dataLifecycle:report` and `dataLifecycle:cleanup` with `dryRun: true`.
   Review counts before any `dryRun: false` call. Cleanup is bounded and safe
   to repeat; a parent batch job is kept until every legacy child is gone.
6. Run `files:reportStorage` for a read-only candidate list. Never delete files
   solely because the bounded app scan says “possibly unreferenced”; verify
   external/legacy references manually.

For description-audit retention metadata, call
`dataLifecycle:backfillRetentionMetadata` with
`{"kind":"descriptionAudits","dryRun":true,"limit":100}` and record the
candidate count. After approval, call it with the same arguments and
`"dryRun":false`. Repeat the write call until the returned `hasMore` is
`false`; each successful pass removes those rows from the missing-expiry index,
so rerunning is safe. Finish with another dry run and confirm zero candidates.

For product search metadata, call `products:backfillSearchText` with
`{"dryRun":true,"limit":100}` and record the candidate count. After approval,
call it with `{"dryRun":false,"limit":100}` repeatedly until `hasMore` is
`false`. Finish with the dry-run form and confirm zero candidates before
relying on indexed storefront search.

Retention defaults are intentionally conservative: batch review payloads 72
hours, terminal batch metadata 30 days, description audit debug payloads 30
days (the audit identity/final result remains), CJ webhook idempotency logs 90
days, and CJ/AI usage telemetry 90 days. No cleanup cron is enabled until a
human reviews the first production dry-run.

CJ inventory polling uses `cjInventoryNextCheckAt`: visible products remain on
a six-hour freshness target, while hidden/out-of-stock products are checked
daily for restocks. A 30-minute cron selects only due records. Run the bounded
`cjHelpers:backfillInventoryNextCheck` first with `dryRun: true`, then in
approved bounded write batches after deployment. Inspect
`cjUsage:getInventoryPollSummary` for empty runs, provider token requests,
updates, and errors before changing the schedule.

## Static asset deletion evidence

Two files with copy-only names were removed from public/images/brand:

- 869F81A5-59DB-4730-B2A1-8D8DF1D33CA3 copy.PNG
- 869F81A5-59DB-4730-B2A1-8D8DF1D33CA3 copy 2.PNG

Both had SHA-256
E3F482008DFDF0A5BFDED8FB1B1412A68ABDD3017217B3EE526E38E64E7B8374,
identical to the retained canonical file
869F81A5-59DB-4730-B2A1-8D8DF1D33CA3.PNG. A repository-wide literal-name
search outside public and dist returned no references. No unique brand image
was removed.

## Monthly waste review

1. Compare the current invoice period with the previous 30 days.
2. Attribute the top three increases to a deployment, Convex function, AI
   operation, or asset.
3. Treat import, fulfillment, and customer-facing AI work as valuable when
   volume matches user activity.
4. Investigate empty scheduled runs, repeated builds, failed/retried actions,
   growing temporary import data, and client queries returning data the visible
   route does not use.
5. Do not purge production data, change billing plans, or rotate credentials
   without owner approval and a verified rollback.

## Rollback

- Frontend: roll back or promote the last known-good Vercel deployment.
- Convex: keep new function/schema changes backward-compatible through the
  frontend rollout; deploy the prior functions only if the old schema remains
  compatible.
- AI: restoring the old client-side key path is not an acceptable rollback.
  Roll back only the server action implementation or model selection.
- Environment guard: use a non-production Convex target. Do not bypass the guard
  by deleting the production reference values.
