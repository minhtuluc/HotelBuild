---
id: HB-156
title: SCR-62 tra cứu booking & khách (operations Android)
risk: R1
owner: deepseek
max_lines: 650
allow:
  - apps/operations-android/app/**
  - apps/operations-android/src/**
  - apps/operations-android/test/**
  - tests/maestro/**
---

# HB-156 — SCR-62 tra cứu booking & khách (operations Android)

## Mục tiêu

Màn hình tác nghiệp hiện trường: SCR-62 tra cứu booking & khách (operations Android).

## Căn cứ

- SCR-62; UC-BOOK-07, UC-CRM-01; BR-CRM-04; thiết kế màn hình §8.1, §8.3
- Phụ thuộc: HB-149, HB-022

## Tiêu chí nghiệm thu

1. Tìm theo mã/SĐT/tên; hiện cờ danh sách đen; che PII theo vai trò.
2. Test logic Vitest; kịch bản Maestro trong `tests/maestro/`; nhãn trợ năng đủ.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · bundle Hermes; Maestro/smoke thiết bị ghi `BLOCKED` nếu không có máy

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Nhiều ticket cùng sửa app operations Android: mỗi ticket thêm màn của mình, file điều hướng dùng chung sửa tối thiểu và rebase khi xung đột.
