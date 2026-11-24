## Phase 6l — reviewed Zuo source photos

Adds an internal admin-CLI route to apply completed external visual reviews. Each row binds the exact variant, SKU, pack quantity, source URL and SHA-256 to one existing hero asset. The batch carries hashes of the review manifest and supplier image workbook. It supports dry runs and safe identical retries, rejects discontinued products, rejected/unavailable images and ambiguous associations, and uses the same exact-variant verification routine as the admin screen.

Only MEDIA_MISSING is resolved. Media rights, stock, expense, delivery and publication gates remain independent. No storefront switch or listing is activated by a visual review. Supplier files and review manifests remain private operational artifacts.

Validation: catalog integration suite (41 passed, one optional packet test skipped), backend TypeScript and changed-file lint; CI verifies the complete repository before deployment.
