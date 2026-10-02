---
id: HB-090
title: Hợp đồng F5 — payments, balance, refund-requests, cancel-preview, cancel, reschedule, xoá booking
risk: R2
owner: deepseek
max_lines: 900
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

# HB-090 — Hợp đồng F5 — payments, balance, refund-requests, cancel-preview, cancel, reschedule, xoá booking

## Mục tiêu

`packages/contracts` mô tả đủ endpoint tiền và huỷ/đổi để backend HB-093…100 và màn hình 4 bề mặt làm song song.

## Căn cứ

- api.md §2.5 (`cancel-preview`, `cancel`, `reschedule`, `DELETE /bookings/{bookingId}`), §2.6 (payments, refund-requests), §3.3, §3.5, §3.6, §3.7, §5.2
- FR-PAY-01…16, FR-BOOK-12, FR-BOOK-13; UC-PAY-01…05, UC-BOOK-06, UC-BOOK-08
- Phụ thuộc: HB-070

## Tiêu chí nghiệm thu

1. Schema trong `src/payment.ts`, `src/refund.ts`, `src/cancellation.ts`; path `src/openapi/paths/f5.ts`; khớp ví dụ JSON §3.3/§3.5/§3.6/§3.7.
2. Endpoint 🔒 (thu tiền tại quầy, duyệt/chi hoàn) khai `pinToken` trong body theo QĐ-01 mục 6; mọi lệnh ghi có `Idempotency-Key`; sửa có If-Match.
3. Không có trường dữ liệu thẻ ở bất kỳ request nào (§2.14, NFR-SEC-02) — test khẳng định.
4. Callback PSP (§5.2) **không** khai trong client frontend; chỉ khai trong OpenAPI để backend dùng.
5. `check:contract` 0 phá vỡ; client `createPaymentApi`, `createRefundApi`; thông điệp UI cho mã `E_PAY_*`, `E_CANCEL_*`.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `npm run check:docs`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
