# CJ Pricing Implementation Checklist

## Goal

Replace category-only shipping estimates with an auditable pricing flow that uses confirmed CJ product cost and confirmed CJ freight/fee data whenever CJ provides it.

## PR 1: Product Pricing Foundation

- [x] Add shared pricing engine with one source of truth for estimates, landed cost, charm rounding, margin, and profit math.
- [x] Add product pricing fields for confirmed CJ product cost, confirmed CJ shipping, fees, landed cost, suggested retail price, pricing source, warnings, and admin price lock.
- [x] Add pricing audit table to record every estimate/confirmation recalculation.
- [x] Preserve the existing pre-sourcing estimate formula for products that are not linked to CJ yet.
- [x] Capture CJ catalog variant sell price as confirmed product cost after sourcing/catalog verification.
- [x] Call CJ freight calculation after a product has a CJ variant ID.
- [x] Store confirmed freight, taxes, clearance, and logistics name when available.
- [x] Recalculate suggested retail price from confirmed landed cost.
- [x] Do not silently overwrite an admin-edited/locked product price.
- [x] Show pricing breakdown and warnings in the admin product editor/import review.
- [x] Add unit tests for pricing math.
- [x] Run type-check, tests, lint, and production build.
- [x] Run CodeRabbit CLI review and fix actionable issues. Note: `coderabbit review --agent -t uncommitted` timed out after 10 minutes with no findings returned.
- [x] Open ready-for-review GitHub PR, address review comments, and merge to main.

## PR 2: Order-Time Reconciliation

- [x] Quote CJ freight with the actual customer destination before forwarding a CJ order.
- [x] Use the selected/quoted logistics name instead of a hardcoded shipping method when possible.
- [x] Store order-level CJ product cost, shipping, service/tax/clearance fees, landed cost, customer shipping collected, and profit estimate.
- [x] Flag orders where actual CJ cost differs materially from product-level assumptions.
- [x] Add admin order visibility for reconciliation warnings.
- [x] Protect checkout success flow from CJ quote failures while preserving admin retry data.
- [x] Add tests for order-level pricing/reconciliation helpers.
- [x] Run type-check, tests, lint, and production build.
- [x] Run CodeRabbit CLI review and fix actionable issues. Note: PR-relevant findings in changed pricing/CJ files were addressed; unrelated repo-wide findings were left out of scope.
- [x] Open ready-for-review GitHub PR, address review comments, and merge to main.

## PR 3: Conservative Shipping Buffers and Checkout Tiers

- [x] Update category-level pre-confirmation shipping estimates to the audited Louie Mae buffers: fashion $22, kids $22, decor $69.99, furniture $120.
- [x] Use the category buffers only for internal product pricing estimates until confirmed CJ freight or an admin override exists.
- [x] Add a shared checkout shipping tier helper for full-cart subtotal pricing.
- [x] Replace customer checkout shipping choices with one Standard Shipping rate based on cart subtotal.
- [x] Use $49.99 through $199.99, $69.99 from $200 through $348.99, $89.99 from $349 through $499.99, and $99.99 from $500 upward.
- [x] Keep CJ destination/product-specific freight verification separate from the customer-facing fixed shipping rate.
- [x] Add tests for category buffers and checkout subtotal tier boundaries.
- [x] Run type-check, tests, lint, and production build.
- [x] Run CodeRabbit CLI review and fix actionable issues. Note: `coderabbit review --agent -t uncommitted` timed out after 10 minutes with no findings returned.
- [ ] Open ready-for-review GitHub PR, address review comments, and merge to main.
- [ ] Confirm main deploys and user can test production checkout.

## Done

- [x] Main contains product-level confirmed landed-cost pricing.
- [x] Main contains order-level actual-destination reconciliation.
- [x] Admins can see how a price was calculated and when it needs review.
- [x] Existing manual prices are not overwritten without explicit admin action.
- [ ] Main contains audited category shipping buffers and checkout subtotal shipping tiers.
- [ ] User has been notified that production is ready to test.
