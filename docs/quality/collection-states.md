# Collection interaction coverage

Category swimlane headings use native buttons within headings, so keyboard and voice users can activate the same destination as pointer users. Product quick-view buttons include their visible Quick View wording in the accessible name. The active category filter exposes its pressed state. Empty-state decorative glow is clipped independently of form controls, preserving visible focus outlines without horizontal document overflow.

The browser harness exercises the actual StorePage with local, explicitly synthetic catalog responses at 320, 844 and 1440 pixels. It verifies Enter activation of a subcategory heading, selected-filter semantics, forwarding a sort change, continuation from an incomplete page, populated results, preserved products after a later-page failure, true empty results, and unavailable data. Every resulting state receives axe, overflow and page-error checks. Finite entry animations are allowed to finish before contrast inspection; loading behavior is not treated as a successful content state.

The harness does not claim global price ordering, inventory correctness, production pagination, purchasing or subscription proof. Its data source is a local fixture and newsletter submission is prohibited. Do not remove the full-spec collection coverage gate until the live query and source-ordering contracts have independent evidence.

Prepared validation:17 StorePage tests and15 state/device browser cases pass. Original failing reports are retained: mouse-only heading, visible-label mismatch, and mobile/tablet overflow from the decorative glow. An initial readiness assertion incorrectly depended on untransformed text and was corrected to the actual form marker; animation-time contrast findings were investigated after the finite animation settled.

The CI interaction suite runs this harness. The existing newsletter fixture additionally verifies that its close control does not overlap failure text, using the emitted production stylesheet; this is a visual regression check and does not alter newsletter behavior.

Visual review also found a low-contrast selected sort value. It now uses cream text against the dark toolbar and retains the global keyboard outline. The fixture serves real local fonts, blocks external requests and checks the loaded heading font; it does not replace typography with browser fallback fonts.
