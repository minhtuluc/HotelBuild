---
id: HB-153
title: SCR-57 + SCR-58 khách đến & check-in (operations Android)
risk: R1
owner: deepseek
max_lines: 650
allow:
  - apps/operations-android/app/**
  - apps/operations-android/src/**
  - apps/operations-android/test/**
  - tests/maestro/**
---

# HB-153 — SCR-57 + SCR-58 khách đến & check-in (operations Android)

## Mục tiêu

Màn hình tác nghiệp hiện trường: SCR-57 + SCR-58 khách đến & check-in (operations Android).

## Căn cứ

- SCR-57, SCR-58; UC-FO-01; BR-FO-01; NFR-USE-05; thiết kế màn hình §8.1, §8.3
- Phụ thuộc: HB-144, HB-022

## Tiêu chí nghiệm thu

1. Check-in ≤ 3 chạm, ≤ 60 giây từ danh sách; quét QR xin quyền camera đúng ngữ cảnh, từ chối không chặn luồng.
2. Offline: danh sách có cache hiện mốc đồng bộ; **không** cho xác nhận check-in khi mất mạng (QĐ-03 quyết định 6).
3. Test logic Vitest; kịch bản Maestro trong `tests/maestro/`; nhãn trợ năng đủ.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · bundle Hermes; Maestro/smoke thiết bị ghi `BLOCKED` nếu không có máy

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Nhiều ticket cùng sửa app operations Android: mỗi ticket thêm màn của mình, file điều hướng dùng chung sửa tối thiểu và rebase khi xung đột.
