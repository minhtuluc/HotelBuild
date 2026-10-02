---
id: HB-173
title: Nghiệm thu F8
risk: R0
owner: opus
max_lines: 200
allow:
  - docs/07-ban-giao/bang-chung-f8.md
  - docs/08-thi-cong/backlog-f8-f9.md
---

# HB-173 — Nghiệm thu F8

## Mục tiêu

Lead ký F8.

## Căn cứ

- [lộ trình thi công](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §7.10
- Phụ thuộc: HB-172

## Tiêu chí nghiệm thu

1. Mọi ticket F8 merge hoặc chuyển pha có lý do; P0/P1 đóng; báo cáo đối soát được.

## Cổng phải xanh

`npm run check:docs`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
