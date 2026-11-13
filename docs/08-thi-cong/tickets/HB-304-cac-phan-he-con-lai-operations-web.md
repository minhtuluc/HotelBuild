---
id: HB-304
title: Chuyển đổi các phân hệ còn lại của Operations Web và xử lý TD-41 (trạng thái quá tải 503)
risk: R1
owner: gemini
max_lines: 1200
allow:
  - apps/operations-web/src/**
  - apps/operations-web/test/**
unlock:
  - docs/08-thi-cong/tickets/HB-3*.md
---

# HB-304 — Các phân hệ còn lại của Operations Web & TD-41

> Tự soạn từ lộ trình frontend (`HB-300+`). Hoàn thiện giao diện Quiet Editorial Back-office cho toàn bộ các màn hình còn lại của `operations-web` và xử lý nợ kỹ thuật `TD-41`.

## Mục tiêu

Đồng bộ ngôn ngữ thiết kế Pine Hill–Amanoi cho toàn bộ các màn hình vận hành còn lại: danh mục F2 (`properties`, `room-types`, `rooms`, `room-blocks`, `day-board`, `channel-allotments`, `audit-logs`, `system-settings`, `admin/users`), giá & kênh F3 (`rate-calendar`, `seasons`, `channels`, `promotions`, `multi-channel-quote`, `rate-plans`), booking & tài chính F5 (`bookings`, `bookings/new`, `reschedule`, `cancel`, `refunds`, `early-checkout`, `reconciliation`), xử lý OTA/quá tải F6 (`hb132..hb138`), và báo cáo/CRM F8 (`crm`, `noti`, `reports`). Đồng thời xử lý `TD-41` bổ sung hiển thị rõ ràng trạng thái `503` quá tải hệ thống.

## Căn cứ

- Thiết kế màn hình: [thiet-ke-man-hinh.md](../../04-thiet-ke/thiet-ke-man-hinh.md)
- Nợ kỹ thuật: [no-ky-thuat.md](../../07-ban-giao/no-ky-thuat.md) (`TD-41`)
- Nghiệp vụ: BR-RATE-03, BR-RATE-04, BR-OVER-01, BR-OVER-15, UC-REP-01, UC-REP-02

## Tiêu chí nghiệm thu

1. Toàn bộ bảng biểu, thẻ chi tiết, bộ lọc, hộp thoại xác nhận và thông báo lỗi trên các phân hệ còn lại dùng biến CSS từ `@pinehill/ui-web`, đường kẻ 1px, khoảng cách đều và vùng chạm ≥ 44px.
2. `TD-41`: `screen-state.ts` / `screen-alert.tsx` nhận diện đúng `503` / `E_GEN_SERVICE_UNAVAILABLE` và hiển thị thông điệp tạm quá tải + hướng dẫn thử lại bằng từ điển i18n, không làm gãy các ca test cũ.
3. Không phát sinh chuỗi tiếng Việt viết cứng ngoài danh mục i18n và mọi file dưới ngưỡng 400 dòng ESLint.

## Ngoài phạm vi

- Không sửa API/backend hoặc thay đổi test E2E đã khoá.

## Cổng phải xanh

`pnpm check:scope` · `corepack pnpm --filter @pinehill/operations-web typecheck` · `corepack pnpm --filter @pinehill/operations-web test` · `tests/e2e/operations-web/screens.spec.ts`
