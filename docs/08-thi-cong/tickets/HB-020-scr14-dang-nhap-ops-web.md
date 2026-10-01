---
id: HB-020
title: SCR-14 — đăng nhập nội bộ, chọn cơ sở đang làm việc, đổi mật khẩu bắt buộc, idle 15 phút (operations web)
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/operations-web/src/app/(auth)/**
  - apps/operations-web/src/app/(ops)/layout.tsx
  - apps/operations-web/src/app/(ops)/page.tsx
  - apps/operations-web/src/session/**
  - apps/operations-web/test/auth/**
  - tests/e2e/ops-auth.spec.ts
  - tests/e2e/fake-api/staff/**
---

# HB-020 — SCR-14 đăng nhập operations web

## Mục tiêu

Nhân viên đăng nhập operations web, chọn cơ sở đang làm việc, bị buộc đổi mật khẩu khi cần, và bị đưa về màn đăng nhập sau 15 phút nhàn rỗi.

## Căn cứ

- [thiết kế màn hình](../../04-thiet-ke/thiet-ke-man-hinh.md) SCR-14, §8.1 (9 trạng thái); [lộ trình §7.3](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md#73-f1--định-danh-phiên-và-phân-quyền)
- [QĐ-03](../../05-ke-hoach/nhat-ky/QD-03-dinh-danh-phien-f1.md) quyết định 2, 3, 8, 9; UC-AUTH-01; BR-RBAC-05, BR-RBAC-06; TC-AUTH-01, TC-AUTH-02
- Client phiên `packages/web-session` (HB-019)

## Tiêu chí nghiệm thu

1. Tuyến `/login`: form tên đăng nhập + mật khẩu (label, lỗi gắn trường, bàn phím dùng được); hiện đúng thông điệp cho `E_AUTH_INVALID_CREDENTIALS`, `E_AUTH_ACCOUNT_LOCKED` (kèm thời gian chờ), `E_GEN_RATE_LIMITED`, lỗi mạng.
2. `mustChangePassword` → tuyến `/change-password` bắt buộc, không vào được trang khác cho tới khi đổi xong.
3. Sau đăng nhập: phạm vi 1 cơ sở → vào thẳng; nhiều cơ sở hoặc OWNER → chọn cơ sở. Thanh đầu trang hiện cơ sở đang làm việc + đổi được, lưu lựa chọn trong `sessionStorage` (không phải dữ liệu bí mật). Cơ sở đang làm việc được truyền làm `propertyId` cho các màn sau qua một hook chung.
4. Layout `(ops)` chặn khi chưa đăng nhập → `/login?next=…` (chỉ nhận `next` là đường dẫn nội bộ). Sự kiện `session-expired` hoặc 15 phút không thao tác (đếm phía client, máy chủ vẫn là nguồn quyết định) → về `/login` với thông báo "phiên đã hết hạn".
5. Đăng xuất ở thanh đầu trang.
6. E2E Playwright với API giả mở rộng trong `tests/e2e/fake-api/`: đăng nhập thành công, khoá tài khoản, buộc đổi mật khẩu, chọn cơ sở, hết phiên; axe 0 vi phạm serious/critical; 360 px không cuộn ngang.
7. `pnpm run ci` + `pnpm test:e2e` xanh.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`
