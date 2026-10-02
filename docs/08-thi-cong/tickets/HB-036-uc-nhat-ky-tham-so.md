---
id: HB-036
title: UC + endpoint nhật ký kiểm toán (chỉ đọc) và tham số hệ thống
risk: R1
owner: deepseek
max_lines: 450
allow:
  - apps/api/src/modules/sys/audit-logs/**
  - apps/api/src/modules/sys/settings/**
  - apps/api/test/sys/**
---

# HB-036 — Nhật ký kiểm toán và tham số

## Mục tiêu

`GET /audit-logs` (lọc, phân trang con trỏ, chỉ đọc) và `PUT /system-settings/{key}` (ghi audit cùng transaction, If-Match). `GET /operations/{operationId}` và sao lưu/phục hồi **không** thuộc ticket này (HB-179).

## Căn cứ

- api.md §2.13; FR-SYS-01, FR-SYS-02; UC-SYS-01, UC-SYS-02; BR-SYS-01, BR-SYS-02, BR-SYS-05, BR-GEN-07; TC-SYS-01, TC-SYS-03
- Hợp đồng `system.ts` (HB-030); bảng `audit_logs`, `system_settings`
- Phụ thuộc chung: HB-013 (guard xác thực), HB-014 (`@Permission` + `modules/<mod>/permissions.ts`), HB-009 (`AuditWriter`), HB-018 (seed cho test)

## Tiêu chí nghiệm thu

1. Audit-logs: lọc theo `actorId`, `entityType`, `entityId`, `action`, khoảng thời gian; MANAGER chỉ thấy bản ghi thuộc cơ sở trong phạm vi (ghi rõ cách xác định cơ sở của bản ghi); không có tuyến ghi.
2. Settings: chỉ OWNER; `value` validate theo `value_type`; key không tồn tại → 404; ghi audit kèm before/after + `reason` cùng transaction; ép lỗi audit → không đổi tham số (TC-SYS-03 phần ghi).
3. Đọc tham số dùng chung cho các module khác qua một service có cache ≤ 60 giây, làm mới khi chính tiến trình vừa ghi.
4. `pnpm run ci` + `pnpm test:integration` xanh.
