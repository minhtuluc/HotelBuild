-- HB-238 (TD-12): bảng tạo sau baseline nhận quyền theo `ALTER DEFAULT PRIVILEGES` của baseline
-- (`SELECT, INSERT, UPDATE, DELETE` cho `app_rw`). Baseline ghi "mọi migration PHẢI chạy lại khối REVOKE",
-- nhưng 0002…0010 không làm: bảng tiền `refund_payout_operations` và các sổ bền chỉ ghi thêm vẫn xoá được
-- bằng role runtime. Thu lại đúng quyền mã không dùng (đã rà `apps/api`, `apps/worker`):
--   * không mã nào DELETE/TRUNCATE các bảng dưới ⇒ thu DELETE, TRUNCATE;
--   * `channel_sync_attempts`, `refund_payout_simulator_transfers` chỉ INSERT (… DO NOTHING), lịch sử trạng thái
--     `booking_status_history` (baseline) chỉ INSERT ⇒ thu cả UPDATE. Xoá cứng booking DRAFT/HELD vẫn cascade
--     được vì hành động khoá ngoại chạy bằng quyền chủ bảng (như `price_snapshots`).
-- `channel_cancel_tombstones` dùng `ON CONFLICT … DO UPDATE` nên giữ UPDATE. `pin_grants` giữ CRUD mặc định như
-- các bảng xác thực khác (HB-010, `auth-sessions.spec.ts`).
-- Test `apps/api/test/migration/table-privileges.spec.ts` khoá quyền thực của `app_rw` trên MỌI bảng: bảng
-- mới chưa được quyết quyền ⇒ test đỏ (tự động hoá yêu cầu "chạy lại khối REVOKE").

BEGIN;

REVOKE DELETE, TRUNCATE ON
  refund_payout_operations,
  channel_cancel_tombstones,
  channel_sales_closures,
  overbooking_scan_runs,
  operations
FROM app_rw, app_ro, analytics_ro;

REVOKE UPDATE, DELETE, TRUNCATE ON
  channel_sync_attempts,
  refund_payout_simulator_transfers,
  booking_status_history
FROM app_rw, app_ro, analytics_ro;

COMMIT;
