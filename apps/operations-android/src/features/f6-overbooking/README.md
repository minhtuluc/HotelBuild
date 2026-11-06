# HB-139: SCR-67 overbooking alerts and SCR-63 room change (operations Android)

Thin screens over the published HB-120 routes; no new endpoint, contract or dependency. Entry is the deep link
`pinehill-operations://alerts` (SCR-67) which opens `relocation?caseId=…&bookingId=…&bookingRoomId=…&moveId=…` (SCR-63).

- **Session**: `app/(f6)/*` boots its own `Session` from the refresh token that the auth module keeps in secure storage
  (`boot.native.ts`: `silentRefresh` + `profile`); F6 stores nothing. Home/menu and `app/index.tsx` are untouched, so a shell
  button to `/alerts` is **BLOCKED on the lead** (shared file).
- **Roles** (explicit table, never inherited): MANAGER/OWNER read cases and the full ranking and approve; FRONT_DESK reads
  only `GET /overbooking-alerts` and `GET /bookings/{id}/relocation-options` for the booking in hand, creates and executes.
  A button needs both the role table and the server `allowedActions`.
- **Android scope**: steps 1–2 only (`SAME_TYPE_SAME_PROPERTY`, `UPGRADE_SAME_PROPERTY`); other steps, merges, walk-out,
  exceptions go to web (SCR-44/45/46/47). Step 3 is shown as unavailable with the server's distance note.
- **Writes** (`MoveWriter`): online only, never queued; one `Idempotency-Key`, body and `If-Match` per intent kept in RAM
  until a definite answer; unknown outcomes retry the same intent or look it up by `writeIntent`; older than 24 h is looked
  up first. `pinToken` goes in the body (not via the shared client, which would replay the 401 of a wrong PIN) and lives only
  in the writer; it is dropped after any definite answer, on cancel, reset (session/property change) and dispose.
- Only `EXECUTED` from the server is shown as done. Target taken / consent withdrawn / 412 keeps the source and the case
  open, re-reads the options and never tries another step.

## Not done / BLOCKED

- Loss of benefits (balcony, connecting room, capacity) is not in the HB-120 contract: the screen says so and shows only
  the target room, price lock and server amounts.
- `relocation-plan` (POST) stays on web; managers see the case detail ranking and ladder from `GET /overbooking-cases/{id}`.
- Maestro scenarios in `tests/maestro/f6/hb139/` are written but **not run**: no runner/device here. Tap count is 6
  (ceiling ≤6, design target ≤5 missed by one: open, pick, consent, create, execute, confirm PIN).
- Lookup by key after an unknown _create_ needs `GET /bookings/{id}/relocation-options?idempotencyKey=` (used).
