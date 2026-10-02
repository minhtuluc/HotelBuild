---
id: HB-107
title: SCR-33 + SCR-34 tạo booking tại quầy / qua điện thoại (operations web)
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/operations-web/src/app/(ops)/**
  - apps/operations-web/test/scr33-34-tao-booking-ops/**
  - tests/e2e/scr33-34-tao-booking-ops.spec.ts
---

# HB-107 — SCR-33 + SCR-34 tạo booking tại quầy / qua điện thoại (operations web)

## Mục tiêu

Màn hình F5: SCR-33 + SCR-34 tạo booking tại quầy / qua điện thoại (operations web).

## Căn cứ

- SCR-33, SCR-34; FR-BOOK-02, FR-BOOK-03; UC-BOOK-02, UC-BOOK-03; thiết kế màn hình §8.1
- Phụ thuộc: HB-106, HB-076, HB-077

## Tiêu chí nghiệm thu

1. Tại quầy ≤ 5 bước; kênh PHONE dùng `holdMinutes` của kênh; giá hiển thị theo quote.
2. 9 trạng thái, axe sạch; E2E trên API giả (HB-116).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Nhiều ticket F5 cùng sửa một app: mỗi ticket chỉ thêm tuyến của mình; file dùng chung (layout, menu) sửa tối thiểu và rebase khi xung đột.
