---
id: HB-206
title: Check-in nhiều phòng ghép đúng BookingRoom và sẵn sàng theo lượt giải phóng
risk: R2
owner: codex
max_lines: 450
allow:
  - apps/api/src/modules/fo/check-in/**
  - apps/api/test/uc-check-in/**
---

# HB-206 — Check-in nhiều phòng & độ sẵn sàng theo lượt giải phóng

## Mục tiêu

Sửa hai phát hiện QA F7 trong `POST /front-office/check-in`: (a) F7-QA-04 — `actualRoomIds[i]` được ghép cứng với `booking_rooms` theo thứ tự `id` mà client không biết, nên chọn đúng phòng nhưng sai thứ tự bị `E_INV_ROOM_TAKEN`; (b) F7-QA-05 — sẵn sàng chỉ đọc nhiệm vụ buồng phòng **đúng ngày nhận phòng**, nên phòng dọn xong hôm trước, khách đến hôm sau vẫn 409, trái BR-FO-07 ("task gần nhất của lần giải phóng đó").

## Căn cứ

- BR-FO-01, BR-FO-06, BR-FO-07; UC-FO-01; TC-FO-01; ADR-014 (thứ tự khoá)
- Bằng chứng: `docs/07-ban-giao/bang-chung-f7.md` F7-QA-04, F7-QA-05
- Mã: `apps/api/src/modules/fo/check-in/facts.ts` (`lockCheckInFacts`, `readinessTasks`), `writes.ts` (`assignActualRooms`)

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Ghép phòng: phòng thực tế đã có `RoomAssignment` thuộc **chính booking này** được ghép vào đúng `BookingRoom` đó; phòng còn lại ghép vào các `BookingRoom` còn trống theo thứ tự ổn định. Mọi hoán vị của cùng tập `actualRoomIds` cho cùng kết quả — test `apps/api/test/uc-check-in/**`.
2. Sẵn sàng = nhiệm vụ **mới nhất** của phòng có `business_date ≤ ngày nhận phòng` và **không sớm hơn lượt giải phóng gần nhất** của phòng (ngày kết thúc assignment trước đó ≤ ngày nhận phòng); thứ tự `business_date desc, created_at desc, id desc`. Phòng dọn `DONE` ngày D, khách nhận ngày D+1 ⇒ nhận được.
3. Nhiệm vụ `DONE` thuộc lượt trước (trước ngày giải phóng gần nhất) **không** chứng minh sẵn sàng ⇒ vẫn 409 `E_FO_CHECKIN_NOT_ALLOWED` (`UNITS_NOT_READY`).
4. Phòng chưa từng có nhiệm vụ ⇒ 409 như cũ (đường ghi nhận kiểm phòng thuộc HB-207).
5. `apps/api/test/front-office/front-office.locked.spec.ts` giữ nguyên nội dung và xanh 16/16.

## Ngoài phạm vi

- F7-QA-02 (lượt bị từ chối không lưu audit): **đúng thiết kế** theo QĐ-06 mục 3 — không đổi.
- Giao giường DOR (TD-29).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` (lead chạy) · `apps/api` vitest `test/uc-check-in test/front-office test/concurrency` · **review độc lập Opus trước merge**

## Ghi chú cho người làm

Giữ thứ tự khoá booking → booking_rooms → rooms; truy vấn sẵn sàng chạy **sau** khoá phòng như hiện tại. Viết test đỏ tái hiện cả hai phát hiện trước khi sửa.
