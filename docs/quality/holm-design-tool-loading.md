# HOLM design-tool loading

Studio, room planning, style quiz and sharing are interaction-loaded tools. Catalog, account entry, saved-product resolution and the project tray stay in the initial HOLM application. Opening a tool requests its module; merely viewing the catalog must not request the design-editor entry.

The extraction preserves original statement order and shared module identity. The floor-plan template initializer travels with its dependent constants. Shared product state remains in catalogStore, not copied into a second module. Existing saved product/variant identities, pack quantities, boards, collages and projects retain their storage keys and are revalidated against current catalog authority. No migration deletes a saved record because a module or product lookup is temporarily unavailable.

## Loading and recovery

The typed DesignTools boundary gives each page a main landmark and descriptive heading while loading. Sharing uses an accessible modal with an explicit close action. The loaded feature owns its ordinary structure; fallback wrappers do not remain around it and do not create duplicate landmarks or nested dialogs.

A failed module request exposes local retry and full-page reload actions without resetting saved state. Reload is necessary when the browser retains a failed ES-module import. Users can navigate back to the catalog while loading is pending. These states must not initiate business commands, image generation, supplier dispatch or checkout.

## Build and regression gates

The production manifest must identify the editor module as a dynamic entry outside the initial HOLM dependency closure. The deterministic gzip sum of the initial JavaScript closure must be at most 200 KiB. This budget excludes CSS and images and is not a Lighthouse score or a prediction of real network timing.

The local split-module HTTP fixture checks no editor request on catalog entry, delayed loading, navigation away and back, failed loading, reload recovery and preservation of a nonempty saved project. Delayed and failed sharing dialogs must close with Escape and return focus to their opener without clearing that project. The usual actual-component HOLM, tray, tools and planner fixtures remain mandatory. App type checks and typed-boundary unit tests run in CI. These fixtures mock account/data services, block business commands and do not replace the deferred authenticated production acceptance.

## Scope and release

The extracted legacy editor implementation retains its existing TypeScript suppression. This phase creates typed loading/recovery boundaries and reduces startup cost; strict typing of all Studio and Room internals remains a separate unfinished specification item.

After merge, verify the exact production build, read-only public catalog/account behavior and the deployed chunk boundary. Do not count an empty or unavailable catalog as a healthy shopping acceptance. Measure the fixed production release under the retained Lighthouse profile; preserve all runs. Roll back the code release if tools fail, without deleting saved local or account projects.
