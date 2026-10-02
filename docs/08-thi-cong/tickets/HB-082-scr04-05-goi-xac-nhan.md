---
id: HB-082
title: SCR-04 chọn gói + SCR-05 thông tin khách & xác nhận (customer web, ≤ 4 bước)
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/customer-web/src/app/(guest)/book/**
  - apps/customer-web/test/scr04-05-goi-xac-nhan/**
  - tests/e2e/scr04-05-goi-xac-nhan.spec.ts
---

# HB-082 — SCR-04 chọn gói + SCR-05 thông tin khách & xác nhận (customer web, ≤ 4 bước)

## Mục tiêu

Màn hình journey khách: SCR-04 chọn gói + SCR-05 thông tin khách & xác nhận (customer web, ≤ 4 bước).

## Căn cứ

- SCR-04, SCR-05; UC-BOOK-01; BR-RATE-19, BR-BOOK-16; NFR-USE-05; [thiết kế màn hình](../../04-thiet-ke/thiet-ke-man-hinh.md) §8.1 (9 trạng thái)
- Phụ thuộc: HB-081

## Tiêu chí nghiệm thu

1. Tổng số bước bắt buộc từ tìm tới xác nhận ≤ 4; điều khoản huỷ của gói hiển thị trước khi xác nhận.
2. `duplicateSuspected` → hỏi khách có muốn tiếp tục không, mở booking cũ.
3. E2E trên API giả (HB-079).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Tuyến route thực tế theo cấu trúc app hiện có; đổi tuyến thì cập nhật `allow` bằng giải trình trong PR.
