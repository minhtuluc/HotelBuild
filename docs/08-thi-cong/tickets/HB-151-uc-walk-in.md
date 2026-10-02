---
id: HB-151
title: Walk-in — tạo booking kênh WALKIN và thu cọc tại quầy
risk: R1
owner: deepseek
max_lines: 500
allow:
  - apps/api/src/modules/book/walk-in/**
  - apps/api/test/uc-walk-in/**
---

# HB-151 — Walk-in — tạo booking kênh WALKIN và thu cọc tại quầy

## Mục tiêu

Lễ tân tạo booking khách vãng lai nhanh bằng luồng giữ chỗ/đặt phòng có sẵn của F4 và thu cọc bằng HB-096.

## Căn cứ

- api.md (`POST /bookings` kênh WALKIN); UC-BOOK-02; FR-BOOK-02; NFR-USE-05; TC-BOOK-17
- Phụ thuộc: HB-076, HB-077, HB-096, HB-149

## Tiêu chí nghiệm thu

1. Không viết lại khoá tồn/quote: gọi use case F4; kênh WALKIN theo cấu hình kênh.
2. Một lệnh điều phối có thể gộp quote → hold → booking để giao diện ≤ 5 bước; mọi bước con giữ idempotency.
3. TC-BOOK-17 ở mức API (≤ 3 phút do giao diện đo ở HB-152/HB-157).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
