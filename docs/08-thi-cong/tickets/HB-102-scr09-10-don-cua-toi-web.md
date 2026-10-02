---
id: HB-102
title: SCR-09 + SCR-10 đơn của tôi (customer web)
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/customer-web/src/app/(guest)/**
  - apps/customer-web/test/scr09-10-don-cua-toi-web/**
  - tests/e2e/scr09-10-don-cua-toi-web.spec.ts
---

# HB-102 — SCR-09 + SCR-10 đơn của tôi (customer web)

## Mục tiêu

Màn hình F5: SCR-09 + SCR-10 đơn của tôi (customer web).

## Căn cứ

- SCR-09, SCR-10; UC-BOOK-07; thiết kế màn hình §8.1
- Phụ thuộc: HB-077, HB-116

## Tiêu chí nghiệm thu

1. Danh sách + chi tiết theo snapshot từng đêm và các khoản thanh toán; chỉ booking của chính khách.
2. 9 trạng thái, axe sạch; E2E trên API giả (HB-116).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Nhiều ticket F5 cùng sửa một app: mỗi ticket chỉ thêm tuyến của mình; file dùng chung (layout, menu) sửa tối thiểu và rebase khi xung đột.
