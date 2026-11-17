# Controlled public Lighthouse runs

The manual **Production Lighthouse evidence** GitHub Actions workflow performs read-only public navigation. It accepts a full expected production commit, uses the fixed Louie Mae origin, and runs every registered route serially five times on mobile and desktop. It has read-only repository permission and no production credentials. It does not submit forms, carts, payments or supplier commands.

`controlled-profile.json` records Chrome for Testing 157.0.8103.78, Node 24.14.1, Lighthouse 13.6.0 and Ubuntu 22.04. The browser installer is locked to the dependency tree. Chrome is downloaded by its exact version, never a moving stable alias. The manifest also records the actual CPU model/count, OS release, runner image version and memory. GitHub-hosted virtual hardware still varies: compare those recorded values and the Lighthouse benchmark index before treating a change as an application regression. A browser, OS or hardware-profile change needs a new baseline; Windows desktop results are not interchangeable with this Linux baseline.

The public `build-info.json` artifact contains only its schema version and source commit. It is emitted during the build and served with no-store/noindex headers. Audits check it before and after running and fail if the deployed source does not match the requested commit. This detects a release that changes during the test window; deployment should remain stable throughout the run. It does not prove backend version or supplier-data freshness, which require their separate release evidence.

All reports, health checks, screenshots and failures are retained for 30 days as workflow artifacts. Copy accepted release evidence to the release record before expiry. A failed preflight retains its reason. A score failure does not cancel later route batches. Pending specification coverage, omitted routes, incomplete batches or failed deployment verification prevent an acceptance label. Do not remove pending coverage merely to make this workflow green.

Normal Git deployments obtain their identity from `VERCEL_GIT_COMMIT_SHA`. For an explicitly verified clean CLI source upload without Git metadata in its remote build, supply `BUILD_SOURCE_COMMIT` as a build environment value from the checked-out reviewed commit. Conflicting values or a malformed SHA stop the build. This identity is a release-tracking assertion, not cryptographic proof of deployed bytes; retain the independent Vercel/CI deployment verification too. Local builds use `git rev-parse HEAD` when neither variable is supplied.

After this increment is merged and its build identity is live:

1. Verify the production Vercel deployment and successful backend deployment separately.
2. Dispatch the workflow from the reviewed main branch with that production commit.
3. Retain the workflow URL and all artifacts. Review every route/device batch, source/deployment commits and environment fields.
4. Fix reported defects and perform a new complete run. Preserve earlier failures.

The November 17 Windows run retained 20 landing-page results: retail mobile Performance 85/85/86/88/85, retail desktop 100/100/100/100/100, HOLM mobile 75/93/73/76/75 and HOLM desktop 100/94/100/95/100. Accessibility, Best Practices and SEO were 100 in all 20 runs. These are incomplete acceptance results; the shared computer's benchmark index also differed materially from the earlier diagnostic environment.

References: [Chrome for Testing](https://developer.chrome.com/docs/automation-and-testing/chrome-for-testing) and [Puppeteer browser installation](https://pptr.dev/browsers-api).
