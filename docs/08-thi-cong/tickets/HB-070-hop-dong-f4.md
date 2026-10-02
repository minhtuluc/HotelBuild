---
id: HB-070
title: Hợp đồng F4 — availability, quotes, bookings, confirm, holds
risk: R2
owner: deepseek
max_lines: 800
allow:
  - packages/contracts/src/**
  - packages/contracts/test/**
  - packages/contracts/openapi.json
  - packages/api-client/src/**
  - packages/api-client/test/**
  - packages/ui-web/src/messages.ts
  - packages/ui-web/src/errors.ts
  - packages/ui-web/test/**
  - packages/ui-native/src/stateMessages.ts
  - packages/ui-native/test/**
  - docs/04-thiet-ke/api.md
---

# HB-070 — Hợp đồng F4 — availability, quotes, bookings, confirm, holds

## Mục tiêu

`packages/contracts` mô tả đủ endpoint journey khách để backend (HB-074…078) và 4 màn hình khách làm song song. `rate-plans` đã có ở HB-050 — dùng lại.

## Căn cứ

- api.md §2.3 (`inventory/availability`), §2.4 (`POST /quotes`), §2.5 (`bookings`, `bookings/{bookingId}/confirm`, `holds`, `DELETE holds/{holdId}`), §3.1, §3.2, §3.4, §3.8
- FR-INV-02, FR-BOOK-01; UC-INV-02, UC-BOOK-01, UC-BOOK-04
- Phụ thuộc: HB-050 (đã merge)

## Tiêu chí nghiệm thu

1. Schema trong `src/booking.ts`, `src/quote.ts`; path trong `src/openapi/paths/f4.ts`; khớp ví dụ JSON api.md §3.1/§3.2/§3.4/§3.8 (test parse đúng ví dụ).
2. Mã lỗi gắn đúng response: `E_RATE_QUOTE_EXPIRED` (410), `E_RATE_QUOTE_MISMATCH`, `E_BOOK_*`, `E_INV_NO_AVAILABILITY`, `E_INV_ROOM_TAKEN`, `E_INV_LOCK_TIMEOUT`; lệnh ghi có `Idempotency-Key`.
3. Vai trò theo api.md: `availability`, `quotes` công khai; `bookings`/`holds` GUEST hoặc nhân viên theo bảng.
4. `check:contract` 0 phá vỡ; client `createBookingApi`, `createQuoteApi`; `pnpm run ci` + `npm run check:docs` xanh.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `npm run check:docs`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
