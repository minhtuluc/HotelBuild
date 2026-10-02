---
id: HB-057
title: UC + endpoint gói giá và chính sách huỷ — validate bậc, version, snapshot bất biến
risk: R2
owner: codex
max_lines: 600
allow:
  - apps/api/src/modules/rate/rate-plans/**
  - apps/api/src/modules/rate/cancellation-policies/**
  - apps/api/test/rate/policies/**
---

# HB-057 — Gói giá và chính sách huỷ

## Căn cứ

- api.md §2.4 (`rate-plans`, `cancellation-policies`), §2.14; FR-RATE-19; UC-RATE-06; BR-CANCEL-01, BR-CANCEL-02, BR-CANCEL-09, BR-RATE-16, BR-RATE-20; ADR-015; TC-RATE-27, TC-SYS-11
- Engine huỷ `@pinehill/domain/cancellation` (HB-053) — validate bậc bằng cùng hàm của engine; hợp đồng HB-050
- OPEN-03 mặc định ([lộ trình](../lo-trinh-den-deploy.md#5-quyết-định-còn-mở) mục 6): sửa chỉ áp báo giá mới; booking cũ đọc `price_snapshots.policy_snapshot_json`
- Phụ thuộc chung: HB-013 (guard xác thực), HB-014 (`@Permission` + `modules/<mod>/permissions.ts`), HB-009 (`AuditWriter`), HB-018 (seed cho test)

## Tiêu chí nghiệm thu

1. `GET /rate-plans` công khai (QĐ, PR #35): chỉ điều khoản hiển thị, không lộ cấu hình nội bộ; lọc theo cơ sở/kỳ.
2. `PUT /rate-plans/{id}` và `PUT /cancellation-policies/{id}` (OWNER, If-Match, `reason`): thay **toàn bộ** bậc trong một transaction; bậc trùng mốc/thiếu catch-all/phần trăm sai → `E_RATE_CONFIGURATION_INVALID` với chỉ số bậc lỗi.
3. **Bất biến snapshot:** test tạo booking giả có snapshot policy cũ → sửa policy → tính huỷ booking đó vẫn ra số theo policy cũ (TC-RATE-27 phần backend).
4. Không có tuyến ghi lên snapshot (§2.14) — test khẳng định.
5. Audit before/after; `pnpm run ci` + `pnpm test:integration` xanh.
