---
id: HB-095
title: Webhook inbox PSP — verify trước dedup, inbox bền trước ACK, callback muộn không hạ trạng thái
risk: R2
owner: codex
max_lines: 600
allow:
  - apps/api/src/modules/pay/webhooks/**
  - apps/api/src/modules/integrations/inbox/**
  - apps/api/test/webhook-psp/**
---

# HB-095 — Webhook inbox PSP — verify trước dedup, inbox bền trước ACK, callback muộn không hạ trạng thái

## Mục tiêu

Callback VNPay/MoMo trùng, đến muộn, sai thứ tự hay giả mạo đều không tạo tiền thứ hai, không làm sai trạng thái; CSDL lỗi thì không ACK thành công.

## Căn cứ

- ADR-017 (3, 4, 5); api.md §5.2; BR-PAY-03, BR-PAY-09, BR-PAY-11; NFR-SEC-05; TC-PAY-22
- csdl §3 `webhook_inbox` (dùng chung với OTA ở HB-128)
- Phụ thuộc: HB-094, HB-091, HB-013 (xác thực), HB-014 (`@Permission`, phạm vi cơ sở), HB-009 (`AuditWriter`)

## Tiêu chí nghiệm thu

1. Thứ tự: verify chữ ký (constant-time) → ghi inbox (`UNIQUE provider, provider_account_id, event_id`) → commit → ACK; verify sai → từ chối, không ghi.
2. Xử lý inbox: khoá theo `(provider, providerTxnId)`; SUCCEEDED đến sau FAILED/timeout vẫn ghi nhận tiền nhưng không hạ trạng thái booking; tiền vào booking đã hết hạn → tạo nghĩa vụ hoàn.
3. Lỗi CSDL khi ghi inbox → trả mã lỗi để PSP gửi lại (không success-ACK).
4. TC-PAY-22; test 5 callback trùng → 1 payment.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Codex có thể viết test khoá rồi giao phần còn lại cho DeepSeek (QĐ-04).
