---
id: HB-098
title: reschedule + xoá cứng DRAFT/HELD — giữ ORIGINAL bất biến
risk: R2
owner: codex
max_lines: 600
allow:
  - apps/api/src/modules/book/reschedule/**
  - apps/api/test/doi-ngay/**
---

# HB-098 — reschedule + xoá cứng DRAFT/HELD — giữ ORIGINAL bất biến

## Mục tiêu

Đổi ngày không đổi trạng thái booking, lưu snapshot RESCHEDULE mới mà giữ nguyên ORIGINAL; giá giảm không sinh hoàn; xoá cứng chỉ cho DRAFT/HELD chưa phát sinh thanh toán.

## Căn cứ

- ADR-015 (7); api.md §2.5; FR-BOOK-12, FR-BOOK-15; UC-BOOK-06; BR-BOOK-12, BR-BOOK-13, BR-BOOK-17, BR-CANCEL-08
- Phụ thuộc: HB-053, HB-077, HB-076, HB-029, HB-013 (xác thực), HB-014 (`@Permission`, phạm vi cơ sở), HB-009 (`AuditWriter`)

## Tiêu chí nghiệm thu

1. Lần đầu ≥ 168h miễn phí theo gói; NONREF phí 10%; vượt số lần → lỗi kèm gợi ý huỷ + đặt mới (BR-BOOK-12).
2. Đổi ngày giữ chỗ mới theo đúng luồng HB-076 (khoá, kiểm tồn) và nhả chỗ cũ trong cùng transaction.
3. Xoá cứng ghi audit `beforeJson` đầy đủ **trước** khi xoá (BR-BOOK-17); có thanh toán → `E_BOOK_HARD_DELETE_FORBIDDEN`.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Codex có thể viết test khoá rồi giao phần còn lại cho DeepSeek (QĐ-04).
