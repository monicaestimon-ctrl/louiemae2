# Planner catalog scope preparation

`plannerGeometry(products)` separates typed placement calculations from the legacy global renderer. It receives an explicit read-only product map and provides dimensions, readiness, rotated footprints, wall snapping, floor-plan/block collision checks, placement and layout reflow. Rug geometry is also typed. Saved source/variant IDs and other layout fields survive reflow without mutating the source document.

The existing planner and PDF paths currently bind this factory to the existing catalog map, preserving their behavior. This increment does **not** enable progressive pagination or claim independent saved-room hydration. The next step must resolve saved and seeded identities into a viewer-scoped map, preserve unresolved drafts, bind rendering and export to the same verified scope, and prevent stale asynchronous exports after account changes. Studio/collage exports need the corresponding separation before removing full-catalog startup.

Focused tests check map isolation, live measurement updates, rotation, collision separation, polygon/block exclusions, rug bounds and preservation of saved identities. The production build and existing actual-component HOLM floor-plan/dialog/tool fixtures pass. Those browser fixtures do not certify the complete WebGL renderer or production export journey.

## Keyboard ownership

Studio and room editor global shortcuts now yield to open native dialogs, editable fields and already-handled keyboard events. The walk-through camera clears held movement keys when focus changes or the window loses focus, and removes those listeners on teardown. This prevents a dialog's Delete, arrow or duplicate shortcut from changing the background design.

The actual Studio Share dialog fixture selects a canvas item, sends Delete, ArrowRight and Control+D while the dialog is open, and verifies that the selected element and its geometry remain unchanged before exercising focus trapping and Escape. Focused tests cover dialog and form ownership. Full WebGL interaction verification remains a separate acceptance item.

## Studio geometry boundary

`studioGeometry(products)` now owns cutout availability, image/frame aspect ratios, measured room-photo scaling and manual width fallback. Its explicit read-only map keeps the editor and future export scopes independent from browse pagination. The current legacy caller still binds it to the browse map; this preparation does not yet enable independent Studio hydration or pagination.

Tests verify independent catalog scopes, refreshed measurements, missing scale/catalog fallback, uploaded-photo frames and product-cutout geometry. Shared global render/export helpers still need explicit verified identity and variant scopes before the all-catalog startup dependency can be removed.


## Independent editor and export connection

Studio, planner, saved boards and shared-board recipients now resolve exact source/variant selections outside the browse page. Layouts and saved pins retain unresolved references. Pending, conflicted, withdrawn and measurement-incomplete planner rows require review; they are not silently removed or replaced by a default option.

New editor selections persist source and variant IDs. Copies are grouped by exact identity and visibility. Studio/3D synchronization retains matching placements and treats two options as separate pieces. Geometry, asset rendering, piece lists and project additions use the same verified map. Variant-specific images cannot inherit a default option's responsive-image metadata, cutout or 3D model. Shared/PDF/story exports use selection keys, and asynchronous export/download guards reject catalog changes and unmounted share dialogs. A pending independent lookup removes sharing controls while preserving the composition.

The actual-component synthetic fixture covers two off-page options, their prices/minimums, board organization, Studio additions, local PNG export, shared-board additions, pending guards and Studio → 3D → Studio continuity. It submits no production commands. Earlier failed fixture attempts are retained: a toast obstructed a click and a test used the wrong image-button capitalization; corrected interaction/label checks passed. Three editor test families plus the planner dialog fixture cover geometry, exact selection grouping, unavailable options and keyboard behavior.

This is not the first-page cutover: server-wide browse filtering/sorting, controlled repeated performance acceptance and the remaining full-spec release evidence are still outstanding. Local fixture success is not production commerce qualification.
