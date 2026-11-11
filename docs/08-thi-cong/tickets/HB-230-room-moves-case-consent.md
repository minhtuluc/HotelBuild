---
id: HB-230
title: RoomMove lưu ca quá tải và bằng chứng đồng ý của khách (TD-80, QA-F6-05)
risk: R2
owner: claude
max_lines: 300
allow:
  - apps/api/prisma/migrations/0011_room_move_case_consent/migration.sql
  - apps/api/prisma/schema.prisma
  - apps/api/src/modules/over/moves/create.ts
  - apps/api/src/modules/over/moves/service.ts
  - apps/api/src/modules/over/moves/validation.ts
  - apps/api/src/modules/over/views.ts
  - apps/api/test/over/room-move-case-consent.spec.ts
  - docs/04-thiet-ke/csdl.md
  - docs/07-ban-giao/no-ky-thuat.md
  - docs/08-thi-cong/tickets/HB-230-room-moves-case-consent.md
---

# HB-230 — RoomMove lưu `overbookingCaseId` và `consent`

## Vấn đề

`roomMoveCreateRequestSchema` / `roomMoveSchema` đã công bố `overbookingCaseId` và `consent`, nhưng bảng `room_moves` không có cột tương ứng. Máy chủ nhận hai trường rồi luôn trả `null` (QA HB-194, QA-F6-05; TD-80).

Hệ quả:

- muốn biết ca quá tải nào sinh ra lệnh điều chuyển nào thì phải suy từ booking và đêm lưu trú;
- bằng chứng đồng ý của khách (BR-OVER-06) chỉ nằm trong `reason`/audit.

## Thay đổi

- **Migration 0011:**
  - `room_moves.overbooking_case_id uuid REFERENCES overbooking_cases ON DELETE RESTRICT`;
  - `consent_json jsonb`, với CHECK phải là object;
  - index một phần theo ca.
  - Cả hai cột nullable, không điền lại cho lệnh cũ. `csdl.md` §3 cập nhật DDL vì đây là oracle của test catalog.
- **Ghi:**
  - chỉ lưu đồng ý **do client gửi**, kèm `recordedAt` (giờ máy chủ nếu client không gửi);
  - giá trị mặc định `{granted: true, IN_PERSON}` mà validation điền để đối chiếu hợp đồng **không** được lưu như thể là bằng chứng.
- **Kiểm:** ca quá tải được tham chiếu phải còn mở, trong phạm vi, và **cùng cơ sở** với booking.
- **Đọc:** `moveView` trả `overbookingCaseId` / `consent` từ DB.

## Tiêu chí nghiệm thu

1. Lệnh gắn ca + đồng ý ⇒ DB và `GET /room-moves/{id}` trả đúng. Test: `apps/api/test/over/room-move-case-consent.spec.ts::HB230_move_keeps_case_and_client_consent_in_db_and_view`.
2. Không gửi đồng ý ⇒ `consent_json` NULL, view `consent: null`. Test: `…::HB230_missing_consent_is_not_stored_as_server_default`.
3. Ca thuộc cơ sở khác ⇒ 400/403. Test: `…::HB230_case_of_another_property_is_rejected`.
4. `pnpm db:drift` không lệch; `test/migration/**` (catalog ↔ csdl §3) và `test/over/**` xanh, test khoá không sửa.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · integration `apps/api`.
