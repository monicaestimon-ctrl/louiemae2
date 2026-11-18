# Scheduled quality checks

This phase adds synthetic checks, not real-user metric collection. Field LCP/CLS/INP, consent handling, retained aggregation and verified alert delivery remain separate requirements.

The daily public-health workflow navigates the retail home, Furniture category root and HOLM introduction on mobile and desktop, in fresh anonymous browser contexts. It uses the registered readiness markers, checks HTTP/final URL, JavaScript/console errors and axe violations, and refuses known command endpoints. It never clicks checkout, sends a supplier order, signs in, or submits a form. Screenshots and compact reports contain public pages only.

Both daily health and weekly Lighthouse require production's build identity to match the workflow commit before and after the run. A deployment lag or mid-run deployment is a failure, not permission to label another version as tested. The shared concurrency group keeps daily and full audits from competing for this workflow slot. Each report retains failures; the weekly audit still requires every registered route/device batch and the unchanged repeated-score gate. Pending full-spec coverage cannot be waived by a successful daily check.

Schedules use UTC: daily health at06:17; the full Lighthouse audit Monday at07:47. GitHub schedules can be delayed. Manual dispatch remains available. Disable the applicable GitHub workflow to stop a faulty scheduled check; do not disable storefront eligibility or remove failing checks to make the report pass.

Operational owner: repository administrators. The workflow run and retained artifacts are the initial investigation location. GitHub failure notifications depend on each recipient's notification settings. No test email or external alert is sent by this change, and no verified notification delivery or recovery claim is made until a named recipient/destination is configured and tested with authorization. Do not describe the monitoring requirement as complete on the strength of these schedules alone.

Triage failures by deployment identity first, then backend/source readiness, browser errors and accessibility findings. Record the incident, affected release and route, investigation and recovery proof. Use the release checklist for rollback; preserve current inventory restrictions and immutable commerce history. Ordinary production mutation and financial transactions are outside these read-only checks.
