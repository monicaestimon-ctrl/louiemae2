# Legacy trade offer cost floor

A legacy trade offer must have a positive, integer supplier/landed cost and a retail price that can fund the existing calculated floor. An invalid or missing source-currency conversion does not silently become 1:1. When cost is missing or the floor exceeds retail, the pricing helper returns the unavailable sentinel and customer catalog/identity reads omit the variant. Authoritative quote creation uses the same guard, including requests created from an older browser or saved project.

Project discount calculation rejects invalid quantities, unsupported totals and a line whose required floor already exceeds its offered price. It never silently reduces a required floor to make an offer appear funded. The guard does not change the existing legacy discount percentages, and it does not apply that schedule to approved Zuo v2 prices.

The owner-only legacy pricing diagnostic explicitly includes these held rows, including unavailable-stock variants. Availability is flagged separately, so their diagnostic prices are not represented as current offers. Zuo remains exclusively on its v2 authority path. It displays unavailable trade/project prices and no fabricated percentage margin. Records and historical paid orders or earned commissions are retained. A held variant is not deleted merely because it cannot currently fund a new offer.

This is a calculation and eligibility correction, not a complete cost audit. The legacy floor includes its existing landed-cost and processing assumptions; it does not prove current supplier evidence, all overhead/returns/commission expenses, shipping coverage or the approved v2 contribution floor. Those remain distinct qualification requirements. Do not activate checkout or advertise an approved margin on the strength of this guard alone.

Validation includes unknown/noninteger costs, a floor above retail, actual funded pricing, project floors and totals, catalog withdrawal, saved-identity resolution, authoritative quote rejection without creating a project, and owner-only visibility of held records. Existing credit, historical commission and identity tests must continue to pass.
