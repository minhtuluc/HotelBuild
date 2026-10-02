---
id: HB-109
title: SCR-37 thu cọc/thu số dư tại quầy (operations web)
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/operations-web/src/app/(ops)/**
  - apps/operations-web/test/scr37-thu-tien-ops/**
  - tests/e2e/scr37-thu-tien-ops.spec.ts
---

# HB-109 — SCR-37 thu cọc/thu số dư tại quầy (operations web)

## Mục tiêu

Màn hình F5: SCR-37 thu cọc/thu số dư tại quầy (operations web).

## Căn cứ

- SCR-37; UC-PAY-01, UC-PAY-03; thiết kế màn hình §8.1
- Phụ thuộc: HB-106, HB-096

## Tiêu chí nghiệm thu

1. Đòi PIN (web nhập PIN qua hộp thoại → `pin/verify`); in biên lai; không có ô dữ liệu thẻ.
2. 9 trạng thái, axe sạch; E2E trên API giả (HB-116).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Nhiều ticket F5 cùng sửa một app: mỗi ticket chỉ thêm tuyến của mình; file dùng chung (layout, menu) sửa tối thiểu và rebase khi xung đột.
