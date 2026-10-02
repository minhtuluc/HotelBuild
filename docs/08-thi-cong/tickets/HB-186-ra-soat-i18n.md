---
id: HB-186
title: Rà i18n toàn bộ: 0 chuỗi cứng, tiền số nguyên, nhãn giờ VN
risk: R0
owner: gemini
max_lines: 300
allow:
  - docs/07-ban-giao/bang-chung-i18n.md
---

# HB-186 — Rà i18n toàn bộ: 0 chuỗi cứng, tiền số nguyên, nhãn giờ VN

## Mục tiêu

Toàn bộ 4 frontend đúng chuẩn bản địa hoá.

## Căn cứ

- NFR-LOC-01…03
- Phụ thuộc: HB-173, HB-197

## Tiêu chí nghiệm thu

1. Quét tự động + rà tay: 0 chuỗi tiếng Việt ngoài danh mục i18n, 0 tiền dạng số thực, 100% mốc thời gian có nhãn giờ VN.
2. Danh sách vi phạm kèm file:dòng.

## Cổng phải xanh

`npm run check:docs`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
