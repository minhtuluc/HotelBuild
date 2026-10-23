# HB-155: SCR-64 record no-show (operations Android)

Thin screen over the published `POST /front-office/no-show`; no new endpoint, contract or package change. Stacked on HB-153 (`src/arrivals/**`): SCR-58 gets an optional `onNoShow` prop (button "Ghi no-show"), wired in `app/index.tsx` where the arrivals stage swaps to `NoShowScreen` and back.

- Taps: Home → arrivals → card → "Ghi no-show" → confirm = 4. The reason is required by the contract, so it is **prefilled** ("Khách không đến nhận phòng") and editable.
- HB-210: on open the screen reads `POST /front-office/no-show/preview` (HB-209) and shows `penaltyAmount`, `expectedRefundAmount` and the computation time as **non-binding** server numbers; the countdown runs to the server's `markableFrom` (the client no longer builds a 23:59 itself, ADR-018). The preview is not requested offline; on failure the screen says "Chưa có số xem trước … không phải 0 ₫" and shows no deadline, but confirming stays possible. The preview is dropped (never carried over) on reload, retry or a property/session change. The server still compares the mark and answers `409 E_BOOK_INVALID_STATE` (also for non-CONFIRMED) — shown verbatim with its code. The confirm button is not greyed by the client (ADR-018), unlike the greyed button drawn in design §5.4.
- Offline: nothing is sent or queued (QĐ-03 decision 6). One `Idempotency-Key` per intent, kept in RAM until a definite answer; unknown outcome (timeout, network after send, 5xx, mismatching response) retries with the same key and body, and "Làm mới để đối soát" returns to the list. The server's status gate also prevents a second penalty after a restart.

## BLOCKED / not done

- Not yet checked against a real API: the preview route (HB-209, PR #185) was merged after this client was written; tests use a fake `fetch` built on the published contract.
- Device run of TalkBack and the Maestro scenario (`tests/maestro/hb155-scr64-no-show.yaml`): no device available.
