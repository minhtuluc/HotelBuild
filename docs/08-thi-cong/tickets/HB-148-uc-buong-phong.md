---
id: HB-148
title: UC + endpoint buồng phòng — HOUSEKEEPING chỉ thấy dữ liệu nhiệm vụ
risk: R1
owner: deepseek
max_lines: 500
allow:
  - apps/api/src/modules/fo/housekeeping/**
  - apps/api/test/uc-buong-phong/**
---

# HB-148 — UC + endpoint buồng phòng — HOUSEKEEPING chỉ thấy dữ liệu nhiệm vụ

## Mục tiêu

Nhân viên buồng phòng nhận và cập nhật việc dọn mà không thấy dữ liệu khách/tiền; DONE/INSPECTED làm phòng đủ điều kiện giao nhưng không đổi tồn tương lai.

## Căn cứ

- api.md (`/housekeeping/tasks`); UC-FO-03; BR-RBAC-03, BR-FO-06, BR-FO-07
- Phụ thuộc: HB-140, HB-013, HB-014, HB-009

## Tiêu chí nghiệm thu

1. Response chỉ có trường nhiệm vụ (test so khoá JSON); `assignedTo` chỉ MANAGER/OWNER đổi.
2. Chuyển trạng thái hợp lệ PENDING → IN_PROGRESS → DONE → INSPECTED; sai thứ tự → 409.
3. FRONT_DESK đọc được danh sách task của cơ sở cho SCR-48 (khoảng trống §6.3 — chốt: cho đọc, không cho sửa; ghi vào PR).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
