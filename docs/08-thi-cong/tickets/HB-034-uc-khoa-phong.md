---
id: HB-034
title: UC + endpoint khoá phòng (room-blocks) — tồn giảm ngay, khoá đè booking cần MANAGER+ và mở OverbookingCase
risk: R2
owner: codex
max_lines: 600
allow:
  - apps/api/src/modules/prop/room-blocks/**
  - apps/api/src/modules/inv/facts/**
  - apps/api/test/room-blocks/**
---

# HB-034 — Khoá phòng

## Mục tiêu

`POST/DELETE /room-blocks` đúng BR-INV-06: khoá làm tồn giảm ngay; khoá đè lên phòng đã có assignment/booking hiệu lực chỉ MANAGER+ được làm, bắt buộc lý do và mở `OverbookingCase` cho các booking bị ảnh hưởng.

## Căn cứ

- api.md §2.2 (`/room-blocks`); FR-INV-07; UC-PROP-04; BR-INV-06, BR-PROP-06, BR-OVER-03; ADR-014 (thứ tự khoá; "RoomBlock đọc trước tập ảnh hưởng, khoá rồi đọc lại; xuất hiện booking mới thì rollback và thử lại"); TC-PROP-04
- Engine tồn `@pinehill/domain/inventory` (HB-032); bảng `room_blocks`, `room_assignments`, `overbooking_cases`
- Phụ thuộc chung: HB-013 (guard xác thực), HB-014 (`@Permission` + `modules/<mod>/permissions.ts`), HB-009 (`AuditWriter`), HB-018 (seed cho test)

## Tiêu chí nghiệm thu

1. Use case đúng quy trình ADR-014 cho RoomBlock (đọc tập ảnh hưởng → khoá theo thứ tự chuẩn → đọc lại → khác thì rollback và thử lại, tối đa 3 lần rồi `E_INV_LOCK_TIMEOUT`).
2. Không đè booking: FRONT_DESK/MANAGER tạo được; có đè: FRONT_DESK → 403, MANAGER+ phải có `reason` và tạo một `OverbookingCase` cho mỗi (cơ sở, ngày, loại phòng) thiếu — cùng transaction.
3. Sau khi khoá, engine HB-032 trên dữ liệu thật cho tồn giảm đúng; khoá hai lần cùng phòng/ngày chỉ trừ một đơn vị.
4. `DELETE` cần `reason`, ghi audit; không xoá cứng lịch sử (đánh dấu kết thúc nếu schema cho phép, nếu không thì xoá kèm audit `beforeJson` đầy đủ — ghi rõ lựa chọn).
5. **Loader dữ kiện tồn** `modules/inv/facts`: dựng `AvailabilityInput` của HB-032 từ CSDL (đơn vị bán theo `bed_count`, block, assignment, demand mọi kênh, allotment). Dùng chung cho HB-035 và F4.
6. Test PG16: TC-PROP-04; ca tranh chấp hai giao dịch (khoá phòng đúng lúc một booking mới gán vào) → không mất booking, không bỏ sót case.
7. `pnpm run ci` + `pnpm test:integration` xanh.
