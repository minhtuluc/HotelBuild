---
id: HB-190
title: Checklist go-live + release checklist từng app
risk: R0
owner: gemini
max_lines: 300
allow:
  - docs/07-ban-giao/van-hanh/**
---

# HB-190 — Checklist go-live + release checklist từng app

## Mục tiêu

Một danh sách kiểm duy nhất trước khi bật production, nối với 14 cổng go-live.

## Căn cứ

- [lộ trình đến deploy](../lo-trinh-den-deploy.md) §4; ADR-018; [bàn giao](../../07-ban-giao/huong-dan-thi-cong.md) §5
- Phụ thuộc: HB-177, HB-179, HB-183, HB-188, HB-189

## Tiêu chí nghiệm thu

1. Checklist `docs/07-ban-giao/van-hanh/go-live.md`: mỗi cổng §4 có link bằng chứng; mỗi app có build, contract version, cửa sổ tương thích.
2. Kế hoạch ngày go-live: giờ, người trực, đường liên lạc, tiêu chí dừng và quay lại.

## Cổng phải xanh

`npm run check:docs`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
