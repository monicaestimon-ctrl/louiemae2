# Parcel dimensional rounding

Modeled parcel configurations can explicitly declare `dimensionalRounding: { unit: 'inch', divisorIn3PerLb: 139 }`. This matches the retained FedEx planning evidence: round each edge up to a whole inch, multiply those rounded edges, divide by the source's cubic-inch-per-pound divisor, then round dimensional pounds up. Chargeable weight is the greater of dimensional and actual pounds, calculated separately for every carton.

Retain the applicable [FedEx Service Guide](https://www.fedex.com/content/dam/fedex/us-united-states/services/Service_Guide_2026.pdf), rate tables and dated surcharge observations with the private model packet. The configurable divisor is evidence-bound, not a universal value for every carrier or account.

For example, a 257 × 257 × 257 mm carton has three edges just above ten inches. With divisor 139, its rounded dimensions produce ten billable pounds. Using unrounded metric volume would produce eight. Two cartons are never averaged into one rate band.

The rounded dimensions must also fit the approved model's length, second-edge, girth and volume limits. A missing weight band or a package outside that envelope requires a quote. Supplier-marked LTL, unknown methods and unsupported destinations keep their existing quote behavior. Integer and bigint arithmetic prevent boundary comparisons from drifting.

The carrier rule's optional `ground.maxBillableWeightG` limits the final rounded chargeable weight as well as metric classification. Each carton's final pounds are compared with that gram cap using the exact conversion of 453.59237 grams per pound. This applies to both inch-based and legacy metric pricing. A carton that crosses the cap after rounding requires a quote, even when a rate-table band exists; multiple individually supported cartons are not summed against a per-carton cap.

The optional field preserves existing metric-model configuration semantics. Refreshing a source-backed FedEx model should explicitly include the rounding policy; adding this code does not activate, renew or replace a production configuration. The source table, rounding rule, model limits and effective dates form one versioned input to delivery estimates.

Stored dimensions use integer millimeters. Where ingestion rounded an original inch measurement upward to millimeters, the model can conservatively round into an additional inch. Do not subtract an assumed tolerance to make a carton fit: preserve the supplier's precise source measurements for a future precision migration or obtain a quote. These are planning estimates, not guaranteed carrier invoices.

Verification covers fractional and exact-inch edges, actual weight taking precedence, independent cartons, rounded-envelope rejection, missing weight bands, malformed rounding policies and unchanged legacy metric behavior. Existing checkout tests cover the surrounding delivery lifecycle.

The checkout engine, admin coverage list and monitoring now resolve modeled ZIP lanes through one shared rule. An explicit five-digit map takes precedence even when it is empty or lacks the requested ZIP; it never falls back to broader three-digit coverage. The admin labels exact ZIPs separately from prefix lanes, while rollout controls still apply to their three-digit prefixes. Monitoring uses the configuration version captured by the estimate.
