# HB-155: SCR-64 record no-show (operations Android)

Thin screen over the published `POST /front-office/no-show`; no new endpoint, contract or package change. Stacked on HB-153 (`src/arrivals/**`): SCR-58 gets an optional `onNoShow` prop (button "Ghi no-show"), wired in `app/index.tsx` where the arrivals stage swaps to `NoShowScreen` and back.

- Taps: Home → arrivals → card → "Ghi no-show" → confirm = 4. The reason is required by the contract, so it is **prefilled** ("Khách không đến nhận phòng") and editable.
- The countdown to 23:59 (Vietnam time) is **display only**: the server compares the mark in the property time zone and answers `409 E_BOOK_INVALID_STATE` (also for non-CONFIRMED) — shown verbatim with its code. The confirm button is not greyed by the client (ADR-018), unlike the greyed button drawn in design §5.4.
- Offline: nothing is sent or queued (QĐ-03 decision 6). One `Idempotency-Key` per intent, kept in RAM until a definite answer; unknown outcome (timeout, network after send, 5xx, mismatching response) retries with the same key and body, and "Làm mới để đối soát" returns to the list. The server's status gate also prevents a second penalty after a restart.

## BLOCKED / not done

- **Amount before confirming (AC1, design §5.4 "dialog nêu số tiền bị tính")**: no published source. `cancel-preview` prices a cancellation _at the current time_, not the last-tier no-show, and the penalty is only decided inside the mark transaction by the cancel engine. Inventing or re-deriving it on the client would break ADR-018, so the screen states the policy consequence in words and shows the server's `penaltyAmount` and `refundRequestId` after confirmation. Proposed for the lead: an additive read (e.g. `POST /front-office/no-show-preview`) that runs `decide()` without writing.
- Device run of TalkBack and the Maestro scenario (`tests/maestro/hb155-scr64-no-show.yaml`): no device available.
