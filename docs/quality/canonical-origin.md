# Canonical public origin

Anonymous HTTP checks on November 17, 2026 confirmed that the bare domain returns a 307 redirect to `https://www.louiemae.com` for both the home and shop paths. The www endpoints return 200. Public canonical URLs should identify that final destination, rather than point at an address that immediately redirects.

`STOREFRONT_ORIGIN` in `lib/productMetadata.ts` is the shared origin for client metadata, product/collection/editorial server documents, social-preview handlers and generated journal share URLs. The static home metadata, robots sitemap reference and current static sitemap use the same origin. Existing absolute supplier/image source URLs and referral identity rules are unchanged.

Verification covers API output, product and journal metadata lifecycle, unbundled Node handler imports, and real-browser journal navigation/recovery. After deployment, verify canonical and structured URLs at the final public origin. This correction does not complete dynamic sitemap coverage, redirect all historical links, or change Vercel domain configuration.
