# Importing reviewed supplier photographs

The deployment-admin-only `catMediaProcessing:prepareReviewedSource` action prepares current Zuo photographs that were reviewed from a downloaded supplier image workbook but do not yet have a stored original. It is not exposed as a customer action and does not publish a product.

Each invocation requires the current variant ID, exact supplier SKU and pieces per pack, supplier image URL, SHA-256 of the reviewed image bytes, workbook SHA-256 and visual-review manifest SHA-256. Retain the actual workbook, review manifest and downloaded image privately with the import results; hashes alone do not replace these records.

The action accepts HTTPS images from the supplier's Salsify image host. Redirects pass the existing safe-fetch host validation. Source bytes must match the reviewed hash and pass the image decoder, minimum dimensions and maximum pixel limits. Outputs use the existing responsive WebP pipeline without upscaling. Originals have a 20 MiB limit.

The current product must remain an included Zuo product, with the same variant SKU and pack and without discontinued status. The action checks this before download, after preparation and at insertion. A rejected or ambiguous existing media association requires reconciliation. Exact retries reuse the existing original and derivatives. An interrupted import with an original but no derivatives resumes without replacing its rights evidence. Confirmed redundant derivative uploads are deleted; an uncertain mutation result retains files for reconciliation rather than risking deletion of committed media.

New assets remain pending and retain source/review hashes in their evidence reference. The action does not grant image rights, remove qualification holds, change stock or prices, create listings or enable checkout. After successful preparation, apply the separately recorded visual decisions through the existing reviewed-photo workflow and verify the resulting assets and remaining holds. A supplier photo that contradicts its SKU description remains under review even when its URL matches the workbook.

## Rollout and verification

Deploy the reviewed backend revision before invoking the action. Process a small initial batch, read back the exact variant/hash/source associations, then continue with bounded concurrency and persistent per-item results. Retry only failed or incomplete items. Keep source documents and production identifiers outside Git.

Regression tests cover unchanged variant eligibility, exact retry reuse, partial-import recovery, retained rights evidence, changed image bytes, mismatched SKU/pack, discontinued products, disallowed hosts and a SKU identity change while downloading. Publication and payment flows are not exercised by this import.
