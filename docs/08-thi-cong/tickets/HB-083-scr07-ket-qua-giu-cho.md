---
id: HB-083
title: SCR-07 kết quả đặt & đếm ngược giữ chỗ (customer web)
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/customer-web/src/app/(guest)/booking/**
  - apps/customer-web/test/scr07-ket-qua-giu-cho/**
  - tests/e2e/scr07-ket-qua-giu-cho.spec.ts
---

# HB-083 — SCR-07 kết quả đặt & đếm ngược giữ chỗ (customer web)

## Mục tiêu

Màn hình journey khách: SCR-07 kết quả đặt & đếm ngược giữ chỗ (customer web).

## Căn cứ

- SCR-07; UC-BOOK-04; TC-BOOK-28; [thiết kế màn hình](../../04-thiet-ke/thiet-ke-man-hinh.md) §8.1 (9 trạng thái)
- Phụ thuộc: HB-082

## Tiêu chí nghiệm thu

1. Đồng hồ đếm theo `expiresAt` của máy chủ (không theo đồng hồ máy khách); hết hạn khoá nút tiếp tục.
2. Không suy thành công từ URL/redirect; luôn đọc lại trạng thái từ API.
3. E2E trên API giả (HB-079).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Tuyến route thực tế theo cấu trúc app hiện có; đổi tuyến thì cập nhật `allow` bằng giải trình trong PR.
