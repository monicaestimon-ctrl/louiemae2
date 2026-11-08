# Evidence log: production build v2

Add one row per acceptance test, golden test, migration parity check or release gate (format in [04](04-acceptance-tests.md) §3). Never delete rows. If a result changes, add a new row. Result values: PASSED, FAILED or BLOCKED (with a reason).

| Test ID | Env | Code commit | Config versions | Expected | Observed | Result | Evidence link | Date | By |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BASE-01 | local | 0845358 | n/a | Existing checks pass on the starting head | lint 0 errors; type-checks pass; catalog writers pass; 858 tests / 137 files pass; build passes | PASSED | CI-equivalent local run | 2026-11-08 | agent |
| PHASE-B-LOCAL | local | Phase B PR | seed v1 | All checks pass with every v2 flag off (G12) | 889 tests / 141 files pass; append-only check passes | PASSED | Phase B PR checks | 2026-11-08 | agent |
| MIG-DEV-01 | dev | Phase B PR | seed v1 | Seed + dry-run backfill on the dev deployment | Not run: deploying a branch to the dev deployment was not permitted from the agent session | BLOCKED (permission) | n/a | 2026-11-08 | agent |
| MIG-IDENTITY-01 | dev | | n/a | Dry-run counts equal holmProfiles counts | | | | | |
| MIG-LEDGER-01 | dev | | n/a | Legacy commission and credit sums equal v2 opening projections | | | | | |
| ZUO-DRYRUN-01 | dev | | | Cohort counts 865/803/306/135/296/66/62/226/639 | | | | | |
| GATE-1 … GATE-5 | | | | See 05 §2 | | | | | |
