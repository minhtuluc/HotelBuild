---
id: HB-250
title: Cài `GET /guests/me` và `GET /guests/me/loyalty` cho phiên khách (đã có trong hợp đồng, API chưa có)
risk: R1
owner: claude
max_lines: 300
allow:
  - apps/api/src/modules/crm/guests/**
  - apps/api/test/crm/**
  - docs/08-thi-cong/tickets/HB-250-guests-me.md
unlock:
  - docs/08-thi-cong/tickets/HB-250-guests-me.md
---

# HB-250 — Hồ sơ và điểm của chính khách

> Đặc tả do Claude soạn ngày 17/11/2026 từ lần chạy app khách trên máy thật (HB-249).

## Vấn đề

- `GET /api/v1/guests/me` và `/guests/me/loyalty` có trong OpenAPI (`guestsMe`, `guestsMeLoyalty`, HB-105) và api.md §2.10, nhưng API chưa cài.
- Request rơi vào tuyến nhân viên `GET /guests/:guestId` (với `guestId = "me"`). Khách nhận `403 E_RBAC_FORBIDDEN`, nhân viên nhận `400`.
- Tab Tài khoản của app khách Android vì vậy luôn báo "Không tải được hồ sơ: E_RBAC_FORBIDDEN".

## Thay đổi

1. `GuestsMeController` (`@Controller('guests/me')`, `@Public`). Chủ thể lấy từ `bookingCaller` (cùng cơ chế `GET /bookings` của khách). Phiên nhân viên → 403. Đăng ký trước `GuestsController`.
2. `GuestsService.own` / `ownLoyalty`. Phép tính loyalty tách thành `loyaltyOf`, dùng chung với tuyến theo id. Hồ sơ đã ẩn danh hoá → 404.

## Tiêu chí nghiệm thu (`apps/api/test/crm/guests-me.spec.ts`)

1. Phiên khách đọc đúng hồ sơ của mình, `Cache-Control: no-store`.
2. Phiên nhân viên → 403 `E_RBAC_FORBIDDEN` (không rơi vào tuyến theo id); không token → 401.
3. `me/loyalty` trùng số liệu `GET /guests/{guestId}/loyalty` của OWNER cho cùng khách; nhân viên → 403; không token → 401.

## Ngoài phạm vi

- `PATCH /guests/me` (sửa hồ sơ) — hợp đồng chưa có.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
