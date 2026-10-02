---
id: HB-093
title: Ledger: booking_charges, payment_allocations, balanceDue — hoàn không vượt thu
risk: R2
owner: codex
max_lines: 700
allow:
  - apps/api/src/modules/pay/ledger/**
  - apps/api/test/so-cai-tien/**
---

# HB-093 — Ledger: booking_charges, payment_allocations, balanceDue — hoàn không vượt thu

## Mục tiêu

Một nơi duy nhất tính nghĩa vụ, tiền đã thu, đã hoàn, đang giữ cho hoàn và `balanceDue`; mọi module tiền khác gọi qua đây.

## Căn cứ

- ADR-015 (8), ADR-016; BR-PAY-02, BR-CANCEL-19; csdl §3 `booking_charges`, `payment_allocations`, `refund_allocations`
- Phụ thuộc: HB-077, HB-009, HB-013 (xác thực), HB-014 (`@Permission`, phạm vi cơ sở), HB-009 (`AuditWriter`)

## Tiêu chí nghiệm thu

1. `paidAmount` = tổng thu SUCCEEDED, không giảm khi hoàn; REFUND/COMPENSATION không cộng như tiền thu (BR-PAY-02).
2. Bất biến dưới khoá: `refundedSucceeded + refundReserved ≤ collected` theo từng khoản thu và tổng booking; vi phạm → lỗi miền, không ghi.
3. `balanceDue` là projection; booking CANCELLED/NO_SHOW/EXPIRED chỉ còn nợ `penaltyAmount` (thiết kế lớp `Booking.balanceDue`).
4. Test thuộc tính: chuỗi thu/hoàn ngẫu nhiên không bao giờ làm hoàn > thu.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Codex có thể viết test khoá rồi giao phần còn lại cho DeepSeek (QĐ-04).
