---
id: HB-256
title: Khách tự xem trước và huỷ booking của mình trên app (api.md §2.5) — hết `403 E_RBAC_FORBIDDEN`
risk: R2
owner: claude
max_lines: 520
allow:
  - apps/api/src/modules/book/cancel/**
  - apps/api/src/modules/fo/check-out/service.ts
  - apps/api/src/modules/book/bookings/principal.ts
  - apps/api/src/common/guards/auth.guard.ts
  - apps/api/test/huy-booking/**
  - apps/api/test/rbac/routes/f4-booking.ts
  - docs/08-thi-cong/tickets/HB-256-khach-tu-huy.md
unlock:
  - docs/08-thi-cong/tickets/HB-256-khach-tu-huy.md
---

# HB-256 — Khách tự huỷ booking

> Đặc tả do Claude soạn ngày 19/11/2026 từ lần chạy máy thật (customer Android, booking PH-261119-00004).

## Vấn đề

- Ở app khách, màn **Huỷ đặt phòng** bấm "Xem trước số tiền hoàn" thì báo `E_RBAC_FORBIDDEN`. Customer web gọi cùng tuyến nên cũng hỏng.
- api.md §2.5 ghi vai trò tối thiểu của `cancel-preview`/`cancel` là `GUEST` (UC-BOOK-08).
- HB-097 chỉ mở cho nhân viên và để lại ghi chú "khi HB-017 mở phiên khách thì thêm nhánh khách". Phiên khách đã có từ lâu, và HB-077 / `GET /bookings/{id}/balance` đã dùng mẫu `@Public` + `bookingCaller`.

## Thay đổi

1. `cancel/caller.ts`: `cancelCaller` phân giải chủ thể bằng `bookingCaller`, gồm kiểm chữ ký, dòng phiên (TD-59) và đọc lại vai trò/phạm vi nhân viên từ CSDL. Nhân viên vẫn phải có `bookings.cancelPreview`/`bookings.cancel`. `auditActor` ghi khách thành `actor_id = null, actor_role = 'GUEST'`, vì `audit_logs.actor_id` là FK `users`.
2. Hai tuyến thành `@Public`. Khoá chống trùng gắn theo đúng chủ thể (`GUEST`/`USER`), nên hai bên không phát lại kết quả của nhau.
3. Service: khách chỉ đụng được booking của mình, khác chủ thì che `404` như HB-077. Nhánh nhân viên giữ nguyên.
4. Yêu cầu hoàn đứng tên khách: `requester_type = 'GUEST'`, `requester_id = guests.id`, `requested_by = NULL`. Đúng ràng buộc `ck_refund_requests_requester` và trigger chủ booking.
5. Phạt đêm đầu khi khách huỷ (BR-CANCEL-06): ghi nghĩa vụ `booking_charges` PENALTY như cũ. **Không** tạo phiếu `payments` PENALTY `CASH` PENDING, vì `ck_payments_cash_shift` bắt buộc có nhân viên lập. Sổ cái và lệnh thu tại quầy đọc nghĩa vụ từ `booking_charges`.
6. Bất khả kháng: khách vẫn bị chặn ở lệnh huỷ (BR-CANCEL-13, chỉ MANAGER/OWNER). Xem trước trả cảnh báo `FORCE_MAJEURE_REQUIRES_MANAGER`.
7. Trả phòng sớm dùng chung `recordRefund` qua `staffActor` (không đổi hành vi).
9. **Chặn mật khẩu tạm trên tuyến `@Public`**: `AuthGuard` trả `403 E_AUTH_PASSWORD_CHANGE_REQUIRED` cho nhân viên đang buộc đổi mật khẩu, nhưng `bookingCaller` không kiểm. Hai tuyến huỷ, và cả `POST/GET /bookings` cùng `balance` có từ trước, vì thế để lọt nhân viên dùng mật khẩu tạm. `bookingCaller` nay đọc `must_change_password` và chặn như guard; lỗi do agent soát R2 tìm ra và đã được xác nhận bằng test.
8. Bảng đối chiếu RBAC bỏ hai tuyến này, vì route `@Public` không thuộc bảng bảo vệ. Quyền nhân viên vẫn được `guards.spec.ts` kiểm.

## Tiêu chí nghiệm thu

1. `test/huy-booking/guest.spec.ts` đỏ trước khi sửa, xanh sau khi sửa. Kiểm:
   - Chủ booking xem trước rồi huỷ được; yêu cầu hoàn đứng tên khách; audit vai trò GUEST.
   - Khách khác bị 404; không có bearer thì 401; nhân viên vẫn huỷ được.
   - Khách chọn bất khả kháng: xem trước có cảnh báo, lệnh huỷ 403.
   - Khách huỷ trong bậc phạt: có công nợ PENALTY 800.000 ₫, không có phiếu tiền mặt.
   - Nhân viên đang buộc đổi mật khẩu: xem trước và huỷ đều 403 `E_AUTH_PASSWORD_CHANGE_REQUIRED`.
2. Vẫn xanh: `test/huy-booking` (cancel, guards), `test/rbac`, `uc-check-out`, `xem-truoc-tien-sanh`, `front-office/day-board`; `check:openapi`/`check:contract` không có thay đổi phá vỡ.
3. Máy thật: khách huỷ PH-261119-00004 (đã trả cọc 390.000 ₫) trên app Android.

## Ngoài phạm vi

- Khách tự đổi ngày (`POST /bookings/{id}/reschedule`): cùng khoảng trống, ticket riêng.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
