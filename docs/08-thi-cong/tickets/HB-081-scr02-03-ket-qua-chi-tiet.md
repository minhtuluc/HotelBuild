---
id: HB-081
title: SCR-02 kết quả + SCR-03 chi tiết phòng & giá từng đêm (customer web)
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/customer-web/src/app/(guest)/search/**
  - apps/customer-web/src/app/(guest)/rooms/**
  - apps/customer-web/test/scr02-03-ket-qua-chi-tiet/**
  - tests/e2e/scr02-03-ket-qua-chi-tiet.spec.ts
---

# HB-081 — SCR-02 kết quả + SCR-03 chi tiết phòng & giá từng đêm (customer web)

## Mục tiêu

Màn hình journey khách: SCR-02 kết quả + SCR-03 chi tiết phòng & giá từng đêm (customer web).

## Căn cứ

- SCR-02, SCR-03; BR-RATE-17; TC-RATE-21; [thiết kế màn hình](../../04-thiet-ke/thiet-ke-man-hinh.md) §8.1 (9 trạng thái)
- Phụ thuộc: HB-080

## Tiêu chí nghiệm thu

1. Bảng giá từng đêm hiển thị đúng số `POST /quotes` trả (không tự tính), có cờ chạm sàn/trần nếu hợp đồng trả.
2. Quote hết hạn → hướng dẫn lấy giá mới, không tự cập nhật giá.
3. E2E trên API giả (HB-079).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Tuyến route thực tế theo cấu trúc app hiện có; đổi tuyến thì cập nhật `allow` bằng giải trình trong PR.
