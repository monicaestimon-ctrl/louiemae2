# Trade delivery calculator availability

Calculator settings use the existing recoverable subscription hook, including its bounded loading timeout and explicit unsubscribe/retry sequence. A settings failure remains local to the calculator and does not remove a member's saved projects. Loading is announced with a status region; errors provide a specific local retry button.

Keep three separate states: the feature is disabled, the visitor is not approved for trade, and the approved catalog is exhausted with no eligible products. An empty intermediate page is not proof that no products exist: preserve Load more when a continuation exists. Disable the product selector when there are no choices and keep delivery estimation disabled until a valid selection is present.

These display changes do not enable checkout, expose private prices, approve products or replace server eligibility checks. Isolated tests cover settings failure/retry, loading, disabled and unapproved states, and loading/continuation/exhausted catalog distinctions. Production authenticated acceptance remains a separate check.

Browser regression: 21 isolated cases at 320, 844 and 1440 pixels exercise settings loading, local retry by keyboard, disabled/unapproved membership, first-page loading, more-page exhaustion and empty results. Each asserts zero business commands, no horizontal overflow and no axe violations. Uses built storefront CSS and the real calculator beneath its production heading hierarchy; excludes checkout/quote children, external fonts and real authentication.
