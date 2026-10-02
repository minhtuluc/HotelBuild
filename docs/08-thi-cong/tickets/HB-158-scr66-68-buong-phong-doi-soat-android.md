---
id: HB-158
title: SCR-66 buồng phòng + SCR-68 đối soát nhanh theo ngày (operations Android)
risk: R1
owner: deepseek
max_lines: 650
allow:
  - apps/operations-android/app/**
  - apps/operations-android/src/**
  - apps/operations-android/test/**
  - tests/maestro/**
---

# HB-158 — SCR-66 buồng phòng + SCR-68 đối soát nhanh theo ngày (operations Android)

## Mục tiêu

Màn hình tác nghiệp hiện trường: SCR-66 buồng phòng + SCR-68 đối soát nhanh theo ngày (operations Android).

## Căn cứ

- SCR-66, SCR-68; UC-FO-03, UC-PAY-05; BR-RBAC-03, BR-FO-06; thiết kế màn hình §8.1, §8.3
- Phụ thuộc: HB-148, HB-150, HB-022

## Tiêu chí nghiệm thu

1. HOUSEKEEPING chỉ thấy danh sách việc của mình; chụp ảnh xin quyền đúng ngữ cảnh.
2. SCR-68 hiện tổng thu theo (người thu, ngày VN) và báo chênh lệch; không chốt thay kế toán nếu vai trò không có quyền.
3. Test logic Vitest; kịch bản Maestro trong `tests/maestro/`; nhãn trợ năng đủ.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · bundle Hermes; Maestro/smoke thiết bị ghi `BLOCKED` nếu không có máy

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Nhiều ticket cùng sửa app operations Android: mỗi ticket thêm màn của mình, file điều hướng dùng chung sửa tối thiểu và rebase khi xung đột.
