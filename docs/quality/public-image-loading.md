# Fashion and Story image loading

The retained public audit identified mobile LCP variability on Fashion and Story. This change reduces bytes for the exact source-owned images rather than substituting a lightweight test page or concealing catalog content.

The Fashion dress category image now has immutable AVIF renditions derived from its original source, with its existing WebP fallback. At 480 pixels the AVIF is 19,817 bytes. Story's original family image has a new quality-40 AVIF version; at 640 pixels it is 42,940 bytes, compared with the prior 55,052 bytes. Existing immutable image files remain available. Recipes, source hashes and rendition hashes are recorded in the separate provenance files and verified in CI.

Collection category pictures share the same component between the initial server document and React. They use native format selection, high priority for the first image, WebP recovery on AVIF failure and a decorative placeholder when both fail. Source changes reset retry state. Category links and labels remain usable even when imagery fails. Without JavaScript, the existing WebP source is used.

Do not add an unconditional AVIF preload or preload the competing WebP fallback. Browser regression testing found that a format-specific preload could fetch an unused AVIF when decoding was disabled. The initial picture and its high-priority image select the supported format directly. Unchanged images without an AVIF alternative retain their existing preload behavior.

The collection browser fixture exercises three viewport widths, both small and larger category layouts, supported and disabled AVIF, failed AVIF, total image failure and JavaScript disabled. It verifies a single healthy image request across the source-document/client handoff. The existing Story fixture covers format fallback, corruption, absent media, JavaScript disabled and preserved dimensions. These are local functional checks, not Lighthouse results.

After deployment, retain a new audit against the exact release and all required healthy-content checks. Smaller files alone do not establish a Performance score of 100 or full commerce acceptance.
