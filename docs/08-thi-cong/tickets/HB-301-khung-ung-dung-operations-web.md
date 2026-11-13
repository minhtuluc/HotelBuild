---
id: HB-301
title: Khung ứng dụng Operations Web (Operate mode), thanh đầu trang staff-bar, điều hướng phân hệ và SCR-14
risk: R1
owner: gemini
max_lines: 700
allow:
  - apps/operations-web/src/app/layout.tsx
  - apps/operations-web/src/app/(ops)/layout.tsx
  - apps/operations-web/src/app/(ops)/page.tsx
  - apps/operations-web/src/app/(ops)/access-denied/**
  - apps/operations-web/src/app/(auth)/**
  - apps/operations-web/src/session/**
  - apps/operations-web/src/lib/i18n.ts
  - apps/operations-web/test/**
unlock:
  - docs/08-thi-cong/tickets/HB-3*.md
---

# HB-301 — Khung ứng dụng Operations Web & SCR-14

> Tự soạn từ lộ trình frontend (`HB-300+`). Dựng khung vỏ "Quiet Editorial Back-office" cho Operations Web.

## Mục tiêu

Nâng cấp khung vỏ chung của `operations-web` (thanh `staff-bar`, ngăn điều hướng phân hệ, trang chủ điều hành, màn `access-denied`) và nhóm màn xác thực `SCR-14` (`/login`, `/change-password`, `/select-property`) theo hệ thiết kế Pine Hill–Amanoi ở chế độ `Operate`, bảo toàn 100% quy tắc phiên 15 phút và selector E2E.

## Căn cứ

- Thiết kế màn hình: [thiet-ke-man-hinh.md](../../04-thiet-ke/thiet-ke-man-hinh.md) (`SCR-14`)
- Nghiệp vụ & kiểm thử: UC-AUTH-01, BR-RBAC-05, BR-RBAC-06, TC-AUTH-01, TC-AUTH-02, NFR-USE-04

## Tiêu chí nghiệm thu

1. Thanh `staff-bar` hiện `PineHillBrand`, `staff-user`, `staff-property`/`staff-property-select`, `staff-logout` và nút `ops-nav-toggle` điều khiển ngăn điều hướng `ops-module-nav` (mặc định đóng `hidden` để tránh đụng độ selector `getByRole('link')` ở các màn con; không dùng `<aside>` bên trong `<main>`; không đặt nhãn link bắt đầu bằng `Sửa|Xoá|Tạo|Thêm`).
2. Các màn `/login`, `/change-password`, `/select-property` và `/access-denied` giữ nguyên mọi `data-testid`, nhãn `getByLabel`, focus lỗi đầu tiên và đạt 0 vi phạm axe serious/critical ở cả `1440×900` lẫn `360×800`.
3. Toàn bộ câu chữ đi qua `operationsCatalog` (`apps/operations-web/src/lib/i18n.ts` / `session/messages.ts`) và đạt giới hạn ESLint (`max-lines <= 400`, `max-lines-per-function <= 80`).

## Ngoài phạm vi

- Không chỉnh sửa `packages/web-session` hoặc API BFF `/api/session/**`.
- Không chỉnh sửa các màn nghiệp vụ chi tiết thuộc `HB-302` và `HB-304`.

## Cổng phải xanh

`pnpm check:scope` · `corepack pnpm --filter @pinehill/operations-web typecheck` · `corepack pnpm --filter @pinehill/operations-web test` · `tests/e2e/ops-auth.spec.ts` · `tests/e2e/shell.spec.ts`
