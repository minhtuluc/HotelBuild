---
id: HB-060
title: SCR-28 kênh — hệ số & hoa hồng (operations web, API giả)
risk: R1
owner: deepseek
max_lines: 800
allow:
  - apps/operations-web/src/**
  - apps/operations-web/test/**
  - tests/e2e/**
locked:
unlock:
---

# HB-060 — SCR-28 kênh: hệ số & hoa hồng

> Đặc tả tự soạn (QĐ-04 mục 6) từ dòng HB-060 của [backlog F2–F3](../backlog-f2-f3.md); lead duyệt cùng PR.

## Mục tiêu

Chủ chuỗi cấu hình **hệ số giá, hoa hồng, thời gian hold và cho phép bán vượt** cho từng kênh, ở mức **mặc định toàn chuỗi** và **ghi đè theo từng cơ sở**; màn hình **cảnh báo khi hệ số thấp hơn ngưỡng sàn** `1/(1 − hoa hồng)` (kênh `AGENCY` được miễn).

## Căn cứ

- Pha: F3 — [lộ trình](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §7.5; ticket phụ thuộc HB-055 (đặc tả do lead viết) + HB-058
- Màn hình: `SCR-28` — căn cứ `UC-RATE-03`, cột dữ liệu *kênh: hệ số & hoa hồng*
- Quy tắc nghiệp vụ: BR-RATE-07 (`AGENCY` ngoài phạm vi quy tắc sàn; giá theo cam kết sản lượng), BR-RATE-09 (giá thuần OTA thấp hơn `WEB` → cảnh báo; nay phủ cả kênh trực tiếp: hệ số `WEB`/`PHONE`/`WALKIN` **nhỏ hơn 1,00** phải sinh cảnh báo), BR-RATE-18, BR-OVER-02
- Yêu cầu / use case: FR-RATE-07…FR-RATE-13; UC-RATE-03; TC-RATE-10
- API: `PATCH /api/v1/channels/{channelId}` (OWNER; `multiplier`, `commissionPct`, `holdMinutes`, `overbookAllowed`, `propertyOverrides[]`, `If-Match`); mã lỗi `E_RATE_CONFIGURATION_INVALID`, `E_GEN_VERSION_CONFLICT`, `E_GEN_PRECONDITION_REQUIRED`, `E_RBAC_FORBIDDEN`
- Backend: HB-055 (AC1–AC3) — ghi đè theo (kênh, cơ sở) bằng **dòng mới** có `effectiveFrom` (không sửa dòng cũ); cảnh báo trả trong `warnings[]`; sửa hệ số **không** ảnh hưởng báo giá đã chốt

## Khoảng trống hợp đồng (cần lead chốt)

api.md chỉ có các tuyến theo `{channelId}` (`PATCH`, `/sync`, `/mappings`, `/sales-closure`, `/ota-bookings`) và **không có tuyến liệt kê kênh** → SCR-28 không dựng được danh sách kênh để chọn. **Trùng đúng khoảng trống đã nêu ở HB-042/SCR-25.**

**Đề xuất:** bổ sung `GET /api/v1/channels` (MANAGER) trả `id`, `code`, `name`, `multiplier`, `commissionPct`, `holdMinutes`, `overbookAllowed`, `version` (+ `ETag` để dùng `If-Match`), và `GET /channels/{channelId}` nếu cần chi tiết `propertyOverrides[]`. Làm một lần cho cả SCR-25 và SCR-28. Chờ lead chốt.

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Mở `/channels` thì thấy từng kênh kèm hệ số, hoa hồng, hold, cờ bán vượt và phiên bản — test: `channels.spec.ts::hiện danh sách kênh`
2. Màn hình hiện **ngưỡng sàn tính sẵn** `1/(1 − commissionPct)` cho từng kênh và cảnh báo khi hệ số thấp hơn sàn — test: `channels.spec.ts::cảnh báo dưới sàn`
3. Kênh `AGENCY` hiện ghi chú **được miễn** quy tắc sàn và **không** sinh cảnh báo — test: `channels.spec.ts::AGENCY được miễn`
4. Kênh trực tiếp (`WEB`/`PHONE`/`WALKIN`) có hệ số `< 1,00` thì sinh cảnh báo theo BR-RATE-09 — test: `channels.spec.ts::kênh trực tiếp dưới 1,00 cảnh báo`
5. Lưu gửi `PATCH` kèm `If-Match` = `ETag` đã đọc, `Idempotency-Key` và chỉ những trường thực sự đổi — test: `channels.spec.ts::lưu gửi If-Match và trường đã đổi`
6. Thêm ghi đè theo cơ sở thì gửi **dòng mới** với `effectiveFrom` và **không** sửa dòng cũ; sau khi lưu đọc lại thấy cả hai dòng — test: `channels.spec.ts::ghi đè theo cơ sở là dòng mới`
7. `warnings[]` của máy chủ hiện nguyên văn; `412`/`428` hiện xung đột **và giữ nguyên bản nhập**; `403` hiện thiếu quyền — test: `channels.spec.ts::warnings và 412/403`
8. Mọi trạng thái §8.1 hiện đúng, không có vi phạm axe serious/critical, không cuộn ngang ở 360 px — test: `screens.spec.ts` (thêm `/channels`)

## Ngoài phạm vi

- Không làm ánh xạ mã phòng OTA (`PUT /channels/{id}/mappings`), đóng bán, đồng bộ hay booking OTA — các ticket kênh khác.
- Không tự tính giá bán theo kênh ở giao diện; ngưỡng sàn hiển thị chỉ là **cảnh báo**, máy chủ vẫn là nơi chặn (HB-055).
- Không sửa báo giá/`PriceSnapshot` đã chốt (BR-RATE-16).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

- Công thức sàn ghi rõ trong nhãn: `1 / (1 − hoa hồng)`; làm tròn hiển thị bằng `formatMultiplier` nhưng **giá trị dùng để so sánh** phải là hệ số gốc, không dùng số đã làm tròn.
- Biên: hoa hồng = 100% làm công thức chia 0 — chặn tại chỗ kèm lý do, và hợp đồng `rate.ts` đã giới hạn khoảng hoa hồng.
- Địa chỉ API truyền từ server component + `dynamic = 'force-dynamic'`; tái dùng bộ dùng chung của HB-037.
