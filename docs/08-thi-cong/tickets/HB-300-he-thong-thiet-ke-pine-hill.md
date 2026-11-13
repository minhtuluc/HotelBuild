---
id: HB-300
title: Hệ thống thiết kế Pine Hill–Amanoi, token màu/font/spacing, Tailwind, component dùng chung và ADR-019
risk: R1
owner: gemini
max_lines: 900
allow:
  - packages/ui-web/**
  - packages/ui-native/**
  - apps/operations-web/src/app/globals.css
  - apps/operations-web/public/fonts/**
  - apps/customer-web/src/app/globals.css
  - apps/customer-web/public/fonts/**
  - docs/04-thiet-ke/adr/**
unlock:
  - docs/08-thi-cong/tickets/HB-3*.md
---

# HB-300 — Hệ thống thiết kế Pine Hill–Amanoi & ADR-019

> Tự soạn từ lộ trình frontend (`HB-300+`). Thiết lập nền tảng thị giác Pine Hill biến đổi từ hệ thống Amanoi (`amanoi-dig`) kết hợp bộ quy tắc `UI-01..UI-18` và `impeccable`.

## Mục tiêu

Xây dựng bộ token thiết kế thống nhất giữa Web (`@pinehill/ui-web`) và Android (`@pinehill/ui-native`), đóng gói font tiếng Việt `Spectral` và `Lyon Display Web` để chạy offline, thiết kế wordmark/biểu tượng thương hiệu `PineHillBrand`, cấu hình Tailwind CSS v4 cho cả hai ứng dụng web, và ghi nhận quyết định kiến trúc tại `ADR-019`.

## Căn cứ

- Tài liệu thiết kế màn hình: [thiet-ke-man-hinh.md](../../04-thiet-ke/thiet-ke-man-hinh.md)
- Nhật ký ADR: [README.md](../../04-thiet-ke/adr/README.md)
- Quy tắc & phi chức năng: BR-GEN-01, BR-INV-01, NFR-USE-01, NFR-USE-02, NFR-LOC-01, NFR-MAIN-02
- Nền tảng tham chiếu: Amanoi Editorial Resort (`Impeccable/amanoi-dig/amanoi-dig/DESIGN.md`)

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Bảng token `@pinehill/ui-web` và `@pinehill/ui-native` giữ nền cát ấm (`#F3EEE7`), bề mặt sáng (`#FDFAF6`), đường kẻ 1px (`#D6D1C7`), màu nhấn xanh thông (`#0F5E56`) và đồng trầm (`#7A562D`); mọi cặp chữ/nền và 9 ô `gridStatus` đạt tương phản WCAG 2.1 AA tối thiểu 4,5:1 — test: `packages/ui-web/test/tokens.spec.ts`, `packages/ui-native/test/ui-native.spec.ts`.
2. Đóng gói các file `.woff2` (`Spectral` 300/400/500 và `Lyon Display Web` 300) vào `apps/operations-web/public/fonts/` và `apps/customer-web/public/fonts/`, khai báo `@font-face` và Tailwind v4 `@theme inline` trong `globals.css`.
3. Tạo component `PineHillBrand` cùng nâng cấp `StateSurface`, `ErrorPanel`, `AccessDeniedPanel` theo phong cách Quiet Editorial, giữ nguyên `role`, `aria-busy` và toàn bộ câu chữ i18n — test: `packages/ui-web/test/states.spec.tsx`, `packages/ui-web/test/panels.spec.tsx`.
4. Ban hành `ADR-019` và cập nhật bảng chỉ mục trong `docs/04-thiet-ke/adr/README.md` hợp lệ với cổng kiểm tài liệu.

## Ngoài phạm vi

- Không sửa `packages/contracts`, `packages/domain`, `apps/api`, `apps/worker`, `infra`.
- Không thay đổi logic nghiệp vụ hay `data-testid` của từng màn hình ứng dụng.

## Cổng phải xanh

`pnpm check:scope` · `npm run check:docs` · `corepack pnpm --filter @pinehill/ui-web test` · `corepack pnpm --filter @pinehill/ui-native test`
