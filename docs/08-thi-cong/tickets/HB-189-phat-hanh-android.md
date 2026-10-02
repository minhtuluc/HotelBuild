---
id: HB-189
title: Phát hành Android: EAS build, 2 application ID, EAS Update chỉ vá JS, APK dự phòng
risk: R1
owner: deepseek
max_lines: 400
allow:
  - apps/customer-android/app.json
  - apps/operations-android/app.json
  - apps/customer-android/eas.json
  - apps/operations-android/eas.json
  - .github/workflows/**
  - docs/07-ban-giao/van-hanh/**
unlock:
  - .github/workflows/**
---

# HB-189 — Phát hành Android: EAS build, 2 application ID, EAS Update chỉ vá JS, APK dự phòng

## Mục tiêu

Build được 2 app Android có ký số, cập nhật JS qua EAS Update, và có đường build APK cục bộ khi hết quota EAS.

## Căn cứ

- kiến trúc §7 (`eas-build.yml`); ADR-018
- Phụ thuộc: HB-176

## Tiêu chí nghiệm thu

1. Hai application ID riêng; khoá ký lưu ở EAS secrets (không trong repo).
2. Channel staging/production; EAS Update chỉ áp cho thay đổi JS cùng runtime version.
3. Hướng dẫn build APK cục bộ trong `docs/07-ban-giao/van-hanh/android.md`; smoke trên thiết bị thật (đóng TD-02).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · build EAS/APK, log trong PR

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
