---
id: HB-110
title: SCR-38 yêu cầu & duyệt hoàn tiền (operations web)
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/operations-web/src/app/(ops)/**
  - apps/operations-web/test/scr38-duyet-hoan-ops/**
  - tests/e2e/scr38-duyet-hoan-ops.spec.ts
---

# HB-110 — SCR-38 yêu cầu & duyệt hoàn tiền (operations web)

## Mục tiêu

Màn hình F5: SCR-38 yêu cầu & duyệt hoàn tiền (operations web).

## Căn cứ

- SCR-38; UC-PAY-04; TC-PAY-23; thiết kế màn hình §8.1
- Phụ thuộc: HB-106, HB-099, HB-100

## Tiêu chí nghiệm thu

1. Hiện gross/phí/net và hạn mức đang giữ; người lập không thấy nút duyệt; không có nút "chi lại"; PAID chỉ khi có bằng chứng.
2. 9 trạng thái, axe sạch; E2E trên API giả (HB-116).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Nhiều ticket F5 cùng sửa một app: mỗi ticket chỉ thêm tuyến của mình; file dùng chung (layout, menu) sửa tối thiểu và rebase khi xung đột.
