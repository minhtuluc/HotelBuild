---
id: HB-303
title: Chuyển đổi 4 màn trọng yếu có wireframe của Customer Web (SCR-02, SCR-03, SCR-04/05, SCR-06)
risk: R1
owner: gemini
max_lines: 900
allow:
  - apps/customer-web/src/app/(guest)/search/**
  - apps/customer-web/src/app/(guest)/rooms/**
  - apps/customer-web/src/app/(guest)/book/**
  - apps/customer-web/src/app/(guest)/booking/[bookingId]/pay/**
  - apps/customer-web/src/lib/i18n.ts
  - apps/customer-web/test/**
unlock:
  - docs/08-thi-cong/tickets/HB-3*.md
---

# HB-303 — 4 màn trọng yếu có wireframe trên Customer Web

> Tự soạn từ lộ trình frontend (`HB-300+`). Dựng lại luồng đặt phòng & thanh toán của khách theo phong cách Amanoi Editorial Resort (`Persuade` / `Experience`).

## Mục tiêu

Nâng cấp 4 màn trọng yếu của hành trình đặt phòng trên `customer-web`: `SCR-02` (Kết quả tìm phòng), `SCR-03` (Chi tiết phòng & bảng giá từng đêm), `SCR-04`/`SCR-05` (Chọn gói giá, điều khoản huỷ & xác nhận thông tin khách), và `SCR-06` (Thanh toán trực tuyến VNPay/MoMo), đảm bảo tính minh bạch từng đêm giá máy chủ trả (`BR-RATE-17`) và bảo toàn bộ chọn E2E.

## Căn cứ

- Thiết kế màn hình: [thiet-ke-man-hinh.md](../../04-thiet-ke/thiet-ke-man-hinh.md) (`SCR-02`, `SCR-03`, `SCR-04`, `SCR-05`, `SCR-06`)
- Nghiệp vụ: UC-INV-02, UC-RATE-05, UC-BOOK-01, UC-PAY-02, BR-INV-01, BR-INV-07, BR-RATE-17, BR-PAY-03, BR-PAY-04, TC-RATE-21, NFR-USE-05

## Tiêu chí nghiệm thu

1. `SCR-02` (`results-screen.tsx`): Hiển thị thanh tiêu chí kỳ lưu trú và bảng/thẻ `availability-table` với hàng `availability-row-*`, giá `tabular-nums`, đường kẻ 1px và nút CTA ≥ 44px.
2. `SCR-03` (`room-detail-screen.tsx`, `quote-tables.tsx`): Hình ảnh không gian phòng + bộ chọn gói giá + bảng giá từng đêm `nights-table` + tóm tắt báo giá kiểu `.list-lines`, hiển thị cảnh báo hết hạn báo giá rõ ràng.
3. `SCR-04`/`SCR-05` (`book-screen.tsx`): Hiển thị rõ bước 4/4, khối điều khoản huỷ `plan-terms`, biểu mẫu `guest-form` và cảnh báo nghi trùng `duplicate-prompt` theo đúng E2E.
4. `SCR-06` (`payment-screen.tsx`, `payment-panels.tsx`, `payment.module.css`): Bố cục thanh toán tĩnh tại, tóm tắt giữ chỗ, chọn VNPay/MoMo đạt tương phản WCAG AA và hỗ trợ bàn phím.

## Ngoài phạm vi

- Không tự tính lại giá hoặc chính sách huỷ ở client.

## Cổng phải xanh

`pnpm check:scope` · `corepack pnpm --filter @pinehill/customer-web typecheck` · `corepack pnpm --filter @pinehill/customer-web test` · các E2E `scr02-03`, `scr04-05`, `scr06`
