---
id: HB-192
title: Hồ sơ bàn giao: ma trận truy vết, README tái lập máy sạch, danh mục nợ kỹ thuật
risk: R0
owner: gemini
max_lines: 400
allow:
  - docs/**
  - README.md
unlock:
  - docs/00-tong-quan.md
  - docs/01-yeu-cau/**
---

# HB-192 — Hồ sơ bàn giao: ma trận truy vết, README tái lập máy sạch, danh mục nợ kỹ thuật

## Mục tiêu

Người mới tái lập được hệ thống trên máy sạch và lần được mọi yêu cầu tới mã/test.

## Căn cứ

- lộ trình M8; QG-4; [ma trận truy vết](../../06-truy-vet/ma-tran-truy-vet.md)
- Phụ thuộc: HB-190, HB-191

## Tiêu chí nghiệm thu

1. README chạy được từ máy sạch (người khác thử, ghi kết quả).
2. Ma trận truy vết không còn ô bắt buộc trống không giải thích; `npm run check:ids` xanh.
3. Nợ kỹ thuật còn mở có hạn và người nhận.

## Cổng phải xanh

`npm run check`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
