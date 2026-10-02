---
id: HB-113
title: SCR-79 + SCR-80 đơn của tôi (customer Android)
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/customer-android/app/**
  - apps/customer-android/src/**
  - apps/customer-android/test/**
---

# HB-113 — SCR-79 + SCR-80 đơn của tôi (customer Android)

## Mục tiêu

Màn hình F5 trên Android: SCR-79 + SCR-80 đơn của tôi (customer Android).

## Căn cứ

- SCR-79, SCR-80; UC-BOOK-07; thiết kế màn hình §8.1, §8.3
- Phụ thuộc: HB-084, HB-077

## Tiêu chí nghiệm thu

1. Danh sách + chi tiết; offline hiện bản đã tải kèm nhãn "có thể đã cũ".
2. Test logic Vitest; nhãn trợ năng đủ.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · bundle Hermes; smoke thiết bị ghi `BLOCKED` nếu không có máy

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
