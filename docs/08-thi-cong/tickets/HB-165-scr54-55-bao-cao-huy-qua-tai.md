---
id: HB-165
title: SCR-54 huỷ & hoàn cọc + SCR-55 quá tải & điều chuyển
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/operations-web/src/app/(ops)/**
  - apps/operations-web/test/scr54-55-bao-cao-huy-qua-tai/**
  - tests/e2e/scr54-55-bao-cao-huy-qua-tai.spec.ts
  - tests/e2e/fake-api/f8/**
---

# HB-165 — SCR-54 huỷ & hoàn cọc + SCR-55 quá tải & điều chuyển

## Mục tiêu

Màn hình F8: SCR-54, SCR-55.

## Căn cứ

- SCR-54, SCR-55; UC-REP-03, UC-REP-04; BR-CANCEL-13; thiết kế màn hình §8.1
- Phụ thuộc: HB-162

## Tiêu chí nghiệm thu

1. Tỷ lệ huỷ theo gói giá, tổng hoàn; số ca quá tải và chi phí xử lý đúng engine.
2. 9 trạng thái, axe sạch, 360 px; E2E trên API giả `tests/e2e/fake-api/f8/`.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
