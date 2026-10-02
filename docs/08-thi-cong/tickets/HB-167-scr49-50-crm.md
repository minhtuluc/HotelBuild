---
id: HB-167
title: SCR-49 hồ sơ khách & danh sách đen + SCR-50 hạng & điểm
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/operations-web/src/app/(ops)/**
  - apps/operations-web/test/scr49-50-crm/**
  - tests/e2e/scr49-50-crm.spec.ts
  - tests/e2e/fake-api/f8/**
---

# HB-167 — SCR-49 hồ sơ khách & danh sách đen + SCR-50 hạng & điểm

## Mục tiêu

Màn hình F8: SCR-49, SCR-50.

## Căn cứ

- SCR-49, SCR-50; UC-CRM-01…03; BR-CRM-01…05; thiết kế màn hình §8.1
- Phụ thuộc: HB-166

## Tiêu chí nghiệm thu

1. Không có thao tác xoá cứng hồ sơ; ẩn danh hoá có hộp xác nhận + lý do.
2. Hạng/điểm hiển thị số backend trả.
3. 9 trạng thái, axe sạch, 360 px; E2E trên API giả `tests/e2e/fake-api/f8/`.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
