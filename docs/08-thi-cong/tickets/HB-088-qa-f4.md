---
id: HB-088
title: QA F4 — journey khách trên 2 web + Android, Chromium + WebKit + Maestro
risk: R0
owner: gemini
max_lines: 500
allow:
  - tests/e2e/f4/**
  - tests/maestro/**
  - docs/07-ban-giao/bang-chung-f4.md
---

# HB-088 — QA F4 — journey khách trên 2 web + Android, Chromium + WebKit + Maestro

## Mục tiêu

Chứng minh điều kiện hoàn tất F4 (mốc M5) trên API thật + seed.

## Căn cứ

- TC-BOOK-16, TC-BOOK-17, TC-RATE-21, TC-BOOK-28; [lộ trình thi công](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §7.6
- Phụ thuộc: HB-074…HB-087

## Tiêu chí nghiệm thu

1. Giá khớp giữa API, customer web, customer Android (sai 0 VND) trên ít nhất 3 kỳ mẫu.
2. Hold hết hạn tự giải phóng (đẩy thời gian bằng cấu hình test) và màn hình cập nhật đúng.
3. Chromium + WebKit + axe; Maestro cho Android (BLOCKED nếu không có thiết bị).
4. Bằng chứng ghi `docs/07-ban-giao/bang-chung-f4.md`.

## Cổng phải xanh

`pnpm check:scope` · `npm run check:docs` · log chạy trong PR

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
