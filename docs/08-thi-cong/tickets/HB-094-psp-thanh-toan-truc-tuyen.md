---
id: HB-094
title: Adapter VNPay/MoMo + POST /payments/online + GET /payments/{id}/status
risk: R2
owner: codex
max_lines: 700
allow:
  - apps/api/src/modules/pay/online/**
  - apps/api/src/modules/pay/psp/**
  - apps/api/test/psp-thanh-toan-truc-tuyen/**
---

# HB-094 — Adapter VNPay/MoMo + POST /payments/online + GET /payments/{id}/status

## Mục tiêu

Khởi tạo thanh toán trực tuyến với số tiền khớp nghĩa vụ, không lưu dữ liệu thẻ; chưa có sandbox thì dùng adapter giả lập **cùng hợp đồng** để đổi sang thật chỉ bằng cấu hình.

## Căn cứ

- ADR-016; api.md §3.5, §5.2; FR-PAY-03, FR-PAY-04; UC-PAY-02; BR-PAY-01…05; [lộ trình đến deploy](../lo-trinh-den-deploy.md#5-quyết-định-còn-mở) mục 2 (sandbox)
- Phụ thuộc: HB-090, HB-029, HB-077, HB-093, HB-013 (xác thực), HB-014 (`@Permission`, phạm vi cơ sở), HB-009 (`AuditWriter`)

## Tiêu chí nghiệm thu

1. `orderRef` bền, gắn booking + khoản; số tiền = nghĩa vụ hiện tại (cọc hoặc số dư), lệch → `E_PAY_AMOUNT_MISMATCH`.
2. Bắt đầu thanh toán **không** gia hạn hold (ADR-014); hold hết hạn trước khi PSP trả kết quả thì tiền thu muộn đi vào hoàn (BR-BOOK-18).
3. `status` đọc từ CSDL, không gọi PSP mỗi lần poll.
4. Adapter giả lập ký/verify đúng thuật toán tài liệu PSP; bí mật đọc từ config; không log tham số nhạy cảm.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Codex có thể viết test khoá rồi giao phần còn lại cho DeepSeek (QĐ-04).
