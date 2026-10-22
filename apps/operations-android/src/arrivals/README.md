# HB-153: SCR-57 arrivals list and SCR-58 check-in (operations Android)

Thin screens over the published API; no new endpoint, contract or package change.

- `GET /bookings?from=today&to=today` (+ `GET /rooms?status=ACTIVE`) feed the list; `POST /front-office/check-in` confirms. `today` is the Vietnam calendar day from the device clock and is only a **list filter**: the date/23:59/08:00/14:00 gates, debt thresholds and room readiness stay on the server (ADR-018, engine HB-141). The confirm button is never greyed by client-side money or state rules; the server's code and reason are shown verbatim.
- Rooms: the first `roomCount` ACTIVE rooms of the booking's type (by code) are **preselected** so a one-room check-in is open-card → confirm. This is only the form's initial value; there is no published API for pre-assigned or occupied rooms, so the server rejects unready/occupied ones and the clerk changes the selection.
- Offline (QĐ-03 decision 6, design 8.1/8.3): the last successful list is kept **in RAM only** (`ArrivalsCache`) with the device's sync stamp and shown as stale with the reason. No cache for another property/day; 401/403, logout and token loss drop it. Check-in is never sent, queued or reported as success while offline. Persisting the list across app restarts is not done: storage, TTL and encryption of PII are still OPEN-02.
- Idempotency: one `Idempotency-Key` per intent, kept in RAM until a definite answer; an unknown outcome (timeout, network after send, 5xx, mismatching response) retries with the same key and body. After an app restart the clerk reloads the list; a booking already `CHECKED_IN` is simply no longer an arrival.

## Not done / BLOCKED

- QR camera: needs an Expo camera dependency (not installed; package/lock files were out of scope). `QrScanner` + `resolveScan` are in place and tested; `ArrivalsScreen` takes `scanner` and defaults to `unavailableScanner`, so the button explains and the manual code filter keeps working. Wiring is one `scanner-factory.native.ts` plus one prop in `app/index.tsx`. The QR payload format is not specified in the docs; the parser accepts a bare `PH-YYMMDD-XXXXX` code or a string containing one.
- Guest name / tier / arrival time on the card: `BookingSummary` carries `guestId` only and there is no `GET /guests/{id}`; the card shows code, status, stay, party size and server-provided amounts instead.
- "Collect balance" (SCR-59) is HB-154: `onCollectBalance` is an optional prop, the button appears only when the parent passes it (not wired yet).
- Device run of TalkBack, camera permission and the Maestro scenarios (`tests/maestro/hb153-*.yaml`): no device available.
