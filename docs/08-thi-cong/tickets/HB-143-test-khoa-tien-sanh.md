---
id: HB-143
title: Test khoá tiền sảnh — check-in, check-out, no-show trên PG16
risk: R2
owner: codex
max_lines: 600
allow:
  - apps/api/test/front-office/**
---

# HB-143 — Test khoá tiền sảnh — check-in, check-out, no-show trên PG16

## Mục tiêu

Viết trước bộ test khoá thể hiện các bất biến tiền sảnh, để DeepSeek hiện thực HB-144, HB-145, HB-147 mà không tự nới.

## Căn cứ

- BR-FO-01, BR-FO-05, BR-FO-06, BR-FO-07, BR-RBAC-05, BR-CANCEL-10; TC-FO-01, TC-FO-02, TC-FO-05, TC-FO-06, TC-FO-07
- Phụ thuộc: HB-141, HB-142, HB-096, HB-013, HB-014, HB-009

## Tiêu chí nghiệm thu

1. File `front-office.locked.spec.ts` (Supertest + PG16 + seed), đỏ lúc merge vì chưa có endpoint.
2. Check-in: chưa CONFIRMED → `E_FO_CHECKIN_NOT_ALLOWED`; còn nợ ngoài ngưỡng → chặn; MANAGER cho nợ trong ngưỡng → được; sau 23:59 → chặn; phòng chưa sẵn sàng (task chưa DONE/INSPECTED hoặc còn khách cũ) → không giao được.
3. Check-out: thiếu PIN → `E_AUTH_PIN_REQUIRED`; còn nợ → không in hoá đơn, không giải phóng; thu đủ → giải phóng assignment + sinh `HousekeepingTask` ngày trả phòng; phụ thu muộn đúng TC-FO-03.
4. No-show: chỉ CONFIRMED chưa check-in; áp bậc cuối + phụ thu đêm đầu theo snapshot; sau xác nhận không thu thêm (TC-FO-07).
5. Audit cùng transaction cho mọi thao tác; ép lỗi audit → rollback.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Merge test khoá trên nhánh `ticket/HB-143-test-khoa-tien-sanh` trước khi giao HB-144/145/147.
