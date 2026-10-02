---
id: HB-152
title: SCR-48 bàn tiền sảnh (operations web)
risk: R1
owner: deepseek
max_lines: 700
allow:
  - apps/operations-web/src/app/(ops)/front-desk/**
  - apps/operations-web/test/front-desk/**
  - tests/e2e/ops-front-desk.spec.ts
  - tests/e2e/fake-api/f7/**
---

# HB-152 — SCR-48 bàn tiền sảnh (operations web)

## Mục tiêu

Lễ tân xem đến/đi/đang ở trong ngày và thao tác check-in, check-out, no-show, walk-in từ một màn hình.

## Căn cứ

- SCR-48; UC-FO-01, UC-FO-02, UC-FO-04; BR-FO-01; thiết kế màn hình §8.1
- Phụ thuộc: HB-144, HB-145, HB-147, HB-151, HB-109

## Tiêu chí nghiệm thu

1. Nút check-in chỉ bật khi API cho phép (hiện lý do khi bị chặn, không tự tính luật nợ); thu tiền mở SCR-37 (HB-109).
2. No-show hiện số tiền bị tính trước xác nhận; check-out hiện phụ thu và đòi PIN.
3. Walk-in ≤ 5 bước; 9 trạng thái, axe sạch; E2E trên API giả `tests/e2e/fake-api/f7/`.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
