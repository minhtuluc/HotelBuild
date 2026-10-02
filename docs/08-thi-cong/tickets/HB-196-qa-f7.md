---
id: HB-196
title: QA F7 — tiền sảnh web + Android, Chromium + WebKit + Maestro
risk: R0
owner: gemini
max_lines: 500
allow:
  - tests/e2e/f7/**
  - tests/maestro/**
  - docs/07-ban-giao/bang-chung-f7.md
---

# HB-196 — QA F7 — tiền sảnh web + Android, Chromium + WebKit + Maestro

## Mục tiêu

Chứng minh điều kiện hoàn tất F7 trên API thật + seed.

## Căn cứ

- TC-FO-01…08, TC-BOOK-17; [lộ trình thi công](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §7.9
- Phụ thuộc: HB-144…HB-159

## Tiêu chí nghiệm thu

1. Luồng đầy đủ: walk-in → thu cọc → check-in → phụ thu muộn → check-out → việc dọn phòng → giao phòng cho khách tiếp theo.
2. Đo số chạm/thời gian trên Android theo tiêu chí từng màn (Maestro; BLOCKED nếu không có thiết bị, kèm lý do).
3. HOUSEKEEPING không thấy dữ liệu tiền/khách; offline không báo thành công thao tác tiền.
4. Bằng chứng ghi `docs/07-ban-giao/bang-chung-f7.md`.

## Cổng phải xanh

`pnpm check:scope` · `npm run check:docs` · log chạy trong PR

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
