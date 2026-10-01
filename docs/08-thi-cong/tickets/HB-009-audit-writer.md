---
id: HB-009
title: US-SYS-01 — ghi nhật ký kiểm toán trong cùng transaction
risk: R2
owner: deepseek # giai đoạn B; giai đoạn A do Codex viết test khoá
max_lines: 350
allow:
  - apps/api/src/infrastructure/audit/**
  - apps/api/src/common/actor/**
  - apps/api/test/audit/**
locked:
  - apps/api/test/audit/audit-writer.locked.spec.ts
---

# HB-009 — `AuditWriter` trong cùng transaction

## Mục tiêu

Hạ tầng để mọi use case ghi `audit_logs` **trong cùng transaction** với thay đổi nghiệp vụ; lỗi ghi nhật ký làm rollback cả giao dịch. CSDL đã chặn `UPDATE`/`DELETE` (HB-005); ticket này lo phía ứng dụng.

## Căn cứ

- BR-SYS-01, BR-SYS-05, BR-GEN-07; UC-SYS-01; NFR-SEC-03 (che PII), NFR-SEC-04
- [csdl](../../04-thiet-ke/csdl.md) §3 (`audit_logs`, `trg_audit_logs_hash_chain`), §7
- TC-SYS-01, TC-SYS-02

## Hai giai đoạn

- **A — Codex** (nhánh `lead/HB-009-test-khoa`, merge trước): viết `apps/api/test/audit/audit-writer.locked.spec.ts` chạy trên PG16 thật, đỏ ở thời điểm merge. Các ca: (1) ghi nghiệp vụ + audit trong một transaction, commit thì có cả hai; (2) ép lỗi ở bước audit thì không còn dòng nghiệp vụ nào (TC-SYS-02, dùng một bảng nghiệp vụ có sẵn trong schema); (3) bản ghi đủ trường BR-SYS-05 (actor, role, action, entity, before/after, reason, IP, thời điểm); (4) `before/after` đã che các trường nhạy cảm (`password_hash`, số điện thoại → che giữa); (5) `row_hash`/`prev_hash` nối chuỗi đúng qua 3 bản ghi; (6) dùng `app_rw` thì `UPDATE`/`DELETE` bị từ chối (TC-SYS-01).
- **B — DeepSeek** (nhánh `ticket/HB-009-audit-writer`): hiện thực cho đến khi test khoá xanh, không sửa test khoá.

## Tiêu chí nghiệm thu

1. `AuditWriter.record(tx, entry)` nhận transaction client của Prisma, không tự mở transaction; `entry` có kiểu chặt (không `any`).
2. `ActorContext` tối thiểu trong `src/common/actor/` (id, role, ip, correlationId) — mở rộng ở HB-014.
3. Che PII theo danh sách trường cấu hình trong code (một chỗ), có unit test riêng ngoài test khoá.
4. Thời gian lấy từ `Clock`; không gọi `new Date()` trực tiếp.
5. Test khoá xanh trong job `backend`; `pnpm ci` xanh.

## Ngoài phạm vi

- Audit cho từng module nghiệp vụ (mỗi module tự gọi khi được làm), màn hình tra cứu nhật ký, phân mảnh 0009.

## Cổng phải xanh

`pnpm check:scope` · `pnpm ci` · `pnpm test:integration`
