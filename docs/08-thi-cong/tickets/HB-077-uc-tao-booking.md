---
id: HB-077
title: UC + endpoint POST /bookings + confirm — snapshot ORIGINAL, cờ nghi trùng
risk: R2
owner: codex
max_lines: 700
allow:
  - apps/api/src/modules/book/bookings/**
  - apps/api/test/bookings/**
---

# HB-077 — UC + endpoint POST /bookings + confirm — snapshot ORIGINAL, cờ nghi trùng

## Mục tiêu

Tạo booking từ hold/quote hợp lệ với snapshot giá + chính sách bất biến; xác nhận chỉ khi đủ điều kiện; booking hết hạn không bao giờ "sống lại".

## Căn cứ

- ADR-014, ADR-015 (3, 4), ADR-016; api.md §3.2; FR-BOOK-01, FR-BOOK-05, FR-BOOK-08; UC-BOOK-01; BR-BOOK-09, BR-BOOK-16, BR-BOOK-18
- Phụ thuộc: HB-076, HB-013 (xác thực), HB-014 (`@Permission`, phạm vi cơ sở), HB-009 (`AuditWriter`)

## Tiêu chí nghiệm thu

1. Mỗi quote chỉ chấp nhận một lần; ghi `price_snapshots` kind ORIGINAL (gồm `policy_snapshot_json`, `engine_version`, fingerprint) cùng transaction.
2. Đặt lặp cùng khách/kỳ/loại phòng trong 24 giờ → trả booking cũ kèm `duplicateSuspected` (BR-BOOK-16).
3. `confirm` chỉ từ HELD/PENDING_PAYMENT còn hạn (giờ CSDL); hết hạn → lỗi, không đổi trạng thái (BR-BOOK-18).
4. `GET /bookings`, `GET /bookings/{id}` theo quyền: khách chỉ thấy booking của mình; nhân viên theo phạm vi cơ sở; HOUSEKEEPING không có tuyến.

## Ngoài phạm vi

Thanh toán (HB-094, HB-096); huỷ/đổi ngày (HB-097, HB-098).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
