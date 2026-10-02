---
id: HB-029
title: Middleware idempotency bền cho mọi lệnh ghi
risk: R2
owner: codex
max_lines: 700
allow:
  - apps/api/src/modules/sys/idempotency/**
  - apps/api/src/common/idempotency/**
  - apps/api/test/idempotency/**
---

# HB-029 — Middleware idempotency bền cho mọi lệnh ghi

## Mục tiêu

Mọi lệnh ghi có `Idempotency-Key` chỉ tạo **một** tác động dù client gửi lại, timeout hay hai request đồng thời; request lặp nhận lại đúng phản hồi đã commit kèm `Idempotency-Replayed: true`.

## Căn cứ

- ADR-017 (1, 2); BR-GEN-08, BR-PAY-03; api.md §1.6; QĐ-03 T9
- csdl §3 `idempotency_keys` (khoá `uq_idempotency_scope`, lease, TTL 24h)
- Phụ thuộc: HB-007, HB-013 (xác thực), HB-014 (`@Permission`, phạm vi cơ sở), HB-009 (`AuditWriter`)

## Tiêu chí nghiệm thu

1. Interceptor/guard Nest áp cho route đánh dấu (vd. `@Idempotent()`); khoá phạm vi `(principalType, principalId, method, path, key)`; hash request chuẩn hoá (canonical JSON).
2. Lần đầu: tạo dòng `IN_PROGRESS` có lease **trong cùng transaction nghiệp vụ** hoặc trước đó với cơ chế bù; commit nghiệp vụ và lưu `response_status/body/headers` cùng transaction để không có trạng thái "đã làm nhưng không lưu kết quả".
3. Lặp cùng hash → trả bản đã lưu + `Idempotency-Replayed: true`; khác hash → 409 `E_SYS_IDEMPOTENCY_KEY_REUSED`; đang `IN_PROGRESS` còn lease → 409 `E_SYS_REQUEST_IN_PROGRESS` (client đã retry được).
4. Kiểm xác thực, quyền, phạm vi **trước** khi trả bản replay (người khác cầm key không đọc được phản hồi).
5. Test PG16: 2 request đồng thời cùng key → 1 tác động; crash giả lập giữa chừng → lease hết hạn cho phép làm lại đúng một lần; mất Redis không ảnh hưởng (chỉ dùng PostgreSQL); dọn key hết hạn bằng job/TTL.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Codex có thể viết test khoá rồi giao phần áp middleware lên từng route cho DeepSeek.
