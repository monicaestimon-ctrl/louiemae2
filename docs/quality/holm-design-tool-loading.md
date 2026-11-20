# HOLM design-tool loading

Studio, room planning, style quiz and sharing are interaction-loaded tools. Catalog, account entry, saved-product resolution and the project tray stay in the initial HOLM application. Opening a tool requests its module; merely viewing the catalog must not request the design-editor entry.

The extraction preserves original statement order and shared module identity, with the specific correctness fixes below. The floor-plan template initializer travels with its dependent constants. Shared product state remains in catalogStore, not copied into a second module. Existing saved product/variant identities, pack quantities, boards, collages and projects retain their storage keys and are revalidated against current catalog authority. No migration deletes a saved record because a module or product lookup is temporarily unavailable.

## Loading and recovery

The typed DesignTools boundary gives each page a main landmark and descriptive heading while loading. Sharing uses an accessible modal with an explicit close action. The loaded feature owns its ordinary structure; fallback wrappers do not remain around it and do not create duplicate landmarks or nested dialogs.

A failed module request exposes local retry and full-page reload actions without resetting saved state. Reload is necessary when the browser retains a failed ES-module import. Users can navigate back to the catalog while loading is pending. These states must not initiate business commands, image generation, supplier dispatch or checkout.

Pending Studio actions retain their full product/variant identities and any local photo in session storage until Studio consumes them. If the browser cannot save that pending action, reload requires confirmation explaining the potential loss. The storage remains local to the browser tab and is not uploaded as part of recovery.

## Editor correctness and privacy

Hosted board covers and hosted board documents use the same photo-filtered document; local image/PDF downloads keep the original. Story previews refresh when switching between priced and presentation modes. Planner labels use text nodes, including user-entered room names and catalog names. Calibration rejects coincident points and nonfinite scales while preserving the last valid scale.

Still rendering restores live-scene visibility after both traced and raster output, including failures, and disposes temporary renderers, textures and tracers. A render completed after the room or its catalog inputs change is discarded. Shared snapshots retain the captured room document, title, units and exact variant identities; sending a room view to Studio also retains those identities.

## Build and regression gates

The production manifest must identify the editor module as a dynamic entry outside the initial HOLM dependency closure. The deterministic gzip sum of the initial JavaScript closure must be at most 200 KiB. This budget excludes CSS and images and is not a Lighthouse score or a prediction of real network timing.

The local split-module HTTP fixture checks no editor request on catalog entry, delayed loading, navigation away and back, failed loading, reload recovery, the pending selected finish and preservation of a nonempty saved project. It asserts prohibited-command counts before and after reload. Delayed and failed sharing dialogs must close with Escape and return focus to their opener without clearing that project. The usual actual-component HOLM, tray, tools and planner fixtures remain mandatory. App type checks, typed-boundary tests and resource/privacy/scale/revision regressions run in CI. These fixtures mock account/data services, block business commands and do not replace the deferred authenticated production acceptance.

## Scope and release

The extracted legacy editor implementation retains its existing TypeScript suppression. This phase creates typed loading/recovery boundaries and reduces startup cost; strict typing of all Studio and Room internals remains a separate unfinished specification item.

After merge, verify the exact production build, read-only public catalog/account behavior and the deployed chunk boundary. Do not count an empty or unavailable catalog as a healthy shopping acceptance. Measure the fixed production release under the retained Lighthouse profile; preserve all runs. Roll back the code release if tools fail, without deleting saved local or account projects.
