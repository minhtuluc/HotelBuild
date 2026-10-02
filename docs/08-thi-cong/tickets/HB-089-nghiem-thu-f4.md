---
id: HB-089
title: Nghiệm thu F4 (mốc M5)
risk: R0
owner: opus
max_lines: 200
allow:
  - docs/07-ban-giao/bang-chung-f4.md
  - docs/08-thi-cong/backlog-f4-f5.md
---

# HB-089 — Nghiệm thu F4 (mốc M5)

## Mục tiêu

Lead ký F4.

## Căn cứ

- [lộ trình thi công](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §7.6; [lộ trình đến deploy](../lo-trinh-den-deploy.md) mốc M5
- Phụ thuộc: HB-088

## Tiêu chí nghiệm thu

1. Mọi ticket F4 đã merge hoặc chuyển pha có lý do; P0/P1 đóng.
2. Đặt được booking từ customer web, customer Android và quầy; giá khớp nhau và khớp bảng tính tay; hold tự giải phóng.
3. Cập nhật backlog và nợ kỹ thuật.

## Cổng phải xanh

`npm run check:docs`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
