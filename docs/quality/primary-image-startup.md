# Primary-image startup priority

The server document remains visible while its eagerly requested, high-priority primary images load. Application startup waits until first contentful paint and completion or failure of those images. Lazy images do not delay startup.

The existing 1500 ms deadline remains the maximum wait. Keyboard, pointer, click and navigation interaction bypass the wait immediately; a hidden document or unavailable paint API follows the existing immediate-start fallback. Image failure releases the wait rather than leaving the page frozen. Cancellation removes image, interaction, visibility and observer listeners. Startup executes once.

The same behavior applies to all visitors. There is no Lighthouse, user-agent or test-run detection. The purpose is to avoid competing application work during the initial meaningful image load while retaining responsive navigation. No customer content, image quality, delivery or shopping controls are removed.

Unit checks cover paint/image ordering, image failure, lazy-image exclusion, cancellation and interaction/deadline escape. The browser fixture exercises load, failure, user interaction and timeout with a real delayed image response. It controls the deadline so event-release cases cannot pass merely because the ordinary deadline elapsed, and tests deadline release separately. Run the existing visible-startup and navigation fixtures as well. A production build and passing fixtures are not a Lighthouse score: measure the exact deployed commit under the retained repeated-run policy and retain all results.
