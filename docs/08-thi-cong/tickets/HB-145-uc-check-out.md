---
id: HB-145
title: UC + endpoint check-out — phụ thu, trả sớm, chốt số dư, sinh việc dọn phòng
risk: R2
owner: deepseek
max_lines: 600
allow:
  - apps/api/src/modules/fo/check-out/**
  - apps/api/test/uc-check-out/**
locked:
  - apps/api/test/front-office/front-office.locked.spec.ts
locked_sha:
  - 524e0193e8b9625b591f0994006b5e5c0959516c96cacaae275b3e0c3d8b6bdf apps/api/test/front-office/front-office.locked.spec.ts
---

# HB-145 — UC + endpoint check-out — phụ thu, trả sớm, chốt số dư, sinh việc dọn phòng

## Mục tiêu

Check-out thu đủ, giải phóng phòng, sinh việc dọn; trả sớm đi đúng chính sách.

## Căn cứ

- api.md (`POST /front-office/check-out`); UC-FO-02; BR-FO-03, BR-FO-05, BR-FO-06, BR-CANCEL-09; TC-FO-03, TC-FO-05
- Phụ thuộc: HB-143, HB-142, HB-053, HB-096

## Tiêu chí nghiệm thu

1. Test khoá HB-143 phần check-out xanh.
2. Phụ thu muộn từ HB-142; trả sớm gọi engine HB-053 với `cancelReason = EARLY_CHECKOUT`; dịch vụ phát sinh ghi `booking_charges` (HB-093).
3. `balanceDue` về 0 trước khi in hoá đơn; tạo `HousekeepingTask` cùng transaction.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
