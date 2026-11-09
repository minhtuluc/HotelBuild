---
id: HB-226
title: Test thuộc tính 10.000 cấu hình cho quota từng kênh (HB-131 AC4, TC-CHAN-06) + ghi nợ QA-F6-05
risk: R0
owner: claude
max_lines: 200
allow:
  - packages/domain/test/inventory/channel-quota.property.spec.ts
  - docs/07-ban-giao/no-ky-thuat.md
  - docs/08-thi-cong/tickets/HB-226-thuoc-tinh-quota-kenh.md
---

# HB-226 — Thuộc tính quota từng kênh

## Mục tiêu

HB-131 AC4 cam kết "khoá test thuộc tính 10.000 cấu hình với seed cố định theo TC-CHAN-06", nhưng `apps/api/test/channel-sync/inventory.locked.spec.ts::per-channel-quota-and-nonnegative-inventory` chỉ có ví dụ (QA HB-194, QA-F6-03).

Ticket này thêm phần thuộc tính trên engine thuần `@pinehill/domain/inventory`. Đây là nơi duy nhất tính tồn kênh cho báo giá, giữ chỗ và OTA. Test khoá không bị sửa.

## Bất biến (10.000 lượt, `seed = 20261106`)

Cấu hình sinh ngẫu nhiên:

- 0–15 phòng, trạng thái ACTIVE/MAINTENANCE/INACTIVE.
- Khoá phòng.
- 0–25 nghĩa vụ ở mọi kênh trên 3 đêm.
- Allotment tường minh có hoặc không.
- Kênh hỏi là bất kỳ kênh nào trong 7 kênh.

Bất biến phải giữ:

1. `0 ≤ channelAvailability ≤ max(0, pool)`.
2. WEB/PHONE/WALKIN: `= max(0, pool)` (không có quota).
3. OTA không có allotment: quota = `max(1, floor(80% đơn vị ACTIVE))`, hoặc 0 khi không có đơn vị ACTIVE. Quota tính trước khoá phòng. AGENCY thiếu cấu hình ⇒ 0.
4. Allotment tường minh thắng mặc định.
5. `channelAvailability = max(0, min(pool, quota − used))`, với `used` là số nghĩa vụ của chính kênh trong đêm.

Phá thử: đổi oracle sang 70% ⇒ test đỏ với phản ví dụ 4 phòng ACTIVE trên OTA_AGODA.

Khi HB-224 (`allotment_pct`) vào main, oracle mục 3 cần thêm `pct`. Ticket sau sẽ mở rộng generator cho phần này.

## Ghi nợ

TD-80 (QA-F6-05): `room_moves` không lưu `overbookingCaseId`/`consent`. Việc này cần DDL, làm ở ticket riêng.

## Tiêu chí nghiệm thu

`packages/domain/test/inventory/channel-quota.property.spec.ts::HB226_channel_quota_invariants_hold_for_10000_seeded_configurations` xanh. Các test inventory khác vẫn xanh.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`.
