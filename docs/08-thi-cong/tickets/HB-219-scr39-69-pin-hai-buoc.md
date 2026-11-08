---
id: HB-219
title: SCR-39/SCR-69 — PIN là bước hai, không tự mở hộp thoại modal khi vào màn; sửa 2 ca E2E AC1 đỏ từ HB-111
risk: R1
owner: claude
max_lines: 200
allow:
  - apps/operations-web/src/app/(ops)/bookings/[bookingId]/collect/collect-parts.tsx
  - apps/operations-web/src/app/(ops)/bookings/[bookingId]/early-checkout/**
  - apps/operations-web/src/app/(ops)/reconciliation/**
  - tests/e2e/scr39-69-doi-soat-ops.spec.ts
---

# HB-219 — SCR-39/SCR-69: PIN là bước hai

## Mục tiêu

Lễ tân và kế toán dùng được SCR-69 (trả phòng sớm) và SCR-39 (chốt quỹ) theo đúng thứ tự hai bước của UI-03: xem số liệu do máy chủ trả trước, rồi mới mở hộp thoại PIN để xác nhận. Hai ca E2E AC1 của HB-111 (`tests/e2e/scr39-69-doi-soat-ops.spec.ts`) đỏ từ ngày merge (#215, 01/11/2026) phải xanh trên đúng hành trình đó.

## Nguyên nhân gốc (đã tái hiện trên `059cdd8`, Chromium)

1. **SCR-69 — lỗi sản phẩm.** `PinDialog` (`collect/collect-parts.tsx`, có từ HB-109) khởi tạo `open = true` và gọi `showModal()` khi mount. Ở SCR-69, hộp thoại modal mở ngay khi vào màn, nên toàn bộ trang bị `inert`: không bấm được "Xem trước số tiền trả phòng sớm" (Playwright: `pin-dialog subtree intercepts pointer events`, quá hạn 60 giây). Ở SCR-39, hộp thoại cũng chặn ô cơ sở, ngày và tiền mặt đếm cho tới khi người dùng đóng nó.
2. **SCR-39 — lỗi test.** Stub `GET /properties` thiếu `status`, `activeRoomCount`, `overbookLimitPct`, `checkInTime`, `checkOutTime` và `version` của `propertySummarySchema` (schema có từ HB-033, 12/10). Client giải mã không được nên báo `protocol`, và bảng kênh không bao giờ hiện.

## Căn cứ

- UI-03 (thiết kế màn hình §6): xác nhận hai bước cho mọi thao tác tài chính; BR-RBAC-05 (PIN), BR-CANCEL-09 (trả phòng sớm), BR-PAY-06/10 (chốt quỹ).
- SCR-39, SCR-69; HB-111.

## Tiêu chí nghiệm thu

1. SCR-69: vào màn không có hộp thoại modal; xem trước được, rồi bấm "Nhập PIN" để xác thực và xác nhận trả phòng sớm. — test: `scr39-69-doi-soat-ops.spec.ts::SCR-69 … (AC1)`
2. SCR-39: bảng kênh hiện từ stub đúng hợp đồng; nhập tiền đếm trước, rồi mở PIN, chốt quỹ và thấy cảnh báo lệch. — test: `scr39-69-doi-soat-ops.spec.ts::SCR-39 … (AC1)`
3. SCR-37, SCR-38 và tiền sảnh giữ nguyên hành vi tự mở PIN (`autoOpen` mặc định `true`). — test: `scr37-thu-tien-ops.spec.ts`, `scr38-duyet-hoan-ops.spec.ts`, `ops-front-desk.spec.ts` vẫn xanh.

## Ngoài phạm vi

Không đổi luồng PIN của SCR-37, SCR-38 hay tiền sảnh; không đổi API hoặc hợp đồng.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · e2e Chromium các spec ở AC1–AC3 (WebKit BLOCKED trên host Fedora).
