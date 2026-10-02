---
id: HB-078
title: Worker q.hold-expiry thật — hết hạn và giải phóng nguyên tử
risk: R2
owner: codex
max_lines: 500
allow:
  - apps/worker/src/**
  - apps/worker/test/**
  - apps/api/src/modules/book/expiry/**
---

# HB-078 — Worker q.hold-expiry thật — hết hạn và giải phóng nguyên tử

## Mục tiêu

Hold quá hạn chuyển EXPIRED và trả tồn trong ≤ 60 giây kể cả khi Redis mất; đồng thời sửa TD-01 (worker im lặng khi Redis chết).

## Căn cứ

- ADR-014; BR-INV-04, BR-BOOK-08, BR-BOOK-18; NFR-REL-02; TC-INV-04; [nợ kỹ thuật](../../07-ban-giao/no-ky-thuat.md) TD-01
- Phụ thuộc: HB-006, HB-076, HB-009

## Tiêu chí nghiệm thu

1. Job lặp 30 giây quét `bookings` HELD/PENDING_PAYMENT có `hold_expires_at ≤ now` (giờ CSDL), khoá cùng Booking, chuyển EXPIRED + nhả assignment/allotment + history + audit (+ outbox nếu đã có) **cùng transaction**.
2. Callback thanh toán đến cùng lúc → chỉ một bên thắng, không hồi sinh booking (test hai giao dịch đan chéo).
3. Job đối chiếu 900 giây bắt sót; listener `error` cho Worker/Queue BullMQ log lỗi (đóng TD-01).
4. Test: Redis tắt giữa chừng vẫn giải phóng đúng hạn khi khởi động lại; hold chưa hết hạn không bị đụng.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
