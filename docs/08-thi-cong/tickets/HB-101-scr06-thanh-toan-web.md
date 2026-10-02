---
id: HB-101
title: SCR-06 thanh toán trực tuyến (customer web)
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/customer-web/src/app/(guest)/**
  - apps/customer-web/test/scr06-thanh-toan-web/**
  - tests/e2e/scr06-thanh-toan-web.spec.ts
---

# HB-101 — SCR-06 thanh toán trực tuyến (customer web)

## Mục tiêu

Màn hình F5: SCR-06 thanh toán trực tuyến (customer web).

## Căn cứ

- SCR-06; UC-PAY-02; TC-PAY-22; thiết kế màn hình §8.1
- Phụ thuộc: HB-079, HB-094, HB-116

## Tiêu chí nghiệm thu

1. Chọn VNPay/MoMo, chuyển hướng, quay lại thì **đọc lại** `GET /payments/{id}/status` có điểm dừng polling; không tự đánh dấu đã trả.
2. Callback muộn: hiện "đã nhận tiền, đang xử lý" mà không tự chuyển booking xác nhận.
3. 9 trạng thái, axe sạch; E2E trên API giả (HB-116).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Nhiều ticket F5 cùng sửa một app: mỗi ticket chỉ thêm tuyến của mình; file dùng chung (layout, menu) sửa tối thiểu và rebase khi xung đột.
