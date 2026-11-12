---
id: HB-242
title: '`GET /operations/day-board` — đến/đi/ở, ca quá tải, kênh DEGRADED cho SCR-23 (TD-09)'
risk: R1
owner: claude
max_lines: 700
allow:
  - packages/contracts/src/day-board.ts
  - packages/contracts/src/index.ts
  - packages/contracts/src/openapi/paths/f2.ts
  - packages/contracts/openapi.json
  - packages/api-client/src/f2.ts
  - packages/api-client/test/f2-endpoints.spec.ts
  - apps/api/src/modules/inv/day-board/**
  - apps/api/src/app.module.ts
  - apps/api/test/front-office/day-board.spec.ts
  - apps/api/test/rbac/routes/f2-property.ts
  - docs/04-thiet-ke/api.md
  - docs/07-ban-giao/no-ky-thuat.md
  - docs/08-thi-cong/tickets/HB-242-bang-dieu-khien-ngay.md
---

# HB-242 — Bảng điều khiển ngày (TD-09)

> Xếp chồng trên HB-241 (#295) → HB-240 (#294), vì cùng sửa `openapi.json`. Merge theo thứ tự #294 → #295 → PR này.

## Vấn đề

SCR-23 (bảng điều khiển ngày của lễ tân, quản lý và chủ) phải cho thấy khách đến, khách đi, khách đang ở, ca quá tải và kênh lỗi đồng bộ. Nhưng **không tuyến API nào** trả các nhóm này. HB-040 vì vậy chỉ hiện được tồn khả dụng, và TD-09 đặt hạn xử lý trước UAT.

## Thay đổi

- **Hợp đồng `day-board.ts`:** `dayBoardQuerySchema` và `dayBoardSchema`. Mỗi nhóm booking gồm `total`, `items` (tối đa 200 dòng) và `truncated`.
- **`GET /operations/day-board`** (module `inv/day-board`):
  - Quyền FRONT_DESK, MANAGER, OWNER, có kiểm phạm vi cơ sở.
  - Một transaction `RepeatableRead`; `capturedAt` lấy từ đồng hồ CSDL.
  - Thiếu `date` thì dùng hôm nay theo giờ VN của CSDL.
  - Định nghĩa từng nhóm xem README của module.
- **HOUSEKEEPING không được cấp quyền**, vì bảng có tên khách và số dư. Dòng booking không có SĐT hay số giấy tờ (UI-14).
- **`api-client.dayBoard`.**

## Tiêu chí nghiệm thu (`apps/api/test/front-office/day-board.spec.ts`)

1. `HB242_groups_arrivals_departures_in_house_by_business_date`: chia nhóm đúng định nghĩa và loại các booking `CANCELLED`, `HELD` hoặc khác ngày. `balanceDue` lấy từ sổ cái. Không lộ SĐT.
2. `HB242_open_overbooking_cases_and_degraded_channels`: đếm ca từ ngày D trở đi và đúng ngày D, bỏ ca của đêm đã qua. Chỉ liệt kê kênh `ACTIVE` đang `DEGRADED`, bỏ kênh `INACTIVE`.
3. `HB242_default_date_is_vn_business_today_of_database_clock`: thiếu `date` thì lấy hôm nay theo giờ VN của CSDL.
4. `HB242_roles_scope_and_input`: HOUSEKEEPING, ACCOUNTANT, SYSADMIN bị 403; cơ sở lạ 404; ngày sai định dạng hoặc thiếu `propertyId` 400; FRONT_DESK ngoài phạm vi trả `E_AUTH_OUT_OF_SCOPE`.

Trên code cũ cả bốn test đều đỏ vì tuyến chưa tồn tại.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · integration `apps/api/test/front-office/day-board.spec.ts`, `apps/api/test/rbac`.
