---
id: HB-209
title: Xem trước tiền no-show và trả phòng — preview không ghi, dùng đúng engine của lệnh
risk: R2
owner: codex
max_lines: 600
allow:
  - apps/api/src/modules/fo/no-show/**
  - apps/api/src/modules/fo/check-out/**
  - apps/api/test/xem-truoc-tien-sanh/**
  - apps/api/test/rbac/registered-routes.spec.ts
---

# HB-209 — Xem trước tiền no-show & trả phòng

## Mục tiêu

Hiện thực `POST /front-office/no-show/preview` và `POST /front-office/check-out/preview` (hợp đồng HB-204) để SCR-61/SCR-64 hiện số tiền **trước khi xác nhận** mà không tự tính ở client (ADR-018). Đóng TD-28; gỡ AC còn thiếu của HB-154 (AC2) và HB-155 (AC1).

## Căn cứ

- BR-CANCEL-06, BR-CANCEL-10, BR-FO-02, BR-FO-03, BR-FO-05; UC-FO-02, UC-FO-04; TC-FO-03, TC-FO-07
- Hợp đồng: HB-204 AC3, AC4 (phải merge trước). Mẫu: `POST /bookings/{bookingId}/cancel-preview`
- Mã: `apps/api/src/modules/fo/no-show/service.ts`, `apps/api/src/modules/fo/check-out/{service,early,support}.ts`

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Preview gọi **cùng** hàm/engine quyết định số tiền mà lệnh ghi dùng (tách phần "quyết định" thuần khỏi phần ghi nếu cần); không sao chép công thức (bài học TD-31) — test `apps/api/test/xem-truoc-tien-sanh/**`.
2. Không ghi gì: số dòng `bookings`, `payments`, `booking_charges`, `audit_logs`, `outbox` không đổi sau preview.
3. Cùng đồng hồ tiêm và cùng dữ liệu: số preview = số lệnh ghi trả ngay sau đó (no-show: `penaltyAmount`; trả phòng: `feeAmount`, `extrasAmount`, `balanceDue`) — kiểm trên các mốc 12:00/18:00 và 23:59.
4. Booking sai trạng thái/ngoài phạm vi ⇒ đúng mã lỗi mà lệnh ghi trả; RBAC như lệnh ghi; check-out preview **không** cần PIN (không ghi, không tiền ra).
5. Oracle hai tuyến mới trong `registered-routes.spec.ts`.

## Ngoài phạm vi

- Consumer Android (HB-210). Không giữ chỗ/khoá số xem trước (không ràng buộc).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` (lead chạy) · vitest `test/xem-truoc-tien-sanh test/front-office test/uc-check-out test/rbac` · **review độc lập Opus trước merge**

## Ghi chú cho người làm

Test khoá `apps/api/test/front-office/front-office.locked.spec.ts` phải giữ nguyên và xanh. Nếu tách "quyết định" khỏi "ghi" làm đổi hành vi lệnh ghi dù một ca → dừng, báo lead.
