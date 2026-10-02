---
id: HB-169
title: SCR-51 mẫu & hàng đợi thông báo
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/operations-web/src/app/(ops)/**
  - apps/operations-web/test/scr51-thong-bao/**
  - tests/e2e/scr51-thong-bao.spec.ts
  - tests/e2e/fake-api/f8/**
---

# HB-169 — SCR-51 mẫu & hàng đợi thông báo

## Mục tiêu

Màn hình F8: SCR-51.

## Căn cứ

- SCR-51; UC-NOTI-01, UC-NOTI-02; BR-SYS-06; thiết kế màn hình §8.1
- Phụ thuộc: HB-168

## Tiêu chí nghiệm thu

1. Hiện trạng thái, số lần thử, lỗi; nút gửi lại tắt khi đã đủ 3 lần hoặc chưa đủ 5 phút.
2. 9 trạng thái, axe sạch, 360 px; E2E trên API giả `tests/e2e/fake-api/f8/`.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
