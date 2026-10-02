---
id: HB-061
title: SCR-29 khuyến mãi (operations web, API giả)
risk: R1
owner: deepseek
max_lines: 900
allow:
  - apps/operations-web/src/**
  - apps/operations-web/test/**
  - tests/e2e/**
locked:
unlock:
---

# HB-061 — SCR-29 khuyến mãi

> Đặc tả tự soạn (QĐ-04 mục 6) từ dòng HB-061 của [backlog F2–F3](../backlog-f2-f3.md); lead duyệt cùng PR.

## Mục tiêu

Chủ chuỗi tạo **khuyến mãi** (mã, loại giảm `PERCENT`/`AMOUNT`, giá trị, số đêm tối thiểu, phạm vi kênh/loại phòng, hiệu lực, số lượt tối đa, có cộng dồn hay không), với **kiểm tra đầy đủ trường** trước khi gửi. Khuyến mãi làm giá **chạm sàn** bị chặn khi cấu hình; cấu hình sai hình thức trả mã lỗi riêng.

## Căn cứ

- Pha: F3 — [lộ trình](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §7.5; ticket phụ thuộc HB-055 + HB-058 (đặc tả do lead viết)
- Màn hình: `SCR-29` — căn cứ `UC-RATE-04`, cột dữ liệu *khuyến mãi*
- Quy tắc nghiệp vụ: BR-RATE-10 (khuyến mãi cắt tại `pricing.maxDiscountPct`; nếu chạm sàn thì **màn hình cấu hình chặn** `E_RATE_BELOW_FLOOR` HTTP 422), BR-RATE-11 (điều kiện áp dụng), BR-RATE-13 (`stackable`, `maxUses`), BR-GEN-01 (tiền VND nguyên)
- Yêu cầu / use case: FR-RATE-11; UC-RATE-04; TC-RATE-10
- API: `POST /api/v1/promotions` (OWNER; `code`, `type`, `value`, `minNights`, `channelScope`, `roomTypeScope`, `validFrom`, `validTo`, `maxUses`, `stackable`); mã lỗi `E_RATE_BELOW_FLOOR` (**422** khi cấu hình), `E_RATE_PROMO_INVALID` (422 — hết hạn/hết lượt/sai kênh/loại phòng), `E_RATE_CONFIGURATION_INVALID`, `E_GEN_VALIDATION_FAILED`, `E_RBAC_FORBIDDEN`
- Ghi chú phân biệt nguồn chân lý: cùng mã `E_RATE_BELOW_FLOOR` nhưng ở **báo giá trực tuyến** là **cảnh báo trong `warnings[]`** (HTTP 200) — màn này là màn **cấu hình**, nên là 422 chặn lưu (api.md §4.2)

## Khoảng trống hợp đồng (cần lead chốt)

api.md §2.4 chỉ có **`POST /promotions`** — không có tuyến **đọc danh sách** và không có tuyến **sửa/tắt** khuyến mãi. Hệ quả: SCR-29 không liệt kê được khuyến mãi hiện có, không tắt được mã hết hiệu lực sớm, không thấy lượt đã dùng (`usedCount`).

**Đề xuất (QĐ-04 mục 7):** bổ sung `GET /api/v1/promotions?propertyId&status&from&to` (MANAGER) trả `id`, `code`, `type`, `value`, `minNights`, `channelScope[]`, `roomTypeScope[]`, `validFrom`, `validTo`, `maxUses`, `usedCount`, `stackable`, `status`, `version`; và `PATCH /api/v1/promotions/{promotionId}` (OWNER, `If-Match`, `reason`) để tắt/giảm lượt. Chờ lead chốt; nếu chưa có thì ticket chỉ làm phần **tạo mới** và ghi `BLOCKED` cho phần danh sách.

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Mở `/promotions` thì thấy danh sách khuyến mãi kèm mã, loại giảm, giá trị, hiệu lực, lượt đã dùng/tối đa, phạm vi và trạng thái — test: `promotions.spec.ts::hiện danh sách khuyến mãi`
2. Form kiểm **đủ trường** trước khi gửi: `code` (mẫu hợp lệ), `type`, `value` (phần trăm 1–100 **hoặc** tiền nguyên VND dương — theo `type`), `validFrom ≤ validTo`, `maxUses ≥ 1`, phạm vi không rỗng khi đã chọn — thiếu/sai thì chặn tại chỗ, **không** gọi API — test: `promotions.spec.ts::thiếu trường thì không gọi API`
3. Đổi `type` thì ô `value` đổi đơn vị hiển thị (`%` ↔ `VND`) và đổi kiểm tra hợp lệ tương ứng — test: `promotions.spec.ts::type đổi thì đổi kiểm tra value`
4. `422 E_RATE_BELOW_FLOOR` thì hiện lỗi "khuyến mãi làm giá thấp hơn sàn", giữ nguyên bản nhập và gợi ý sửa mức giảm (không tự sửa giúp) — test: `promotions.spec.ts::422 chạm sàn giữ bản nhập`
5. `422 E_RATE_PROMO_INVALID` hiện đúng nhóm nguyên nhân (hết hạn/hết lượt/sai kênh/loại phòng) theo `details[]` của máy chủ; không hiện `message` thô — test: `promotions.spec.ts::E_RATE_PROMO_INVALID hiện theo trường`
6. Tạo thành công thì hiện băng xác nhận kèm mã và **đọc lại danh sách** — test: `promotions.spec.ts::tạo xong đọc lại danh sách`
7. `403` hiện thiếu quyền; mất mạng khi tạo là "chưa xác định kết quả" kèm mã tra cứu — test: `promotions.spec.ts::403 và mất mạng`
8. Mọi trạng thái §8.1 hiện đúng, không có vi phạm axe serious/critical — test: `screens.spec.ts` (thêm `/promotions`)

## Ngoài phạm vi

- Không áp mã khuyến mãi vào báo giá/booking (thuộc F4/F5) — màn này chỉ **cấu hình** mã.
- Không tự tính số tiền giảm: mọi số do máy chủ trả; giao diện không mô phỏng engine giá.
- Không bật/tắt hay xoá mã nếu lead chưa bổ sung tuyến tương ứng.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

- Tiền là **số nguyên VND**; phần trăm là số trong 1–100 theo hợp đồng `rate.ts` — dùng đúng giới hạn hợp đồng, không tự nới.
- Ghi rõ trong test sự khác nhau **422 chặn lưu khi cấu hình** ↔ **cảnh báo `warnings[]` khi báo giá** (api.md §4.2) để tránh hiểu sai mã lỗi.
- Địa chỉ API truyền từ server component + `dynamic = 'force-dynamic'`; tái dùng bộ dùng chung của HB-037.
