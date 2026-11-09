---
id: HB-227
title: Bộ mô phỏng OTA HB-128 nhận tham số cơ sở/loại phòng/kỳ/số tiền (QA-F6-01)
risk: R0
owner: claude
max_lines: 200
allow:
  - scripts/simulators/ota/simulator.ts
  - apps/api/test/ota-inbox/simulator-booking.spec.ts
  - docs/08-thi-cong/tickets/HB-227-simulator-ota-tham-so.md
---

# HB-227 — Tham số cho bộ mô phỏng OTA

## Vấn đề (QA HB-194, QA-F6-01)

`scripts/simulators/ota/simulator.ts::rawOf` gắn cứng các giá trị của fixture HB-128:

- `propertyCode: 'H029-A'`, `roomTypeCode: 'STD'`, kỳ 10–12/12/2026;
- số tiền ngẫu nhiên theo seed.

Hệ quả khi chạy trên dữ liệu thật (TC-CHAN-11): cả 20 sự kiện vào DEAD_LETTER `OTA_PROPERTY_UNMAPPED`. Ngay cả khi đúng cơ sở, server vẫn từ chối vì số tiền phải bằng giá engine.

## Thay đổi

Thêm `SimulatorOptions.booking?: { propertyCode?, roomTypeCode?, checkIn?, checkOut?, amount? }`. Trường nào vắng thì giữ giá trị phase A, nên hợp đồng khoá `runSimulator({ baseUrl, clock, seed, scenario, accounts })` và test khoá HB-128 không đổi. Chữ ký HMAC tính trên raw đã thay giá trị.

## Tiêu chí nghiệm thu

1. Có `booking` ⇒ cả 20 payload `twenty-events` mang đúng các giá trị truyền vào, chữ ký đúng trên raw. Test: `apps/api/test/ota-inbox/simulator-booking.spec.ts::HB227_booking_override_reaches_every_signed_payload`.
2. Không có `booking` ⇒ payload phase A (`H029-A`/`STD`/10–12/12, số tiền ngẫu nhiên theo seed). Test: `…::HB227_without_override_payload_stays_phase_a`.
3. `apps/api/test/ota-inbox/simulator.locked.spec.ts` xanh, không sửa.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`.
