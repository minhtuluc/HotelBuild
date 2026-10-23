# HB-154: SCR-59 collect balance, SCR-60 departures, SCR-61 check-out (operations Android)

Thin screens over the published API; no new endpoint, contract or package change. Stacked on HB-153 (`src/arrivals/**`).

- **SCR-60** lists `GET /bookings?status=CHECKED_IN` stays whose `checkOut` is today (Vietnam calendar day from the device clock, only a list filter) **or earlier**, so late guests are not hidden. The last list lives in the reader (RAM, per screen) and is shown as stale with its sync stamp when a refresh fails; never for another property/day; dropped on 401/403.
- **SCR-61** posts `POST /front-office/check-out` (🔒 PIN, idempotent). The server computes the late/early fee from its business clock and ignores `lateCheckOut`, so the screen sends `lateCheckOut:false`, prefills `earlyCheckOut` from the stay dates (the server rejects a mismatch, BR-CANCEL-09) and shows the fee/extras/balance **returned by the server after completion**. HB-210: before confirming it also shows the server's **non-binding preview** (`POST /front-office/check-out/preview`, HB-209: `feeAmount`, `extrasAmount`, `balanceDue`, computation time), reloaded whenever the "early" toggle changes; no number from the previous selection is ever kept, offline/failed previews say "chưa có số … không phải 0 ₫" and never block the PIN flow or the command.
- **Unsettled balance** (BR-FO-05): the server records the late-fee obligation and refuses with `422 E_PAY_AMOUNT_MISMATCH`. The screen then reads `GET /bookings/{id}/balance` and shows that server number, then offers **Thu số dư**; after collecting, the clerk reopens the card and confirms again.
- **SCR-59** posts `POST /payments` with `type: BALANCE`, `CASH` or `BANK_TRANSFER` only (no card data, BR-PAY-04). The amount is prefilled and capped by `balanceDue` from the server; the server still verifies it (BR-PAY-01/02). It is reachable from SCR-58 (`onCollectBalance`) and from SCR-61.
- **PIN** (`PinnedWriter`): `pin/verify` bound to the booking through a pinned single-attempt client (the shared session client would refresh-and-replay the 401 of a wrong PIN and double-count it toward the 3-attempt lockout); `pinToken` goes in the body per contract, lives only in the writer, and is dropped after any definite answer (success, rejection, `E_AUTH_PIN_REQUIRED`). An unknown outcome keeps token + `Idempotency-Key` + body so the retry replays the same command. Offline: nothing is sent or queued (QĐ-03 decision 6).
- `watchContext` ignores silent token refreshes (they also notify `Session` subscribers) so an open form/PIN is not wiped; only login/logout and property change reset.

## Not done / BLOCKED

- Extra charges at check-out (`extras`, design 5.2 "Thêm phụ thu"), VNPAY/MOMO at the counter and receipt/invoice printing (design SCR-59/61): not in this slice (the counter API only takes cash/transfer; no print integration).
- The preview route was merged after this client was written; tests use a fake `fetch` built on the published contract (not yet run against a real API).
- Device run of TalkBack and the Maestro scenarios (`tests/maestro/hb154-*.yaml`): no device available.
