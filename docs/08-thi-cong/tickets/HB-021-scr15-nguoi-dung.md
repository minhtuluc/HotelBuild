---
id: HB-021
title: SCR-15 — người dùng, vai trò, phạm vi cơ sở (operations web)
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/operations-web/src/app/(ops)/admin/users/**
  - apps/operations-web/test/users/**
  - tests/e2e/ops-users.spec.ts
  - tests/e2e/fake-api/users/**
---

# HB-021 — SCR-15 quản lý người dùng

## Mục tiêu

OWNER/SYSADMIN xem danh sách, tạo người dùng, gán vai trò/phạm vi, khoá/mở và xoá PIN; giao diện chỉ hỗ trợ, máy chủ (HB-016) là nơi cưỡng chế.

## Căn cứ

- [thiết kế màn hình](../../04-thiet-ke/thiet-ke-man-hinh.md) SCR-15, §8.1; UC-AUTH-02; BR-RBAC-01, BR-RBAC-02
- [QĐ-03](../../05-ke-hoach/nhat-ky/QD-03-dinh-danh-phien-f1.md) quyết định 5, 7; hợp đồng `GET/POST /users`, `PUT /users/{userId}/access`, `DELETE /users/{userId}/pin` (HB-011)

## Tiêu chí nghiệm thu

1. `/admin/users`: bảng phân trang con trỏ, lọc theo vai trò/cơ sở/từ khoá; cột vai trò, cơ sở, trạng thái, khoá đến, có PIN.
2. Tạo người dùng: mật khẩu tạm sinh ngẫu nhiên phía trình duyệt bằng `crypto.getRandomValues`, hiện **một lần** để bàn giao, có nút sao chép.
3. Sửa quyền: gửi `If-Match`; 412 → thông báo "dữ liệu đã đổi, tải lại" và tải lại bản mới; 428 không được xảy ra (client luôn gửi).
4. Giao diện ẩn lựa chọn mà người đang đăng nhập không được gán (SYSADMIN không thấy `OWNER`/`SYSADMIN`; không sửa được chính mình) nhưng vẫn hiển thị đúng lỗi 403 nếu máy chủ từ chối.
5. Xoá PIN có hộp xác nhận.
6. Vai trò khác OWNER/SYSADMIN vào tuyến → trang thiếu quyền hiện có.
7. E2E với API giả: tạo, sửa có 412, SYSADMIN không gán được OWNER, xoá PIN; axe; 360 px.
8. `pnpm run ci` + `pnpm test:e2e` xanh.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`
