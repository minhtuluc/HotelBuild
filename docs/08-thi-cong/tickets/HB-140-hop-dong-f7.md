---
id: HB-140
title: Hợp đồng F7 — check-in/out, no-show, buồng phòng, khách tại quầy, chốt đối soát ngày
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

# HB-140 — Hợp đồng F7 — check-in/out, no-show, buồng phòng, khách tại quầy, chốt đối soát ngày

## Mục tiêu

`packages/contracts` đủ endpoint tiền sảnh để backend HB-144…151 và màn hình web/Android làm song song. Thu tiền tại quầy và số dư đã có ở HB-090 (HB-096) — dùng lại.

## Căn cứ

- api.md §2 FO (`/front-office/check-in`, `/check-out`, `/no-show`), `/housekeeping/tasks` (GET, PATCH `{taskId}`), `GET/POST /guests`, `POST /reconciliation/daily/close`, walk-in qua `POST /bookings` kênh WALKIN
- FR-FO-01…08, FR-CRM-01; UC-FO-01…04, UC-CRM-01, UC-PAY-05
- Phụ thuộc: HB-090

## Tiêu chí nghiệm thu

1. Schema trong `src/front-office.ts`, `src/housekeeping.ts`, `src/guest.ts`, `src/reconciliation.ts`; path `src/openapi/paths/f7.ts`.
2. Check-out và chốt đối soát là endpoint 🔒 (`pinToken` trong body); lệnh ghi có `Idempotency-Key`; PATCH task có If-Match.
3. DTO buồng phòng chỉ có dữ liệu nhiệm vụ tối thiểu (phòng, trạng thái, ghi chú, người giao) — **không** có trường booking/khách/tiền (BR-RBAC-03); test khẳng định.
4. Mã lỗi: `E_FO_CHECKIN_NOT_ALLOWED`, `E_CRM_PHONE_INVALID`, `E_BOOK_BLACKLISTED`, `E_AUTH_PIN_REQUIRED`, `E_PAY_AMOUNT_MISMATCH` gắn đúng response.
5. `check:contract` 0 phá vỡ; client `createFrontOfficeApi`, `createHousekeepingApi`, `createGuestApi`.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `npm run check:docs`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
