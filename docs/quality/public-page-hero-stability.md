# Public-page hero stability

The November 17 controlled audit (`44063304814`, production `d751702a`) retained all 100 runs. Accessibility, Best Practices and SEO scored 100 throughout. Shop/story performance failed in part because their generic server document was replaced by a differently positioned interactive hero. The raw layout-shift scores reached approximately 0.43–0.46. Interactive readiness also failed in several runs; those runs remain invalid regardless of their scores.

This increment aligns the initial shop/story headline and hero geometry with their interactive counterparts, reserves known story-image dimensions, and displays first-viewport content immediately. It keeps later section animations. The source document occupies normal flow, and the pending application remains positioned behind it until handoff. Initial CSS reserves the scrollbar gutter before the deferred dialog stylesheet arrives.

The story hero now advertises its actual maximum display width of 384 CSS pixels. Two additional 640/800-pixel WebP derivatives come directly from the existing `fam2.png`, without cropping or enlargement; the original and 640-pixel output were visually compared. The brand-image generator includes those widths for reproducibility. Unknown image sources still pass through the existing safety checks.

The route health fixture expects the actual rendered `THE ORIGINS` label. Browser inspection confirmed CSS uppercasing changes `innerText`; readiness, visibility, outage and console-error checks remain unchanged. A later ready marker cannot rescue a failed audit.

Early local diagnostics after geometry correction retained zero layout shift in all four shop/story mobile/desktop runs, with performance 89/99 and 88/100 respectively. One story-mobile run still failed interactive readiness. These Windows diagnostic results use a different runner from controlled production and do not establish release acceptance. Further latency/first-paint optimization, complete server/client content parity, and repeated healthy production measurements remain outstanding.

Final browser checks at 390/1440 CSS pixels, with and without JavaScript, show identical headline and hero rectangles in each corresponding pair, zero axe violations, no horizontal overflow and no page errors. A small shop-mobile shift of 0.0158 remains outside the matched hero; story runs recorded none. This is a functional browser check, not controlled five-run acceptance.
