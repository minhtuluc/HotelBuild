---
id: HB-116
title: API giả E2E F5 — payments, refunds, cancel, reschedule, callback muộn/timeout
risk: R2
owner: codex
max_lines: 400
allow:
  - tests/e2e/fake-api/f5/**
  - tests/e2e/playwright.config.ts
---

# HB-116 — API giả E2E F5 — payments, refunds, cancel, reschedule, callback muộn/timeout

## Mục tiêu

Các màn F5 trên 4 bề mặt chạy E2E được trên API giả có kịch bản thanh toán thành công/thất bại/muộn/timeout, hoàn tiền nhiều trạng thái.

## Căn cứ

- api.md §3.3, §3.5–§3.7, §5.2; TC-PAY-22, TC-BOOK-28; HB-019 (API giả dùng chung)
- Phụ thuộc: HB-079, HB-090

## Tiêu chí nghiệm thu

1. Handler trong `tests/e2e/fake-api/f5/`; endpoint điều khiển để ép kịch bản.
2. E2E cũ vẫn xanh.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
