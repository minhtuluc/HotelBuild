---
id: HB-155
title: SCR-64 ghi no-show (operations Android)
risk: R1
owner: deepseek
max_lines: 650
allow:
  - apps/operations-android/app/**
  - apps/operations-android/src/**
  - apps/operations-android/test/**
  - tests/maestro/**
---

# HB-155 — SCR-64 ghi no-show (operations Android)

## Mục tiêu

Màn hình tác nghiệp hiện trường: SCR-64 ghi no-show (operations Android).

## Căn cứ

- SCR-64; UC-FO-04; TC-FO-07; thiết kế màn hình §8.1, §8.3
- Phụ thuộc: HB-147, HB-022

## Tiêu chí nghiệm thu

1. Hiện số tiền bị tính + đếm ngược tới 23:59 trước xác nhận; ≤ 4 chạm, ≤ 45 giây.
2. Test logic Vitest; kịch bản Maestro trong `tests/maestro/`; nhãn trợ năng đủ.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · bundle Hermes; Maestro/smoke thiết bị ghi `BLOCKED` nếu không có máy

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Nhiều ticket cùng sửa app operations Android: mỗi ticket thêm màn của mình, file điều hướng dùng chung sửa tối thiểu và rebase khi xung đột.
