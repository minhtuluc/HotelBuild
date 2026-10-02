---
id: HB-154
title: SCR-59 + SCR-60 + SCR-61 thu số dư, khách đi, trả muộn (operations Android)
risk: R1
owner: deepseek
max_lines: 650
allow:
  - apps/operations-android/app/**
  - apps/operations-android/src/**
  - apps/operations-android/test/**
  - tests/maestro/**
---

# HB-154 — SCR-59 + SCR-60 + SCR-61 thu số dư, khách đi, trả muộn (operations Android)

## Mục tiêu

Màn hình tác nghiệp hiện trường: SCR-59 + SCR-60 + SCR-61 thu số dư, khách đi, trả muộn (operations Android).

## Căn cứ

- SCR-59, SCR-60, SCR-61; UC-FO-02, UC-PAY-03; TC-FO-06; thiết kế màn hình §8.1, §8.3
- Phụ thuộc: HB-145, HB-096, HB-022

## Tiêu chí nghiệm thu

1. Thu số dư qua `withPin` (HB-022); không hiển thị/nhập dữ liệu thẻ.
2. Check-out ≤ 4 chạm, ≤ 90 giây; phụ thu muộn hiện số API trả.
3. Test logic Vitest; kịch bản Maestro trong `tests/maestro/`; nhãn trợ năng đủ.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · bundle Hermes; Maestro/smoke thiết bị ghi `BLOCKED` nếu không có máy

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Nhiều ticket cùng sửa app operations Android: mỗi ticket thêm màn của mình, file điều hướng dùng chung sửa tối thiểu và rebase khi xung đột.
