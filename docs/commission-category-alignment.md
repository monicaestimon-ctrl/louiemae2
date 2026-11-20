# Category alignment for legacy commission calculations

New legacy calculations derive product type from the product's navigation category, then its broader collection when the category is unmapped. Supplier identity no longer forces Ashcroft or owner-managed lighting, mirrors and other recognized décor into furniture. Lighting is décor even when the collection is Furniture. A material description such as light oak dining table is furniture, not lighting.

This change does not rewrite earned commission rows. Existing line category, rate and original amount remain recorded; duplicate payment events return the existing commission, and later refunds apply to its recorded amount. Regression coverage demonstrates a furniture commission remains furniture after the product is reclassified while a subsequent lighting commission uses the décor rate.

The mapping helper is a legacy compatibility path. Unmapped legacy records retain their prior furniture fallback; it does not certify an unknown category as reviewed or approve referral eligibility. The v2 category workflow still requires explicit reviewed metadata and holds unresolved categories. Complete that record audit separately before claiming every catalog product is classified and referral eligible.

This phase does not replace legacy margin caps, change the published tier percentages, approve supplier evidence, activate new commissions or enable payouts. The v2 eligibility and ledger cutover remain separate release requirements.

The owner preview and deployment-admin-only `catCategories.inspect` share a bounded, paginated read-only audit. It compares the proposed category with existing explicit metadata when present, so a stale explicit Furniture label on lighting remains visible even after the legacy mapping changes. Inspection never approves a proposal or changes catalog, pricing, or commission records.
