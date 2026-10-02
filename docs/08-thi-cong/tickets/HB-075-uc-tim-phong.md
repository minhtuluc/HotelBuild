---
id: HB-075
title: UC + endpoint GET /inventory/availability (tìm phòng trống)
risk: R1
owner: deepseek
max_lines: 400
allow:
  - apps/api/src/modules/inv/availability/**
  - apps/api/test/availability/**
---

# HB-075 — UC + endpoint GET /inventory/availability (tìm phòng trống)

## Mục tiêu

Khách tìm phòng trống theo kỳ lưu trú; kết quả đúng engine HB-032 trên dữ liệu thật.

## Căn cứ

- api.md §3.8; UC-INV-02; BR-INV-01, BR-INV-02, BR-INV-07, BR-BOOK-03
- Loader dữ kiện tồn `modules/inv/facts` (HB-034)
- Phụ thuộc: HB-070, HB-034

## Tiêu chí nghiệm thu

1. Công khai, có rate limit cơ bản; không lộ số tồn chính xác vượt mức tài liệu cho phép (theo ví dụ §3.8).
2. Kỳ có một đêm hết → trả hết phòng cho loại đó; đơn vị DOR tính theo giường.
3. Test tích hợp trên seed: 3 kỳ mẫu khớp tính tay.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
