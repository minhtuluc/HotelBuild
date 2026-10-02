---
id: HB-086
title: SCR-74 + SCR-75 chi tiết phòng & gói giá (customer Android)
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/customer-android/app/**
  - apps/customer-android/src/**
  - apps/customer-android/test/**
---

# HB-086 — SCR-74 + SCR-75 chi tiết phòng & gói giá (customer Android)

## Mục tiêu

Màn hình journey khách trên Android: SCR-74 + SCR-75 chi tiết phòng & gói giá (customer Android).

## Căn cứ

- SCR-74, SCR-75; BR-RATE-17; TC-RATE-21; thiết kế màn hình §8.1, §8.3
- Phụ thuộc: HB-085

## Tiêu chí nghiệm thu

1. Giá từng đêm hiển thị đúng số API trả; điều khoản huỷ hiển thị trước xác nhận.
2. Test logic Vitest; nhãn trợ năng đủ.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · bundle Hermes; smoke thiết bị ghi `BLOCKED` nếu không có máy

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
