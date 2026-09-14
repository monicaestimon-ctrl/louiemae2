# Louie Mae prelaunch

The temporary public landing page uses the existing Vercel project and louiemae.com. It does not replace or delete App.tsx, index.tsx, index.html, storefront components, product data, or the original administrator interface. Work was isolated from the user's other changes on codex/prelaunch-waitlist, based on main at 7a8c6410977841c94972c120997ed3108e0a2d05.

## Public and private entry points

- `/`: editorial landing page and signup form.
- Existing `/shop`, `/story`, `/blog` and `/collection/*` shared links temporarily redirect to `/`. Other public paths and old shopping hashes render the landing page.
- `/admin`: preserved original store administration, with a link to the launch waitlist.
- `/waitlist-admin`: existing administrator login, paginated signup review, complete CSV export, and unsubscribe controls. Server-side authorization uses the existing administrator allowlist. Merely having an account is not sufficient.

## Email intake

The browser posts to `/api/waitlist`. The server validates and normalizes email addresses, checks consent and a honeypot, and uses a server-only `WAITLIST_INTAKE_SECRET` to call the database. The secret is configured in Vercel production and the production Convex deployment; never prefix it with VITE_ or commit it.

Production database: `https://diligent-jay-261.convex.cloud` (the existing production deployment). Signup records are in `waitlistSignups`, with email, createdAt, consent version, source and status. New contacts also enter the existing `subscribers` table with the `prelaunch-waitlist` tag. Existing opt-outs are not silently reactivated. Repeated submissions return the same public response and do not create duplicate waitlist records. Database writes are atomic.

Rate limits allow ten valid attempts per client address per hour. A daily rotating keyed hash is stored instead of the raw address. Expired hashes are removed by scheduled cleanup. Success is displayed only after storage acknowledges the request; failures retain the email and permit retry. No welcome or launch emails are sent automatically by this change. This is a capture-and-management flow; send a campaign only when the business is ready. Unsubscribe requests can be sent to hello@louiemae.com and actioned in the private waitlist screen, which updates both records. CSV includes status; exclude unsubscribed rows before sending a campaign.

## Restore the full storefront at launch

Set `VITE_PRELAUNCH_MODE=false` in Vercel's production environment and redeploy the same project. This switches Vite back to the untouched original HTML and React entry and restores the original shared-link handlers. The same setting must be used for build and server runtime. Do not delete waitlist tables or subscriber records. Keep the waitlist export before switching; the existing subscriber table remains available in the original administration interface.

The default is prelaunch when the variable is absent. To re-enable prelaunch, remove the setting or set it to true and redeploy. The original prelaunch-free production deployment was `louiemae2-atkmucw2x-monicafernii97-cmds-projects.vercel.app`, retained by Vercel as an additional rollback point.

## Validation

The original test suite plus dedicated waitlist tests verify normalization, validation, storage, duplicates, opt-outs, throttling, anonymous access denial, success only after save, and retry after failure. Validate both build modes, then check staged and production HTTP intake and verify the exact reserved QA record in the database. `waitlist:removeTestSignup` is internal-only and deletes only the reserved `louie-mae-qa-*@example.com` test addresses; never use real visitor addresses for QA.

## Visual assets

Four text-free scene assets were generated from the user's supplied references with built-in imagegen, then compressed to WebP. Product photos are existing Louie Mae assets; the original brand monogram is retained. Source and generation prompts are preserved in the original workspace under output/prelaunch-concepts/production-assets. All live text is HTML, not baked into the images. The public page uses scoped CSS and defers the original administration bundle until an administrator entry path is opened.
