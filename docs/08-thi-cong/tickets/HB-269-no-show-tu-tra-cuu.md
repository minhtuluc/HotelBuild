---
id: HB-269
title: Ghi no-show từ màn tra cứu của app vận hành — booking quá ngày nhận phòng vẫn tới được SCR-64
risk: R1
owner: claude
max_lines: 200
allow:
  - apps/operations-android/app/index.tsx
  - apps/operations-android/src/lookup/view.ts
  - apps/operations-android/src/lookup/rows.tsx
  - apps/operations-android/src/lookup/screen.tsx
  - apps/operations-android/src/lookup/messages.ts
  - apps/operations-android/test/lookup-view.spec.ts
  - docs/08-thi-cong/tickets/HB-269-no-show-tu-tra-cuu.md
unlock:
  - docs/08-thi-cong/tickets/HB-269-no-show-tu-tra-cuu.md
---

# HB-269 — Ghi no-show từ tra cứu

> Đặc tả do Claude soạn ngày 20/11/2026 từ máy thật (booking PH-261119-00007, nhận phòng 19/11).

## Vấn đề

- SCR-64 (HB-155) chỉ mở được từ thẻ trong danh sách **khách đến hôm nay** (SCR-58).
- Máy chủ chỉ cho ghi no-show từ **23:59 ngày nhận phòng** (BR-CANCEL-10). Sang 00:00 hôm sau, booking đã rời danh sách khách đến.
- Vì vậy lễ tân chỉ có đúng một phút (23:59–00:00) để ghi tay. Thực tế là không ghi được, phải chờ job tự động.

## Thay đổi

1. `lookup/view.ts`:
   - `BookingView` giữ bản `BookingSummary` của máy chủ (`source`).
   - Thêm `todayVn(nowMs)` (UTC+7).
   - Thêm `noShowCandidate(view, today)`: đúng khi `CONFIRMED` và `checkIn <= today`.
2. `lookup/rows.tsx` + `screen.tsx`: thẻ booking thoả điều kiện hiện nút "Ghi no-show" khi màn được truyền `onNoShow`.
3. `app/index.tsx`: stage `lookup` mở `NoShowScreen` (dùng chung writer, khoá chống trùng và xem trước HB-210), "Về danh sách" quay về tra cứu.
4. Mốc giờ, trạng thái và tiền phạt vẫn do máy chủ quyết (xem trước + `409 E_BOOK_INVALID_STATE`). Client chỉ ẩn nút với booking chắc chắn không hợp lệ.

## Tiêu chí nghiệm thu

1. `test/lookup-view.spec.ts` (đỏ trước khi sửa): kiểm ranh giới ngày VN, trạng thái và ngày nhận phòng.
2. Ops Android: typecheck, lint và vitest (55 file) xanh.
3. Máy thật (20/11 11:34):
   - Tra cứu PH-261119-00007 → "Ghi no-show" → xem trước phạt 455.000 ₫ / hoàn 0 ₫ → xác nhận.
   - CSDL: `NO_SHOW`, `penalty_amount = 455000`.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
