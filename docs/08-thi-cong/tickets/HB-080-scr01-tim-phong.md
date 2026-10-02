---
id: HB-080
title: SCR-01 trang chủ & khối tìm phòng (customer web)
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/customer-web/src/app/(guest)/page.tsx
  - apps/customer-web/src/app/(guest)/search/**
  - apps/customer-web/test/scr01-tim-phong/**
  - tests/e2e/scr01-tim-phong.spec.ts
---

# HB-080 — SCR-01 trang chủ & khối tìm phòng (customer web)

## Mục tiêu

Màn hình journey khách: SCR-01 trang chủ & khối tìm phòng (customer web).

## Căn cứ

- SCR-01; UC-INV-02; [thiết kế màn hình](../../04-thiet-ke/thiet-ke-man-hinh.md) §8.1 (9 trạng thái)
- Phụ thuộc: HB-079, HB-075

## Tiêu chí nghiệm thu

1. Chọn cơ sở, ngày nhận/trả, số khách; validate tại chỗ; gửi tìm.
2. 9 trạng thái, axe sạch, 360 px không cuộn ngang.
3. E2E trên API giả (HB-079).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Tuyến route thực tế theo cấu trúc app hiện có; đổi tuyến thì cập nhật `allow` bằng giải trình trong PR.
