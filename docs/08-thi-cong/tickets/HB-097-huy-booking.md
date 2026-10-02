---
id: HB-097
title: cancel-preview + cancel (toàn phần/một phần) — policy snapshot, RefundRequest + reservation
risk: R2
owner: codex
max_lines: 700
allow:
  - apps/api/src/modules/book/cancel/**
  - apps/api/test/huy-booking/**
---

# HB-097 — cancel-preview + cancel (toàn phần/một phần) — policy snapshot, RefundRequest + reservation

## Mục tiêu

Huỷ booking toàn phần hoặc từng phòng theo **snapshot** chính sách lúc đặt; tạo yêu cầu hoàn và giữ hạn mức hoàn ngay trong transaction; hai lần huỷ không dùng lại cùng tiền.

## Căn cứ

- ADR-015, ADR-016; api.md §3.3; FR-BOOK-13; UC-BOOK-08; BR-BOOK-11, BR-BOOK-14, BR-CANCEL-01…07, BR-CANCEL-19; QĐ-05 mục 1; TC-BOOK-27
- Engine huỷ `@pinehill/domain/cancellation` (HB-053)
- Phụ thuộc: HB-053, HB-093, HB-029, HB-013 (xác thực), HB-014 (`@Permission`, phạm vi cơ sở), HB-009 (`AuditWriter`)

## Tiêu chí nghiệm thu

1. `cancel-preview` không đổi trạng thái; `cancel` kiểm lại preview còn đúng (mốc giờ/version) trong transaction, lệch → yêu cầu xem trước lại.
2. Booking chưa xác nhận hoàn đúng số đã thu (QĐ-05); đã xác nhận theo bậc + phụ thu đêm đầu.
3. Huỷ giải phóng assignment/tồn; tạo `refund_requests` + reservation; audit.
4. TC-BOOK-27; test huỷ hai phòng liên tiếp không vượt tổng đã thu.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Codex có thể viết test khoá rồi giao phần còn lại cho DeepSeek (QĐ-04).
