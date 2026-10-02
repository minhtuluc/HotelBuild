---
id: HB-111
title: SCR-39 đối soát + SCR-69 (operations web)
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/operations-web/src/app/(ops)/**
  - apps/operations-web/test/scr39-69-doi-soat-ops/**
  - tests/e2e/scr39-69-doi-soat-ops.spec.ts
---

# HB-111 — SCR-39 đối soát + SCR-69 (operations web)

## Mục tiêu

Màn hình F5: SCR-39 đối soát + SCR-69 (operations web).

## Căn cứ

- SCR-39, SCR-69; UC-PAY-05; BR-PAY-06, BR-PAY-10; thiết kế màn hình §8.1
- Phụ thuộc: HB-109

## Tiêu chí nghiệm thu

1. Đối soát theo (người thu, ngày VN), cảnh báo lệch. SCR-69 chưa rõ tiêu đề trong catalogue: người làm đọc thiết kế màn hình và ghi lựa chọn vào PR.
2. 9 trạng thái, axe sạch; E2E trên API giả (HB-116).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Nhiều ticket F5 cùng sửa một app: mỗi ticket chỉ thêm tuyến của mình; file dùng chung (layout, menu) sửa tối thiểu và rebase khi xung đột.
