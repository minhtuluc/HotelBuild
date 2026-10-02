---
id: HB-193
title: Nghiệm thu F9 + cổng go-live
risk: R0
owner: opus
max_lines: 200
allow:
  - docs/07-ban-giao/**
  - docs/08-thi-cong/**
---

# HB-193 — Nghiệm thu F9 + cổng go-live

## Mục tiêu

Lead và người dùng ký đưa hệ thống vào vận hành.

## Căn cứ

- [lộ trình đến deploy](../lo-trinh-den-deploy.md) §4 (14 cổng), §5 (quyết định mở); lộ trình M8; QG-4
- Phụ thuộc: HB-190, HB-191, HB-192

## Tiêu chí nghiệm thu

1. Đủ 14 cổng go-live, mỗi cổng có bằng chứng trên đúng commit phát hành.
2. Mọi quyết định §5 đã chốt hoặc ghi rõ giả định dùng tạm được người dùng chấp nhận.
3. Biên bản go-live có chữ ký người dùng.

## Cổng phải xanh

`npm run check`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
