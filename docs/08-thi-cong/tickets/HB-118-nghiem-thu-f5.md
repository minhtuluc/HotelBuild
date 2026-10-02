---
id: HB-118
title: Nghiệm thu F5 (mốc M6)
risk: R0
owner: opus
max_lines: 200
allow:
  - docs/07-ban-giao/bang-chung-f5.md
  - docs/08-thi-cong/backlog-f4-f5.md
---

# HB-118 — Nghiệm thu F5 (mốc M6)

## Mục tiêu

Lead ký F5.

## Căn cứ

- [lộ trình thi công](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §7.7; [lộ trình đến deploy](../lo-trinh-den-deploy.md) mốc M6
- Phụ thuộc: HB-117

## Tiêu chí nghiệm thu

1. 100% bảng quyết định huỷ/hoàn đạt trên API thật; tự duyệt bị chặn mọi mức tiền.
2. Mọi ticket F5 đã merge hoặc chuyển pha có lý do; P0/P1 đóng.
3. Cập nhật backlog và nợ kỹ thuật.

## Cổng phải xanh

`npm run check:docs`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
