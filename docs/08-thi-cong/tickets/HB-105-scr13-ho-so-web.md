---
id: HB-105
title: SCR-13 hồ sơ khách & điểm (customer web) — cắt được
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/customer-web/src/app/(guest)/**
  - apps/customer-web/test/scr13-ho-so-web/**
  - tests/e2e/scr13-ho-so-web.spec.ts
---

# HB-105 — SCR-13 hồ sơ khách & điểm (customer web) — cắt được

## Mục tiêu

Màn hình F5: SCR-13 hồ sơ khách & điểm (customer web) — cắt được.

## Căn cứ

- SCR-13; UC-CRM-01, UC-CRM-02; thiết kế màn hình §8.1
- Phụ thuộc: HB-102

## Tiêu chí nghiệm thu

1. Xem/cập nhật hồ sơ, xem điểm/hạng (số từ API). Có thể cắt theo thang cắt giảm.
2. 9 trạng thái, axe sạch; E2E trên API giả (HB-116).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Nhiều ticket F5 cùng sửa một app: mỗi ticket chỉ thêm tuyến của mình; file dùng chung (layout, menu) sửa tối thiểu và rebase khi xung đột.
