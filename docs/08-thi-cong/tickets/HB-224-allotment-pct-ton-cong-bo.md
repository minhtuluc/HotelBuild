---
id: HB-224
title: Hạn mức OTA mặc định theo `allotment_pct` của ánh xạ kênh (BR-CHAN-01)
risk: R1
owner: claude
max_lines: 400
allow:
  - packages/domain/src/inventory/availability.ts
  - packages/domain/test/inventory/allotment-pct.spec.ts
  - apps/api/src/modules/inv/facts/loader.ts
  - apps/api/src/modules/chan/sync/projection.ts
  - apps/api/test/room-blocks/allotment-pct-facts.spec.ts
  - apps/worker/src/jobs/channel-sync/snapshot.ts
  - apps/worker/test/channel-sync/allotment-pct.spec.ts
  - docs/08-thi-cong/tickets/HB-224-allotment-pct-ton-cong-bo.md
---

# HB-224 — Hạn mức OTA mặc định theo `allotment_pct`

## Mục tiêu

BR-CHAN-01: khi một đêm không có dòng `channel_allotments` tường minh, hạn mức của kênh OTA cho một loại phòng là `max(1, floor(allotment_pct% × đơn vị ACTIVE))`. `allotment_pct` lấy từ `channel_mappings` ACTIVE của cặp (kênh, loại phòng) và mặc định là 80 khi không có ánh xạ. Cột này đã chỉnh được qua SCR-40 / `PUT /channels/{id}/mappings` (ràng buộc DB 1..100), nhưng trước ticket này không nơi nào đọc nó.

## Nguyên nhân (QA HB-194, QA-F6-12)

Cả ba nơi tính hạn mức mặc định đều gắn cứng 80%:

- `@pinehill/domain` `channelAvailability` dùng `defaultOtaQuota`. Đây là đường báo giá và giữ phòng ở `loadInventoryFacts`.
- Worker `channel-sync/snapshot.ts` dùng `defaultOtaQuota`, tức ảnh tồn đẩy lên OTA.
- API `chan/sync/projection.ts::quotaFor` đã nhận `pct`, chỉ căn chỉnh thêm biên `0`.

Hệ quả: đổi `allotmentPct` trên màn hình không thay đổi số phòng bán ra OTA.

## Thay đổi

- Domain:
  - `AvailabilityInput.allotmentPct?` (số nguyên 0..100, kiểm trong `validFacts`).
  - Thêm `otaQuota(active, pct = DEFAULT_ALLOTMENT_PCT)`.
  - `pct ≤ 0` ⇒ 0. Biên này chỉ là phòng thủ, vì DB chặn 0.
- API loader: đọc `allotment_pct` của ánh xạ ACTIVE theo `channelCode`. Kênh WEB/AGENCY không bị ảnh hưởng: WEB không dùng hạn mức, AGENCY mặc định 0.
- Worker snapshot: CTE `mapped` mang `allotment_pct` vào công thức.
- Thứ tự ưu tiên giữ nguyên: dòng `channel_allotments` tường minh và cờ đóng bán vẫn thắng.

## Tiêu chí nghiệm thu

1. Engine dùng `allotmentPct`, WEB bỏ qua, pct sai bị từ chối. Test: `packages/domain/test/inventory/allotment-pct.spec.ts`.
2. Loader: không có ánh xạ ⇒ 80%; ánh xạ 100/50 ⇒ 2/1 trên 2 phòng; pct tính riêng theo kênh; ánh xạ INACTIVE bị bỏ qua; allotment ngày tường minh vẫn thắng. Test: `apps/api/test/room-blocks/allotment-pct-facts.spec.ts` (đỏ trước khi sửa loader).
3. Ảnh tồn worker trên 5 phòng: Agoda 100% ⇒ quota 5, Airbnb 20% ⇒ 1, Booking mặc định ⇒ 4. Test: `apps/worker/test/channel-sync/allotment-pct.spec.ts` (đỏ trước khi sửa snapshot).
4. Các test khoá HB-131 / HB-128 vẫn xanh, không sửa.

## Ngoài phạm vi

Không đổi API mapping hay UI SCR-40. Không đổi luật đóng bán tự động.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · integration `apps/api/test/{availability,channel-sync,inventory,ota-bookings,room-blocks}` · worker `test/channel-sync`.
