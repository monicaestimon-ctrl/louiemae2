# Evidence log: production build v2

Add one row per acceptance test, golden test, migration parity check or release gate (format in [04](04-acceptance-tests.md) §3). Never delete rows. If a result changes, add a new row. Result values: PASSED, FAILED or BLOCKED (with a reason).

| Test ID | Env | Code commit | Config versions | Expected | Observed | Result | Evidence link | Date | By |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BASE-01 | local | | n/a | Existing checks pass on the starting head | | | | | |
| MIG-IDENTITY-01 | dev | | n/a | Dry-run counts equal holmProfiles counts | | | | | |
| MIG-LEDGER-01 | dev | | n/a | Legacy commission and credit sums equal v2 opening projections | | | | | |
| ZUO-DRYRUN-01 | dev | | | Cohort counts 865/803/306/135/296/66/62/226/639 | | | | | |
| GATE-1 … GATE-5 | | | | See 05 §2 | | | | | |
