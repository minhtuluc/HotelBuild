---
id: HB-008
title: US-INF-02 — chứng minh chống trùng phòng ở mức CSDL (200 giao dịch song song)
risk: R2
owner: codex
max_lines: 300
allow:
  - apps/api/test/concurrency/**
  - apps/api/src/infrastructure/prisma/**
---

# HB-008 — Chứng minh chống trùng phòng

## Mục tiêu

Tiêu chí US-INF-02: bắn 200 yêu cầu giữ cùng một phòng/đêm, đúng 1 thành công, 199 nhận lỗi xung đột; chạy trong CI. Ở B0 làm ở mức CSDL theo [QĐ-02](../../05-ke-hoach/nhat-ky/QD-02-nen-tang-backend.md) mục 9.

## Căn cứ

- BR-INV-02, BR-INV-03; [ADR-014](../../04-thiet-ke/adr/ADR-014-giao-dich-ton-phong.md)
- [csdl](../../04-thiet-ke/csdl.md) §3 (`room_assignments`, `excl_room_assignments_no_double_booking`, `excl_booking_room_one_assignment`)
- [quy tắc kỹ thuật](../../05-ke-hoach/quy-tac-ky-thuat.md) §5 (SQLSTATE `23P01` → `E_INV_ROOM_TAKEN`); TC-INV-01, TC-INV-02

## Tiêu chí nghiệm thu

1. Hàm hạ tầng `mapPostgresError` trong `apps/api/src/infrastructure/prisma/`: `23P01` trên hai ràng buộc EXCLUDE → `E_INV_ROOM_TAKEN`; mã khác giữ nguyên để tầng trên xử lý. Có unit test.
2. Test `apps/api/test/concurrency/`: 200 transaction chạy song song trên pool ≥ 50 kết nối **độc lập** (PostgreSQL mặc định `max_connections = 100`; không tuần tự hoá phía client, các transaction được giải phóng cùng lúc bằng rào chắn), mỗi transaction chèn assignment cùng `room_id`, cùng đêm, `bed_no = 0`, booking_room khác nhau. Kết quả: đúng 1 commit; 199 lỗi đều là `E_INV_ROOM_TAKEN`; sau cùng CSDL có đúng 1 dòng active.
3. Ca biến thể: phòng DOR với `bed_no` khác nhau cùng đêm đều thành công; `bed_no = 0` chồng `bed_no = 1` bị từ chối; khoảng `[d, d+1)` và `[d+1, d+2)` không xung đột.
4. Dữ liệu dựng bằng SQL trong test (không phụ thuộc seed HB-018), dọn sạch sau test.
5. Chạy trong job `backend` của HB-007; thời gian test ≤ 60 giây.

## Ngoài phạm vi

- Use case giữ chỗ/API `holds` (F4), khoá theo thứ tự ADR-014 ở tầng ứng dụng.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration` · CI job `backend`
