---
id: HB-187
title: Đối chiếu giá 5 nguồn + đo lại NFR giao diện
risk: R1
owner: deepseek
max_lines: 400
allow:
  - tests/e2e/price-parity/**
  - tests/load/**
  - docs/07-ban-giao/bang-chung-gia.md
---

# HB-187 — Đối chiếu giá 5 nguồn + đo lại NFR giao diện

## Mục tiêu

Giá giống nhau từng VND giữa API và 4 frontend; các NFR giao diện đo lại trên bản phát hành.

## Căn cứ

- BR-RATE-17; NFR-PERF-05; TC-RATE-21
- Phụ thuộc: HB-173, HB-197

## Tiêu chí nghiệm thu

1. Ít nhất 10 kỳ mẫu (mùa, cuối tuần, kênh, khuyến mãi): API + customer web + customer Android + operations web + operations Android sai 0 VND.
2. Lưới tồn 30 ngày ≤ 200 KB gzip; walk-in 20 lượt đo thời gian.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · log chạy trong PR

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
