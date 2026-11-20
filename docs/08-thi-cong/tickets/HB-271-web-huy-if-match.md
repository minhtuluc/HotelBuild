---
id: HB-271
title: Web khách gửi neo `If-Match` từ lần xem trước khi huỷ booking — hết `428` trên SCR-11
risk: R1
owner: claude
max_lines: 200
allow:
  - apps/customer-web/src/app/(guest)/bookings/api.ts
  - apps/customer-web/src/app/(guest)/bookings/[bookingId]/cancel/cancel-screen.tsx
  - apps/customer-web/test/scr11-huy-web/cancel-if-match.spec.ts
  - docs/08-thi-cong/tickets/HB-271-web-huy-if-match.md
unlock:
  - docs/08-thi-cong/tickets/HB-271-web-huy-if-match.md
---

# HB-271 — Web khách huỷ gửi `If-Match`

> Đặc tả do Claude soạn ngày 20/11/2026, phần còn lại ngoài phạm vi của HB-257.

## Vấn đề

- `POST /bookings/{id}/cancel` bắt buộc `If-Match` = `ETag` của `cancel-preview` (HB-097): thiếu thì `428`, cũ thì `412`.
- HB-257 đã sửa app khách Android và operations web. Web khách vẫn gọi qua lớp API riêng (`(guest)/bookings/api.ts`) không có neo, nên mọi lệnh huỷ trên SCR-11 bị `E_GEN_PRECONDITION_REQUIRED`.

## Thay đổi

1. `fetchCancelPreview` trả `{ preview, tag }`; thiếu `ETag` thì báo lỗi, không huỷ mù.
2. `cancelBooking(session, id, request, ifMatch)` gửi header `if-match`. BFF (`web-session/journey.ts`) đã chuyển tiếp `if-match`/`etag` sẵn.
3. SCR-11: bước xác nhận đối chiếu lại một lần, rồi gửi neo **của chính lần đối chiếu đó**. Số liệu đổi sau đó thì máy chủ vẫn từ chối `412`.

## Tiêu chí nghiệm thu

1. `test/scr11-huy-web/cancel-if-match.spec.ts` (đỏ trước khi sửa): bản xem trước trả ETag; lệnh huỷ gửi đúng `if-match`.
2. Customer web: typecheck, eslint và vitest (251 test) xanh.
3. Chạy thật qua BFF (Next dev :3001 + API, Playwright, khách +84987654321), booking PH-261120-0000B:
   - Xem trước trả `etag="1.f9f64b06a1c3aff0"`.
   - `POST …/cancel` gửi `if-match` đúng giá trị đó → `200`.
   - Màn hình hiện "Đã huỷ (CANCELLED)"; CSDL `CANCELLED`.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
