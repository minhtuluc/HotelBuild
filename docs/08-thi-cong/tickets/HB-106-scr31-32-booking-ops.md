---
id: HB-106
title: SCR-31 + SCR-32 danh sách & chi tiết booking (operations web)
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/operations-web/src/app/(ops)/**
  - apps/operations-web/test/scr31-32-booking-ops/**
  - tests/e2e/scr31-32-booking-ops.spec.ts
---

# HB-106 — SCR-31 + SCR-32 danh sách & chi tiết booking (operations web)

## Mục tiêu

Màn hình F5: SCR-31 + SCR-32 danh sách & chi tiết booking (operations web).

## Căn cứ

- SCR-31, SCR-32; UC-BOOK-07; BR-BOOK-17, BR-RBAC-02; thiết kế màn hình §8.1
- Phụ thuộc: HB-020, HB-077

## Tiêu chí nghiệm thu

1. Lọc + phân trang máy chủ; chỉ cơ sở trong phạm vi; xoá cứng chỉ hiện với DRAFT/HELD.
2. 9 trạng thái, axe sạch; E2E trên API giả (HB-116).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Nhiều ticket F5 cùng sửa một app: mỗi ticket chỉ thêm tuyến của mình; file dùng chung (layout, menu) sửa tối thiểu và rebase khi xung đột.
