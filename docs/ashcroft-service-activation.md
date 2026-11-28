# Ashcroft Economy service activation

Ashcroft estimates require an approved `per_item` description in `serviceLevel/delivery-curbside`. The existing approved record contains only Zuo ground and LTL descriptions. Adding the separate Economy description removes that missing-description reason; every other price, inventory, destination and checkout gate remains mandatory.

Run `scripts/v2/activate-ashcroft-service.mjs` from the repository root with the private admin-secret file and a **fresh private receipt path**. It defaults to a read-only configuration dry run (authenticated login). Add `--apply` to propose, approve and read back the new version. Never commit either private file. Exclusive receipt creation rejects existing files and links; updates use the same descriptor.

On Windows, use a directory with a verified user-restricted ACL: the POSIX `0o600` mode does not establish Windows privacy. Approval permission is checked before any proposal. The proposal must be exactly one version above the source, and the server rejects approval if a newer version exists.

A timeout or receipt-write error can leave the registry ahead of the receipt. Inspect the decision register and stored values before recovery. Reject an unwanted pending proposal through the decision register; a rejected version still blocks automatic reruns, so recovery requires explicit review rather than deleting history. Before rollback, verify this activation is still the latest version to avoid replacing later edits. The registry list is bounded; a missing source may require a targeted administrative inspection.

The script copies existing service values unchanged and adds only `modes.per_item`. It refuses an existing per-item mode or a newer pending configuration. It rechecks the source before proposing and the proposal before approval. Run with no concurrent configuration editors; these operational checks are not an atomic server compare-and-swap. If interrupted after proposal, inspect the receipt and registry before continuing rather than blindly rerunning.

Source: authenticated October 19 dealer checkout samples recorded in the workspace's `docs/ashcroft-retail-shipping-review.md`, accepted by the owner as working estimates. Economy showed an estimated 5–8 business days. Inside delivery, stairs, assembly and liftgate are not promised. This does not certify all US destinations or individual SKUs.

Version changes invalidate open estimates tied to the prior service record, including Zuo estimates; customers must refresh before checkout. Rollback requires a new approved version with the receipt's `before` value, restoring the missing-service hold for Ashcroft. Do not delete historical versions or alter orders.

This operation does not approve margin targets, acquisition-expense assumptions, trade schedules, prices, publication or payments. Those remain separate qualification work.

## November 27 activation

The authenticated dry run and approver-role check passed. The operation approved a new production service version and read it back successfully, retaining the existing Zuo service values and adding Ashcroft Economy only. The private activation receipt is retained in a restricted local directory outside Git. No product cost, price, publication, order or payment was changed. This completes the missing service-description configuration, not Ashcroft shopping acceptance or full launch.
