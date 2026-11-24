# Collection early-access forms

The two empty-category subscription forms now share `CollectionSignup`. Both have persistent email labels, email autocomplete and native validation, visible keyboard focus, and an associated live status message. Inputs and confirmation text use readable colors; the field has an opaque background.

Pending submissions cannot be duplicated. A resolved successful subscription clears the address and announces the requested category. A rejected or unconfirmed subscription preserves the address and permits an explicit retry. No browser alert claims that a transport failure means the visitor is already subscribed. The provider's existing behavior merges tags for existing subscribers and acknowledges that successful update.

Category tags and the existing subscription boundary are unchanged. A category change remounts the form so feedback from one category is not shown as confirmation for another. Tests cover failure, retry, confirmation, concurrent submission protection and separate form associations. The browser fixture checks native validation, keyboard submission and retry, axe and horizontal overflow at 320, 844×390 and 1440 pixels. It stubs subscription commands locally and submits no real email addresses to production.
