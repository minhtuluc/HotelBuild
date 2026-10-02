---
id: HB-117
title: QA F5 — tiền, huỷ/hoàn, đổi ngày trên 4 bề mặt
risk: R0
owner: gemini
max_lines: 500
allow:
  - tests/e2e/f5/**
  - tests/maestro/**
  - docs/07-ban-giao/bang-chung-f5.md
---

# HB-117 — QA F5 — tiền, huỷ/hoàn, đổi ngày trên 4 bề mặt

## Mục tiêu

Chứng minh điều kiện hoàn tất F5 (mốc M6) trên API thật + seed + PSP giả lập.

## Căn cứ

- TC-BOOK-23, TC-BOOK-27, TC-PAY-22, TC-PAY-23, TC-SYS-10; [lộ trình thi công](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §7.7
- Phụ thuộc: HB-093…HB-116

## Tiêu chí nghiệm thu

1. Callback PSP trùng/muộn không tạo tiền thứ hai, màn hình hiện đúng.
2. Tự duyệt hoàn bị chặn ở mọi mức tiền; > 5 triệu cần MANAGER+.
3. Không màn hình nào hiển thị dữ liệu thẻ; Chromium + WebKit + axe; Maestro Android (BLOCKED nếu không có thiết bị).
4. Bằng chứng ghi `docs/07-ban-giao/bang-chung-f5.md`.

## Cổng phải xanh

`pnpm check:scope` · `npm run check:docs` · log chạy trong PR

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
