---
id: HB-042
title: SCR-25 allotment theo kênh (operations web, API giả)
risk: R1
owner: deepseek
max_lines: 800
allow:
  - apps/operations-web/src/**
  - apps/operations-web/test/**
  - tests/e2e/**
  - packages/contracts/src/rate.ts
  - packages/contracts/src/openapi/paths/f3.ts
  - packages/contracts/openapi.json
  - packages/contracts/test/**
  - packages/api-client/src/rate.ts
  - packages/api-client/test/**
  - docs/04-thiet-ke/api.md
locked:
unlock:
---

# HB-042 — SCR-25 allotment theo kênh

> Đặc tả tự soạn (QĐ-04 mục 6) từ dòng HB-042 của [backlog F2–F3](../backlog-f2-f3.md); lead duyệt cùng PR.

## Mục tiêu

Quản lý cơ sở xem hạn mức bán (allotment) của **một kênh × một loại phòng** theo ngày và đặt lại theo lô trong **một** giao dịch, có **cảnh báo khi vượt số đơn vị bán `ACTIVE`**, và **xử lý xung đột phiên bản** (không ghi đè lén).

## Căn cứ

- Pha: F2 — [lộ trình](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §7.4 (`SCR-25`)
- Quy tắc nghiệp vụ: BR-INV-05 (hạn mức từng kênh ≤ số đơn vị bán `ACTIVE`; **không** giới hạn tổng các kênh — QĐ-05 mục 2), BR-CHAN-01, BR-CHAN-06 (đặt lại theo lô một transaction), BR-CHAN-08 (kênh trực tiếp không có hạn mức riêng)
- Use case / yêu cầu: UC-INV-03; FR-INV-06
- API: `GET /api/v1/channel-allotments` (MANAGER), `PUT /api/v1/channel-allotments` (MANAGER, `If-Match`, ≤ 31 ngày/lô); **đề xuất bổ sung `GET /api/v1/channels`** (xem ghi chú); mã lỗi `E_RBAC_FORBIDDEN`, `E_AUTH_OUT_OF_SCOPE`, `E_GEN_VERSION_CONFLICT`, `E_GEN_PRECONDITION_REQUIRED`, `E_GEN_VALIDATION_FAILED`
- Màn hình: `SCR-25`

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Mở `/channel-allotments` thì chọn được kênh + loại phòng + khoảng ngày và thấy bảng ngày · allotment · used — test: `allotments.spec.ts::hiện bảng allotment theo kênh`
2. Ô nhập vượt số đơn vị bán `ACTIVE` của loại phòng thì hiện **cảnh báo** trước khi gửi (giao diện chỉ nhắc; máy chủ vẫn chặn) — test: `allotments.spec.ts::cảnh báo vượt đơn vị bán ACTIVE`
3. Lưu gửi **một** `PUT` cho cả lô kèm `If-Match` lấy từ `ETag` của lần đọc, `items` chỉ các ngày đã đổi, rồi đọc lại — test: `allotments.spec.ts::lưu lô trong một request kèm If-Match`
4. Chỉ gửi những ngày **thực sự đổi** (không gửi cả khoảng) — test: `allotments.spec.ts::chỉ gửi ngày đã đổi`
5. `412`/`428` thì hiện xung đột **và giữ nguyên bản nhập**, không tự ghi đè — test: `allotments.spec.ts::412 giữ nguyên bản nhập`
6. `403` khi đọc thì hiện thiếu quyền, không lộ bảng — test: `allotments.spec.ts::403 hiện thiếu quyền`
7. Mất mạng khi lưu là "chưa xác định kết quả", không báo thất bại chắc chắn — test: `allotments.spec.ts::mất mạng khi lưu là chưa xác định kết quả`
8. Mọi trạng thái §8.1 hiện đúng và không có vi phạm axe serious/critical — test: `screens.spec.ts` (thêm `/channel-allotments`)

## Ngoài phạm vi

- Không sửa hệ số/hoa hồng kênh (SCR-28, HB-060) và không đẩy tồn lên kênh (`POST /channels/{id}/sync`, SCR-29/F3).
- Không quyết định hạn mức hiệu lực `min(allotment − used, tồn chung)` — đó là miền nghiệp vụ của HB-032/HB-035.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e` · `npm run check:docs` (đụng `docs/04`)

## Ghi chú cho người làm

- **Đề xuất bổ sung `GET /api/v1/channels`** (QĐ-04 mục 7, cùng cách xử lý như `GET /room-types` ở HB-037): api.md chỉ có các tuyến theo `{channelId}` (`PATCH`, `/sync`, `/mappings`, `/sales-closure`, `/ota-bookings`) và **không có tuyến liệt kê kênh**, nên màn hình không dựng được ô chọn kênh — SCR-28 (HB-060) cũng cần đúng tuyến này. Đề xuất: vai trò **MANAGER**, trả `id`, `code`, `name`, `multiplier`, `commissionPct`, `holdMinutes`, `overbookAllowed`, `version` (kèm `ETag` để SCR-28 dùng `If-Match`). Chờ lead chốt trước khi viết mã.
- **`If-Match` cho `PUT /channel-allotments`**: hợp đồng không có trường `version` cho từng dòng allotment, nên giao diện dùng `ETag` của phản hồi `GET /channel-allotments` (`ApiResponse.etag`). Nếu máy chủ **không** trả `ETag` thì màn hình báo lỗi rõ ràng thay vì gửi lệnh thiếu điều kiện (tránh 428 im lặng).
- **Cảnh báo vượt đơn vị bán**: số phải so là **số đơn vị bán của loại phòng** (BR-PROP-03; DOR bán theo giường), **không** phải `activeRoomCount` của cơ sở. Hợp đồng hiện tại (`roomTypeSummarySchema`) **không trả** số đơn vị bán theo loại phòng. Người làm phải chọn một trong hai: (a) chờ lead bổ sung trường đó vào `GET /room-types`, hoặc (b) ghi `BLOCKED` cho tiêu chí 2 và làm các tiêu chí còn lại — **không** bịa số và không suy từ `capacityAdults`.
- Địa chỉ API truyền từ server component + `dynamic = 'force-dynamic'`; dùng lại bộ dùng chung của HB-037 (khi #39 merge thì tách nhánh từ `main`).
