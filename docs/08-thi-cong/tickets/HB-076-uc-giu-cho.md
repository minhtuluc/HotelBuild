---
id: HB-076
title: UC + endpoint POST/DELETE /holds — khoá theo ADR-014, đúng 1 thắng khi tranh chấp
risk: R2
owner: codex
max_lines: 700
allow:
  - apps/api/src/modules/book/holds/**
  - apps/api/test/holds/**
---

# HB-076 — UC + endpoint POST/DELETE /holds — khoá theo ADR-014, đúng 1 thắng khi tranh chấp

## Mục tiêu

Giữ chỗ có thời hạn mà **không bao giờ** bán trùng: 200 yêu cầu song song cùng đơn vị/đêm qua API chỉ đúng 1 thành công (bản API của US-INF-02).

## Căn cứ

- ADR-014; api.md §3.4; BR-BOOK-04, BR-BOOK-07, BR-INV-02, BR-INV-03; TC-INV-01, TC-INV-02
- Hàng rào CSDL `excl_room_assignments_no_double_booking` (HB-008), map `23P01` → `E_INV_ROOM_TAKEN`
- Phụ thuộc: HB-074, HB-029, HB-008, HB-034, HB-013 (xác thực), HB-014 (`@Permission`, phạm vi cơ sở), HB-009 (`AuditWriter`)

## Tiêu chí nghiệm thu

1. Khoá theo đúng thứ tự ADR-014; kiểm tồn bằng engine HB-032 **sau** khi khoá; `holdExpiresAt = now + Channel.holdMinutes` (giờ CSDL); kênh `holdMinutes = 0` → `E_BOOK_INVALID_STATE`.
2. Tiêu thụ quote hợp lệ (HB-074) hoặc báo lỗi đúng mã; ghi booking `HELD` + `booking_rooms` + assignment trong một transaction.
3. `DELETE /holds/{holdId}` giải phóng ngay, audit.
4. Test tải: 200 request song song (pool ≥ 50) → đúng 1 thành công, còn lại `E_INV_ROOM_TAKEN`/`E_INV_NO_AVAILABILITY`; không còn assignment mồ côi.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
