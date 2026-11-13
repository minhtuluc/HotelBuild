---
id: HB-302
title: Chuyển đổi 4 màn trọng yếu có wireframe của Operations Web (SCR-24, SCR-37, SCR-43, SCR-48)
risk: R1
owner: gemini
max_lines: 900
allow:
  - apps/operations-web/src/app/(ops)/inventory-grid/**
  - apps/operations-web/src/app/(ops)/bookings/[bookingId]/collect/**
  - apps/operations-web/src/features/hb135-scr43-bang-qua-tai/**
  - apps/operations-web/src/app/(ops)/overbooking/cases/**
  - apps/operations-web/src/app/(ops)/front-desk/**
  - apps/operations-web/test/**
unlock:
  - docs/08-thi-cong/tickets/HB-3*.md
---

# HB-302 — 4 màn trọng yếu có wireframe trên Operations Web

> Tự soạn từ lộ trình frontend (`HB-300+`). Chuyển hóa 4 màn vận hành trọng yếu có wireframe sang hệ giao diện Pine Hill–Amanoi.

## Mục tiêu

Tái thiết kế giao diện 4 màn trọng yếu trên `operations-web` gồm `SCR-24` (Lưới tồn phòng theo ngày), `SCR-37` (Thu tiền tại quầy & xác thực PIN), `SCR-43` (Bảng điều khiển ca quá tải), và `SCR-48` (Bàn tiền sảnh) với bố cục mật độ cao chuẩn `Operate`, bảng dữ liệu cột cố định/kẻ chỉ 1px, số tiền `tabular-nums`, và giữ nguyên toàn bộ `data-testid` cũng như luồng nghiệp vụ an toàn.

## Căn cứ

- Thiết kế màn hình: [thiet-ke-man-hinh.md](../../04-thiet-ke/thiet-ke-man-hinh.md) (`SCR-24`, `SCR-37`, `SCR-43`, `SCR-48`)
- Nghiệp vụ & hiệu năng: BR-INV-01, BR-INV-07, BR-PAY-04, BR-RBAC-05, UC-INV-01, UC-PAY-01, UC-FO-01, TC-SYS-10, NFR-PERF-05

## Tiêu chí nghiệm thu

1. `SCR-24`: `inventory-grid-screen.tsx` và `grid-table.tsx` hiển thị `grid-controls`, `GridLegend` 9 trạng thái (ký hiệu + màu từ `@pinehill/ui-web`), cột loại phòng ghim cố định và hỗ trợ bàn phím `←`/`→`/`↑`/`↓`/`Home`/`End`.
2. `SCR-37`: `collect-screen.tsx` / `collect-body.tsx` / `collect-parts.tsx` trình bày bố cục 2 cột rõ ràng giữa tóm tắt công nợ và biểu mẫu thu/nhập PIN, giữ biên lai in sạch và không thu dữ liệu thẻ.
3. `SCR-43`: `features/hb135-scr43-bang-qua-tai/` hiển thị bảng quét `hb135-scan`, danh sách ca quá tải `hb135-row-*`, hộp thoại `hb135-dialog-resolve` rõ ràng tương phản cao.
4. `SCR-48`: `front-desk-screen.tsx`, `desk-tables.tsx`, `action-panel.tsx`, `walk-in-panel.tsx` phân tách rõ tab/khối Đến – Đi – Ở trong ngày và giữ nguyên luồng check-in/check-out/walk-in.

## Ngoài phạm vi

- Không thay đổi logic gọi API, idempotency hay quy tắc PIN phía backend.

## Cổng phải xanh

`pnpm check:scope` · `corepack pnpm --filter @pinehill/operations-web typecheck` · `corepack pnpm --filter @pinehill/operations-web test` · các E2E `inventory-grid.spec.ts`, `scr37-thu-tien-ops.spec.ts`, `hb135-scr43-bang-qua-tai.spec.ts`, `ops-front-desk.spec.ts`
