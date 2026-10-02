---
id: HB-062
title: SCR-30 xem trước báo giá đa kênh (operations web, API giả)
risk: R1
owner: deepseek
max_lines: 700
allow:
  - apps/operations-web/src/**
  - apps/operations-web/test/**
  - tests/e2e/**
locked:
unlock:
---

# HB-062 — SCR-30 xem trước báo giá đa kênh

> Đặc tả tự soạn (QĐ-04 mục 6) từ dòng HB-062 của [backlog F2–F3](../backlog-f2-f3.md); lead duyệt cùng PR.

## Mục tiêu

Quản lý cơ sở xem **so sánh giá đồng thời nhiều kênh** cho một loại phòng và một kỳ lưu trú: giá gộp, giá thuần (sau hoa hồng), hoa hồng từng kênh và cảnh báo khi giá thuần OTA **thấp hơn** `WEB`. Màn hình **chỉ hiển thị con số máy chủ trả** — tuyệt đối không tự tính lại giá ở giao diện.

## Căn cứ

- Pha: F3 — [lộ trình](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §7.5; ticket phụ thuộc HB-056 (đặc tả do lead viết) + HB-058
- Màn hình: `SCR-30` — căn cứ `UC-RATE-05`, cột dữ liệu *báo giá đa kênh*
- Quy tắc nghiệp vụ: BR-RATE-07 (hệ số/hoa hồng theo kênh, `AGENCY` theo cam kết sản lượng), BR-RATE-08 (doanh thu gộp/thuần), BR-RATE-09 (cảnh báo OTA thấp hơn `WEB`), BR-RATE-17 (kết quả **phải khớp từng VND** với engine — sai 1 VND là lỗi)
- Yêu cầu / use case: FR-RATE-17; UC-RATE-05
- API: `POST /api/v1/quotes/multi-channel` (MANAGER; `roomTypeId`, `checkIn`, `checkOut`, `channelCodes[]`); mã lỗi `E_GEN_VALIDATION_FAILED`, `E_RATE_CONFIGURATION_INVALID`, `E_RBAC_FORBIDDEN`, `E_AUTH_OUT_OF_SCOPE`
- Backend: HB-056 (AC2–AC4) — chạy engine HB-052 cho từng kênh trên **cùng một** dữ kiện; mặc định cả 7 kênh; trả gộp/thuần/hoa hồng + cảnh báo OTA < WEB; **chỉ đọc**, không tạo quote/snapshot

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Nhập loại phòng + ngày nhận/trả (và có thể chọn tập kênh) rồi gửi thì thấy bảng mỗi kênh một dòng: giá gộp, hoa hồng, giá thuần — test: `multi-channel-quote.spec.ts::hiện bảng so sánh kênh`
2. Con số hiển thị **bằng đúng** phản hồi máy chủ: test dùng số "lạ" (ví dụ `8.112.000`) và khẳng định giao diện in nguyên giá trị, không làm tròn lại hay nhân hệ số — test: `multi-channel-quote.spec.ts::hiển thị đúng số máy chủ trả`
3. Kênh có giá thuần thấp hơn `WEB` được đánh dấu cảnh báo theo `warnings[]`/cờ từ máy chủ; giao diện **không** tự so sánh số để sinh cảnh báo — test: `multi-channel-quote.spec.ts::cảnh báo OTA thấp hơn WEB theo máy chủ`
4. Không chọn kênh nào thì mặc định gửi **cả 7 kênh** (đúng như backend mặc định), và hiện đủ 7 dòng — test: `multi-channel-quote.spec.ts::mặc định đủ kênh`
5. Màn hình **không** tạo quote/snapshot: khẳng định âm — không có nút "Chốt giá"/"Gửi khách", và chỉ có đúng một lời gọi `POST /quotes/multi-channel` khi xem — test: `multi-channel-quote.spec.ts::chỉ đọc không chốt giá`
6. Kỳ không hợp lệ (`checkOut ≤ checkIn`) thì chặn tại chỗ, không gọi API — test: `multi-channel-quote.spec.ts::kỳ sai thì không gọi API`
7. `403` hiện thiếu quyền; lỗi đọc/`422` hiện băng lỗi + giữ kết quả cũ, không hiện bảng rỗng giả — test: `multi-channel-quote.spec.ts::403 và lỗi giữ kết quả cũ`
8. Mọi trạng thái §8.1 hiện đúng, không có vi phạm axe serious/critical, không cuộn ngang ở 360 px — test: `screens.spec.ts` (thêm `/multi-channel-quote`)

## Ngoài phạm vi

- Không tạo booking/hold/quote (F4/F5) — màn này chỉ **xem trước**.
- Không tự tính hoa hồng/thuần ở giao diện; không nhân hệ số kênh (BR-RATE-17: sai 1 VND là lỗi).
- Không sửa cấu hình kênh tại đây (SCR-28, HB-060) — chỉ liên kết sang.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

- Tiền hiển thị bằng `formatMoney` (VND nguyên); nếu máy chủ trả số lẻ thì **không** làm tròn ở giao diện — hiện đúng và để backend sửa (BR-GEN-01 cấm số thực cho tiền ở tầng miền).
- Kết quả là **tính theo yêu cầu**, không phải báo giá đã chốt: ghi rõ trên màn hình rằng giá có thể đổi và số liệu không phải cam kết.
- Không gửi `Idempotency-Key` cần thiết? Hợp đồng F3 khai tuyến này là **POST** (lệnh ghi theo ADR-017 cần khoá) nhưng backend chỉ đọc — người làm giữ nguyên hành vi client mặc định (client tự sinh khoá) và **không** tự bỏ header; nêu rõ trong PR nếu thấy lệch.
- Địa chỉ API truyền từ server component + `dynamic = 'force-dynamic'`; tái dùng bộ dùng chung của HB-037.
