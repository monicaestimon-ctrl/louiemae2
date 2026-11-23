# Ashcroft selling-unit economics

This phase adds Ashcroft to the internal pricing simulator, current approved-price qualification and price-approval service. It does not publish canonical Ashcroft offers, change legacy storefront prices, enable trade checkout or approve production evidence/settings.

## Required inputs

The exact supplier/product/legacy-variant/SKU identity and selling-unit quantity rules must match. Cost must belong to that variant, be current and verified, use explicit `selling_unit` wholesale, and include all duties, inbound freight and supplier fees as known amounts or confirmed zero. Applicable MAP must have an explicit selling-unit basis. Unknown MAP applicability, stale costs, conflicting sources, missing category or a Zuo margin policy require review.

The independent `pricingAssumptions/ashcroft-pricing-assumptions` record contains `supplierCode: ashcroft`, `wholesaleUnitBasis: selling_unit`, supplier reserve, processing, returns and overhead basis points, explicit handling and fixed-processing allocations per selling unit, and `fundedTradeDiscountBps`. Zuo's piece handling and size allowance fields are rejected. No default settings or fee approvals are installed by this code change.

An approved Ashcroft entry in `trade-discount` and an applicable assigned margin policy are required. `fundedTradeDiscountBps` is an explicitly promised reduction, not the generic maximum. Zero permits actual approved trade prices without forcing retail to finance a universal 25% reduction. Actual price publication and project-discount eligibility remain separate gates.

Where a current approved retail price exists, the base trade price also respects the schedule's maximum permitted reduction. Additional project reductions remain a separately authorized calculation; this base-price check does not grant them. Lighting metadata must already be reviewed as décor through the audited category workflow, preserving the history needed for protected referral rates.

## Calculation

All amounts use exact rational cents until the final cent rounding. A set sold as one selling unit has one wholesale charge.

- Net customer delivery contribution = customer delivery charge × (1 − processing rate).
- Merchandise-funded freight = max(0, retained modeled freight − net customer delivery contribution).
- Base cost = wholesale × (1 + supplier reserve) + verified extra costs + handling + fixed processing allocation + merchandise-funded freight.
- Trade floor = max(selling-unit MAP, base cost ÷ (1 − processing − returns − overhead − target margin)).
- Retail floor funds its protected commission rate and any explicitly promised trade reduction; round up once to cents.

Delivery revenue above modeled freight cannot subsidize unrelated merchandise costs or manufacture referral margin. Retail and trade scenarios are separate; trade carries zero referral commission. A simulation candidate is marked unapproved and cannot satisfy sale qualification. Existing approved prices are recomputed against current evidence before qualification.

Cost/MAP observations are read separately from stock observations. Oversized required cost history returns a review error instead of silently truncating it. Scenario records retain the actual supplier engine version and source/configuration hash. New Ashcroft price records label their information amount as selling-unit rather than physical-piece pricing. Historical records remain unchanged.

## Verification and remaining integration

Tests cover independent freight funding, rounding boundaries, MAP, explicitly funded discounts, missing expenses/basis, stale and conflicting costs, proposed settings, supplier identity, lighting, actual channel approval, cost increases and unchanged legacy listings. No real payments or orders are used.

The following phase must connect qualified offers to explicit publication provenance, retained customer variant URLs, supplier-specific inventory reservations, project pricing, basket/tax/credit revalidation and checkout. In particular, do not run an approved final merchandise price through the old `launchPrice` gross-up again. Per-SKU economics alone does not prove a paid basket or activate production.
