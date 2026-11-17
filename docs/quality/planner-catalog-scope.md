# Planner catalog scope preparation

`plannerGeometry(products)` separates typed placement calculations from the legacy global renderer. It receives an explicit read-only product map and provides dimensions, readiness, rotated footprints, wall snapping, floor-plan/block collision checks, placement and layout reflow. Rug geometry is also typed. Saved source/variant IDs and other layout fields survive reflow without mutating the source document.

The existing planner and PDF paths currently bind this factory to the existing catalog map, preserving their behavior. This increment does **not** enable progressive pagination or claim independent saved-room hydration. The next step must resolve saved and seeded identities into a viewer-scoped map, preserve unresolved drafts, bind rendering and export to the same verified scope, and prevent stale asynchronous exports after account changes. Studio/collage exports need the corresponding separation before removing full-catalog startup.

Focused tests check map isolation, live measurement updates, rotation, collision separation, polygon/block exclusions, rug bounds and preservation of saved identities. The production build and existing actual-component HOLM floor-plan/dialog/tool fixtures pass. Those browser fixtures do not certify the complete WebGL renderer or production export journey.

## Keyboard ownership

Studio and room editor global shortcuts now yield to open native dialogs, editable fields and already-handled keyboard events. The walk-through camera clears held movement keys when focus changes or the window loses focus, and removes those listeners on teardown. This prevents a dialog's Delete, arrow or duplicate shortcut from changing the background design.

The actual Studio Share dialog fixture selects a canvas item, sends Delete, ArrowRight and Control+D while the dialog is open, and verifies that the selected element and its geometry remain unchanged before exercising focus trapping and Escape. Focused tests cover dialog and form ownership. Full WebGL interaction verification remains a separate acceptance item.
