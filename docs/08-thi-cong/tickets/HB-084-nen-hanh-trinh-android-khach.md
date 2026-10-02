---
id: HB-084
title: Nền journey customer Android — điều hướng, deep link, client công khai
risk: R1
owner: deepseek
max_lines: 500
allow:
  - apps/customer-android/app/**
  - apps/customer-android/src/**
  - apps/customer-android/test/**
  - apps/customer-android/app.json
  - apps/customer-android/package.json
  - pnpm-lock.yaml
---

# HB-084 — Nền journey customer Android — điều hướng, deep link, client công khai

## Mục tiêu

Khung điều hướng cho journey khách trên Android: tab tìm phòng/đơn của tôi/tài khoản, deep link `pinehill://booking/<code>`, client gọi được endpoint công khai khi chưa đăng nhập.

## Căn cứ

- SCR-72; ADR-018; NFR-USE-03; thiết kế màn hình §8.3 (offline)
- Phụ thuộc: HB-070, HB-024, HB-012

## Tiêu chí nghiệm thu

1. Điều hướng + deep link có test logic; endpoint công khai không gửi token.
2. Tải màn đầu ≤ 5 giây trên mạng 3G giả lập (đo bằng log thời gian).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · bundle Hermes; smoke thiết bị ghi `BLOCKED` nếu không có máy

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
