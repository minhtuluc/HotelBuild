---
id: HB-112
title: SCR-77 thanh toán (customer Android)
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/customer-android/app/**
  - apps/customer-android/src/**
  - apps/customer-android/test/**
---

# HB-112 — SCR-77 thanh toán (customer Android)

## Mục tiêu

Màn hình F5 trên Android: SCR-77 thanh toán (customer Android).

## Căn cứ

- SCR-77; UC-PAY-02; TC-PAY-22; thiết kế màn hình §8.1, §8.3
- Phụ thuộc: HB-084, HB-094

## Tiêu chí nghiệm thu

1. Mở PSP bằng trình duyệt hệ thống/deep link an toàn; quay lại đọc lại trạng thái, không tự đánh dấu đã trả.
2. Test logic Vitest; nhãn trợ năng đủ.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · bundle Hermes; smoke thiết bị ghi `BLOCKED` nếu không có máy

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
