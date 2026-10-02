---
id: HB-142
title: Engine CheckOutFeePolicy thuần — phụ thu trả muộn
risk: R2
owner: codex
max_lines: 300
allow:
  - packages/domain/src/front-office/checkout/**
  - packages/domain/test/front-office/checkout/**
---

# HB-142 — Engine CheckOutFeePolicy thuần — phụ thu trả muộn

## Mục tiêu

Hàm thuần tính phụ thu trả phòng muộn và xác định trả sớm (đi vào chính sách trả sớm của HB-053).

## Căn cứ

- BR-FO-03, BR-FO-05; TC-FO-03; chính sách huỷ (trả phòng sớm theo `earlyCheckoutFreeHours`/`earlyCheckoutRefundPct`)
- Phụ thuộc: HB-141

## Tiêu chí nghiệm thu

1. Trước 12:00 miễn phí; 12:00–18:00 thu 50% giá đêm cuối; sau 18:00 thu 100% (TC-FO-03: 11:30/15:00/19:00 → 0/550.000/1.100.000 với giá đêm cuối 1.100.000).
2. Trả sớm: trả về dữ kiện để tầng ứng dụng gọi engine huỷ HB-053 (không tự tính hoàn).
3. 0 I/O; phủ nhánh ≥ 90%.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Dùng chung subpath `front-office` do HB-141 tạo; chỉ thêm file trong `checkout/` và một dòng export nếu cần.
