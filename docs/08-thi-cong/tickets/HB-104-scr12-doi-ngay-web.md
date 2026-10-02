---
id: HB-104
title: SCR-12 đổi ngày (customer web)
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/customer-web/src/app/(guest)/**
  - apps/customer-web/test/scr12-doi-ngay-web/**
  - tests/e2e/scr12-doi-ngay-web.spec.ts
---

# HB-104 — SCR-12 đổi ngày (customer web)

## Mục tiêu

Màn hình F5: SCR-12 đổi ngày (customer web).

## Căn cứ

- SCR-12; UC-BOOK-06; BR-BOOK-12; thiết kế màn hình §8.1
- Phụ thuộc: HB-102, HB-098

## Tiêu chí nghiệm thu

1. Hiện chênh lệch + phí theo gói trước xác nhận; trạng thái booking không đổi sau khi đổi ngày.
2. 9 trạng thái, axe sạch; E2E trên API giả (HB-116).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Nhiều ticket F5 cùng sửa một app: mỗi ticket chỉ thêm tuyến của mình; file dùng chung (layout, menu) sửa tối thiểu và rebase khi xung đột.
