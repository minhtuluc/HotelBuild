---
id: HB-238
title: Thu quyền xoá của app_rw trên bảng sau baseline + cổng tự động cho bảng mới (TD-12)
risk: R2
owner: claude
max_lines: 250
allow:
  - apps/api/prisma/migrations/0012_revoke_post_baseline/migration.sql
  - apps/api/test/migration/table-privileges.spec.ts
  - docs/04-thiet-ke/csdl.md
  - docs/07-ban-giao/no-ky-thuat.md
  - docs/08-thi-cong/tickets/HB-238-quyen-bang-sau-baseline.md
---

# HB-238 — Quyền bảng sau baseline (TD-12)

## Vấn đề

Baseline cấp `SELECT, INSERT, UPDATE, DELETE` mặc định cho `app_rw` trên bảng tạo về sau và ghi "mọi migration PHẢI chạy lại khối REVOKE". Đây là yêu cầu bằng lời, và 0002…0010 đều không làm. Hệ quả: role runtime xoá được bảng tiền `refund_payout_operations` và các sổ bền chỉ ghi thêm.

## Thay đổi

- **Migration 0012** (đã rà `apps/api`, `apps/worker`: không mã nào xoá các bảng này):
  - thu `DELETE, TRUNCATE` trên `refund_payout_operations`, `channel_cancel_tombstones`, `channel_sales_closures`, `overbooking_scan_runs`, `operations`;
  - thu `UPDATE, DELETE, TRUNCATE` trên `channel_sync_attempts`, `refund_payout_simulator_transfers` (chỉ INSERT … DO NOTHING) và `booking_status_history` (chỉ INSERT).
  - Giữ nguyên `channel_cancel_tombstones` UPDATE (`ON CONFLICT DO UPDATE`) và `pin_grants` (CRUD mặc định như bảng xác thực, theo HB-010).
- **Cổng tự động:** `test/migration/table-privileges.spec.ts` so quyền thực của `app_rw` trên **mọi** bảng với danh sách kỳ vọng tường minh (APPEND_ONLY / NO_DELETE / còn lại FULL), và không bảng nào có `TRUNCATE`.
- `csdl.md` §3 khối quyền cập nhật theo.

## Tiêu chí nghiệm thu

1. Test quyền xanh; bỏ 0012 ⇒ đỏ.
2. `pnpm db:drift` không lệch; `test/migration/**` xanh.
3. Không phá đường nào đang dùng: xoá cứng booking DRAFT/HELD (`test/doi-ngay/hard-delete.spec.ts`) vẫn cascade lịch sử; các bộ bookings/hoàn/chi hoàn/kênh/OTA/OVER và toàn bộ worker xanh.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · integration `apps/api` + worker.
