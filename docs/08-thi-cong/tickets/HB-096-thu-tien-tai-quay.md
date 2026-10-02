---
id: HB-096
title: POST /payments tại quầy + GET /bookings/{id}/balance — đòi pinToken (dùng cho cả F7)
risk: R2
owner: codex
max_lines: 500
allow:
  - apps/api/src/modules/pay/counter/**
  - apps/api/src/modules/pay/balance/**
  - apps/api/test/thu-tien-tai-quay/**
---

# HB-096 — POST /payments tại quầy + GET /bookings/{id}/balance — đòi pinToken (dùng cho cả F7)

## Mục tiêu

Lễ tân thu cọc/số dư/phạt tại quầy với PIN; booking chỉ CONFIRMED khi đủ cọc; số dư tách rõ thu/nợ/đang giữ cho hoàn.

## Căn cứ

- api.md §2.6; FR-PAY-05, FR-PAY-06; UC-PAY-01, UC-PAY-03; BR-PAY-01, BR-PAY-02, BR-PAY-06, BR-RBAC-05; TC-FO-06
- `requirePinToken` (HB-015)
- Phụ thuộc: HB-093, HB-015, HB-029, HB-013 (xác thực), HB-014 (`@Permission`, phạm vi cơ sở), HB-009 (`AuditWriter`)

## Tiêu chí nghiệm thu

1. Thiếu/hết hạn/đã dùng `pinToken` → `E_AUTH_PIN_REQUIRED`; token cấp cho booking khác → từ chối.
2. Thu đủ cọc → chuyển CONFIRMED cùng transaction; ghi người thu, phương thức, không ghi dữ liệu thẻ.
3. `balance` đọc từ ledger HB-093.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Codex có thể viết test khoá rồi giao phần còn lại cho DeepSeek (QĐ-04).
