---
id: HB-157
title: SCR-65 tạo booking walk-in (operations Android)
risk: R1
owner: deepseek
max_lines: 650
allow:
  - apps/operations-android/app/**
  - apps/operations-android/src/**
  - apps/operations-android/test/**
  - tests/maestro/**
---

# HB-157 — SCR-65 tạo booking walk-in (operations Android)

## Mục tiêu

Màn hình tác nghiệp hiện trường: SCR-65 tạo booking walk-in (operations Android).

## Căn cứ

- SCR-65; UC-BOOK-02; TC-BOOK-17; thiết kế màn hình §8.1, §8.3
- Phụ thuộc: HB-151, HB-022

## Tiêu chí nghiệm thu

1. ≤ 5 bước, ≤ 3 phút đo trên 20 lượt thử (ghi log thời gian trong test).
2. Test logic Vitest; kịch bản Maestro trong `tests/maestro/`; nhãn trợ năng đủ.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · bundle Hermes; Maestro/smoke thiết bị ghi `BLOCKED` nếu không có máy

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Nhiều ticket cùng sửa app operations Android: mỗi ticket thêm màn của mình, file điều hướng dùng chung sửa tối thiểu và rebase khi xung đột.
