---
id: HB-305
title: Khung Editorial Resort Customer Web (TD-42), ảnh nghỉ dưỡng offline, trang chủ SCR-01 và SCR-07..13
risk: R1
owner: gemini
max_lines: 900
allow:
  - apps/customer-web/src/**
  - apps/customer-web/public/**
  - apps/customer-web/test/**
unlock:
  - docs/08-thi-cong/tickets/HB-3*.md
---

# HB-305 — Khung Editorial Resort Customer Web (TD-42) & SCR-01, SCR-07..13

> Tự soạn từ lộ trình frontend (`HB-300+`). Mang trọn vẹn tinh thần Amanoi Editorial Resort lên giao diện khách của Pine Hill.

## Mục tiêu

Tích hợp bộ ảnh nghỉ dưỡng chọn lọc (chạy 100% offline từ `public/images/pine-hill/`), xây dựng `GuestHeader` và `GuestFooter` dùng chung trên `customer-web` để xử lý `TD-42`, thiết kế lại trang chủ `SCR-01` với Hero nghỉ dưỡng + khối tìm phòng `search-block`, và nâng cấp các màn `SCR-07` (Kết quả giữ chỗ), `SCR-08` (Tài khoản khách), `SCR-09..12` (Đơn của tôi / Chi tiết / Huỷ / Đổi ngày), `SCR-13` (Hồ sơ & điểm thưởng).

## Căn cứ

- Thiết kế màn hình: [thiet-ke-man-hinh.md](../../04-thiet-ke/thiet-ke-man-hinh.md) (`SCR-01`, `SCR-07..SCR-13`)
- Nợ kỹ thuật: [no-ky-thuat.md](../../07-ban-giao/no-ky-thuat.md) (`TD-42`)
- Nền tảng tham chiếu: `Impeccable/amanoi-dig/amanoi-dig/clone/`

## Tiêu chí nghiệm thu

1. Đóng gói tối thiểu 6 ảnh `.webp` nghỉ dưỡng vào `apps/customer-web/public/images/pine-hill/` không phụ thuộc mạng ngoài.
2. `TD-42`: `apps/customer-web/src/app/layout.tsx` tích hợp `GuestHeader` và `GuestFooter` nhất quán; không dùng thẻ `<aside>` bên trong `<main>`, không gây trùng lặp selector ở `/access-denied` (`shell.spec.ts`).
3. Trang chủ `SCR-01` giữ nguyên `data-testid="search-block"` và `ApiProbe`; các màn `SCR-07..13` giữ nguyên toàn bộ `data-testid` (`booking-result`, `login-screen`, `bookings-list`, `booking-detail-code`, `cancel-screen`, `reschedule-screen`, `profile-card`) và đạt 0 vi phạm axe serious/critical.

## Ngoài phạm vi

- Không giữ làm đổi chữ ký `TD-42` mặc định (`consentVersion = '2026-10'`).

## Cổng phải xanh

`pnpm check:scope` · `corepack pnpm --filter @pinehill/customer-web typecheck` · `corepack pnpm --filter @pinehill/customer-web test` · `tests/e2e/scr01-tim-phong.spec.ts`, `scr07`, `scr09-10`, `scr11`, `scr12`, `scr13`, `guest-auth.spec.ts`
