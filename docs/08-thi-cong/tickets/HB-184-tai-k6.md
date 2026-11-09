---
id: HB-184
title: k6: 200 VU (60% đọc / 30% ghi / 10% báo cáo) + spike 600 VU
risk: R2
owner: claude
max_lines: 900
allow:
  - tests/load/**
  - .github/workflows/**
  - docs/07-ban-giao/van-hanh/**
  - docs/08-thi-cong/tickets/HB-184-tai-k6.md
  - tests/e2e/f5/qa-f5-lib.mjs
unlock:
  - .github/workflows/**
---

# HB-184 — k6: 200 VU (60% đọc / 30% ghi / 10% báo cáo) + spike 600 VU

## Mục tiêu

Chứng minh hệ thống đạt NFR hiệu năng ở tải mục tiêu và chịu được đột biến.

## Căn cứ

- NFR-PERF-01…03; TC-INV-10, TC-REP-04; kế hoạch kiểm thử §7 (kịch bản A/B/C)
- Phụ thuộc: HB-175, HB-181

## Tiêu chí nghiệm thu

1. Kịch bản k6 trong `tests/load/` dùng dữ liệu giả; chạy trên staging cấu hình giống production.
2. 200 VU: p95 tra cứu tồn < 800 ms, p95 API khác < 400 ms, lỗi < 0,1%; spike 600 VU: 5xx < 1%.
3. Báo cáo kèm dashboard HB-181; bất biến tiền/tồn sau tải vẫn đúng (chạy truy vấn kiểm).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · chạy thật trên staging, log trong PR

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).

## Quyết định tự đưa ra (09/11/2026)

- `max_lines` 500 ⇒ 900: bộ gồm 4 kịch bản, thư viện chung, runner cục bộ, SQL bất biến và tài liệu.
- Lượt staging **BLOCKED** vì phụ thuộc HB-175 (ngoài phạm vi được giao). Thay vào đó có runner cục bộ `tests/load/chay-cuc-bo.mjs`; số đo ghi rõ là cục bộ, không dùng để tuyên bố đạt NFR. Không thêm workflow CI cho k6 vì cần môi trường staging.
- KB-B dừng ở bước giữ chỗ: đây là bước có tranh chấp khoá; tạo booking sau hold không có tranh chấp mới.
