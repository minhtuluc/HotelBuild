---
id: HB-172
title: QA F8 — đối chiếu số báo cáo với SQL, RBAC báo cáo, Chromium + WebKit
risk: R0
owner: gemini
max_lines: 400
allow:
  - tests/e2e/f8/**
  - docs/07-ban-giao/bang-chung-f8.md
---

# HB-172 — QA F8 — đối chiếu số báo cáo với SQL, RBAC báo cáo, Chromium + WebKit

## Mục tiêu

Chứng minh điều kiện hoàn tất F8 trên API thật + dữ liệu mô phỏng.

## Căn cứ

- TC-REP-01…04, TC-NOTI-01, TC-NOTI-02; [lộ trình thi công](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §7.10
- Phụ thuộc: HB-162…HB-169

## Tiêu chí nghiệm thu

1. Số mỗi báo cáo khớp truy vấn SQL độc lập (đính kèm truy vấn) trên cùng dữ liệu.
2. MANAGER không thấy báo cáo tài chính; xuất CSV khớp màn hình.
3. Chromium + WebKit + axe; bằng chứng `docs/07-ban-giao/bang-chung-f8.md`.

## Cổng phải xanh

`pnpm check:scope` · `npm run check:docs` · log chạy trong PR

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
