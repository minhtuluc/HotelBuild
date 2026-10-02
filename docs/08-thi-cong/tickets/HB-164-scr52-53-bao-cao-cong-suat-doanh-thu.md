---
id: HB-164
title: SCR-52 công suất/ADR/RevPAR + SCR-53 doanh thu theo kênh
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/operations-web/src/app/(ops)/**
  - apps/operations-web/test/scr52-53-bao-cao-cong-suat-doanh-thu/**
  - tests/e2e/scr52-53-bao-cao-cong-suat-doanh-thu.spec.ts
  - tests/e2e/fake-api/f8/**
---

# HB-164 — SCR-52 công suất/ADR/RevPAR + SCR-53 doanh thu theo kênh

## Mục tiêu

Màn hình F8: SCR-52, SCR-53.

## Căn cứ

- SCR-52, SCR-53; UC-REP-01, UC-REP-02; BR-REP-01; TC-REP-02; thiết kế màn hình §8.1
- Phụ thuộc: HB-162, HB-163

## Tiêu chí nghiệm thu

1. Hiện công thức và nguồn số; UI không tự tính chỉ số.
2. Xuất CSV qua HB-163, theo dõi tiến trình.
3. 9 trạng thái, axe sạch, 360 px; E2E trên API giả `tests/e2e/fake-api/f8/`.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
