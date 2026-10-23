---
id: HB-204
title: Hợp đồng bổ sung mẻ 13 — kiểm phòng, đọc khách theo id, xem trước tiền no-show/trả phòng, ngữ nghĩa giá nhiều phòng
risk: R1
owner: deepseek
max_lines: 700
allow:
  - packages/contracts/src/**
  - packages/contracts/openapi.json
  - packages/contracts/test/**
  - packages/api-client/src/**
  - packages/api-client/test/**
  - docs/04-thiet-ke/api.md
---

# HB-204 — Hợp đồng bổ sung mẻ 13

## Mục tiêu

Phát hành **một lần** mọi phần hợp đồng thêm mới mà HB-207, HB-208, HB-209 cần, để ba ticket đó chạy song song mà không cùng sửa `packages/contracts`, `openapi.json` và `api.md`. Đồng thời ghi rõ ngữ nghĩa tiền của báo giá nhiều phòng theo [QĐ-06](../../05-ke-hoach/nhat-ky/QD-06-lead-tam-me-13.md) mục 1 (HB-205 hiện thực).

## Căn cứ

- Phát hiện QA F7 (HB-196, `docs/07-ban-giao/bang-chung-f7.md`): F7-QA-01, F7-QA-03; nợ TD-28, TD-33 trong `docs/07-ban-giao/no-ky-thuat.md`
- BR-FO-07 (task gần nhất của lượt giải phóng; chưa có bằng chứng sẵn sàng thì kiểm và ghi nhận), BR-CANCEL-06, BR-CANCEL-10, BR-FO-03, BR-FO-05, BR-RATE-10, BR-RATE-11, BR-RATE-12, BR-BOOK-10
- Mẫu xem trước đã có: `POST /bookings/{bookingId}/cancel-preview` (api.md §2.x, `cancelPreviewSchema`)

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. `POST /housekeeping/tasks` — tạo nhiệm vụ/biên bản kiểm cho `(roomId, businessDate)`; thân `{ roomId, businessDate, status: 'PENDING' | 'INSPECTED', note?, reason }` (`reason` bắt buộc 1–500); phản hồi `201` = `housekeepingTaskSchema` hiện có; lệnh ghi có `Idempotency-Key`. Vai trò FRONT_DESK, MANAGER. Mã lỗi chỉ dùng mã đã có ở §4.2 — test schema trong `packages/contracts/test/**`.
2. `GET /guests/{guestId}` → `guestSummarySchema` hiện có; cùng tập vai trò với `GET /guests` — test client trong `packages/api-client/test/**`.
3. `POST /front-office/no-show/preview` thân `{ bookingId }` → `{ bookingId, penaltyAmount, expectedRefundAmount, markableFrom, computedAt }`, tiền VND nguyên ≥ 0; `markableFrom` = mốc ISO UTC của 23:59 giờ VN ngày nhận phòng. Không 🔒 PIN, không `Idempotency-Key` (không ghi).
4. `POST /front-office/check-out/preview` thân `{ bookingId, lateCheckOut, earlyCheckOut, extras? }` (cùng ràng buộc với `checkOutRequestSchema`, không có `pinToken`) → `{ bookingId, feeAmount, extrasAmount, balanceDue, computedAt }`. Không 🔒 PIN, không `Idempotency-Key`.
5. api.md: thêm 4 dòng bảng tuyến (§2.x đúng module) + ví dụ ngắn; ghi rõ số xem trước **không ràng buộc** (lệnh ghi tính lại sau khoá, ADR-014). §3.1 báo giá: ghi rõ `nights[].nightlyPrice` là giá **một đơn vị bán**, còn `subtotal`, `discountAmount`, `total`, `depositAmount` là **tổng mọi đơn vị** (`roomCount`); khuyến mãi áp một lần trên tổng (BR-RATE-10/13).
6. `pnpm openapi:generate` cập nhật `openapi.json`; `pnpm check:openapi` không lệch; `pnpm check:contract` **0 phá vỡ**.

## Ngoài phạm vi

- Hiện thực server (HB-205/207/208/209), consumer Android (HB-210). Không đổi schema đã phát hành (chỉ thêm).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` (lead chạy) · `npm run check:docs`

## Ghi chú cho người làm

Đây là đường găng của mẻ 13: làm nhỏ, nộp sớm. Tên schema theo mẫu hiện có (`housekeepingTaskCreateRequestSchema`, `noShowPreviewRequestSchema`/`noShowPreviewSchema`, `checkOutPreviewRequestSchema`/`checkOutPreviewSchema`). Nếu §4.2 thiếu mã lỗi phù hợp cho "đã có nhiệm vụ mở cho phòng/ngày đó" thì dùng `E_FO_TASK_TRANSITION_NOT_ALLOWED` (409) và ghi trong PR — không tự thêm mã mới.
