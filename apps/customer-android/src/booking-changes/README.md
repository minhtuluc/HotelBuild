# HB-114 — SCR-81/82

Customer Android UI; production HB-097/098 remain separate. API contracts own cancellation money, policy, eligibility, dates and resulting booking state. UI never calculates refund, penalty or reschedule fee.

Resolve the owned booking by code, then GET its detail with a server ETag. Cancellation and date changes always require a server preview followed by a separate confirmation. Confirmation refreshes the preview; changed money/tier/warnings require explicit confirmation again. Cancellation covers the whole booking: no room IDs are invented when the room projection is unavailable.

Date-change quotes require explicit server `channelCode` and `ratePlanCode`; their optional additive projections preserve compatibility. Missing codes block quoting, rather than guessing from IDs. Quotes show the room price and their expiry. The published contract has no reschedule fee projection: the screen states this limitation and does not invent a zero fee or final amount owed. Backend HB-098 must enforce quote binding, current version and final fee rules atomically; this UI proof is not payment or production API acceptance.

An intent is saved to native SecureStore before the command. It contains the key, exact request, ETag and creation time; no PIN, bearer or refresh token. Storage is isolated by server-owned guest/booking/action. Timeout, protocol failure, 5xx and request-in-progress retain the same intent. Retry respects Retry-After; after 24 hours it stops and asks for reconciliation. Reopening the screen restores the intent after authenticated ownership lookup. Corrupt storage fails closed. A definitive failure clears the old intent; failure to clear local storage after a verified receipt does not turn server success into failure.

Offline confirmation is never queued. Recheck connectivity immediately before preview/command. 401/403 remove visible booking/draft/preview; 412/428 require reload and a new preview. Only a response for the expected booking/action and resulting cancellation state or new dates is displayed as success. On unmount, unsubscribe and suppress late UI output; a sent command's persisted intent remains available for reconciliation.

Vitest covers logic and real TCP requests through the published ApiClient, including bearer/If-Match/key/decoder, retries, date/metadata/expiry checks and storage failure. Hermes export proves packaging. These checks do not replace device accessibility/screen smoke; record BLOCKED when no device is available.

Scope decisions: additive BookingSummary code fields plus regenerated OpenAPI are necessary helpers under AGENTS §4. No protected source, locked test, backend implementation, baseline schema or pricing engine is changed. Native controls follow the existing ui-native tokens and React Native components; no new UI package or design-system migration.
