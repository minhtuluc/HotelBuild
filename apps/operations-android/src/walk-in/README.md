# HB-157: SCR-65 walk-in booking (operations Android)

Thin screens over published routes only (`GET /room-types`, `POST /walk-in`, `POST /auth/pin/verify`, `POST /payments`); no new endpoint, contract or package change. Entry: Home → "Tạo booking khách vãng lai".

- **Five steps** (`WALK_IN_STEPS`): stay → guest → review/create → deposit → done. All logic is in `WalkInFlow` (pure, injectable ports); screens only render state and send intents.
- **ADR-018**: the client only validates form shape (non-empty fields, calendar dates, integers, phone format). Price, stock, deposit, WALKIN channel and suspected duplicates (`created: false`) are server decisions; every amount shown is a server number. The deposit amount is not editable: it is exactly `booking.depositAmount`.
- **Online only** (QĐ-03 decision 6): offline means nothing is sent or queued and the screen says so. Each write keeps one `Idempotency-Key` (RAM only) until a definite answer; an unknown outcome (timeout, network after send, 5xx, …) retries with the same key and an unchanged request, and a changed form gets a new key.
- **PIN**: `POST /auth/pin/verify` returns a one-time `pinToken` that stays inside the flow, is put in the `POST /payments` body (not via `Session`'s token slot) and is dropped after a definite result. The PIN digits are cleared from the field when submitted and never sent anywhere except the verify call. No card data is handled.
- **Timing AC** (≤ 3 min over 20 runs): `test/walk-in-timing.spec.ts` measures 20 _simulated_ runs with an injected clock and a declared cost model (2 s per tap, 0.4 s per typed character, 1.5 s per request). It proves the logic needs ≤ 5 steps and few actions; it is **not** a measurement on people. Real-user timing on a device is BLOCKED.

## Not done / BLOCKED

- "+ Khách vãng lai" button on SCR-57 (arrivals list) — SCR-57 lives in HB-153 (PR #164); once merged, wire `onWalkIn`-style navigation there.
- Device run of TalkBack and `tests/maestro/hb157-scr65-walk-in.yaml`: no device available.
- Rate plan `LONGSTAY14` is offered as on the web desk (HB-152) although its price is still an open decision; the server decides.
