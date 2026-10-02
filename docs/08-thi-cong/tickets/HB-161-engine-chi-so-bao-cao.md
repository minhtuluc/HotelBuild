---
id: HB-161
title: Engine chỉ số báo cáo thuần (packages/domain/reporting)
risk: R2
owner: codex
max_lines: 500
allow:
  - packages/domain/src/reporting/**
  - packages/domain/test/reporting/**
  - packages/domain/package.json
---

# HB-161 — Engine chỉ số báo cáo thuần (packages/domain/reporting)

## Mục tiêu

Một định nghĩa duy nhất cho công suất, ADR, RevPAR, tỷ lệ huỷ, chi phí xử lý quá tải — mọi báo cáo và màn hình dùng cùng con số.

## Căn cứ

- BR-REP-01, BR-RATE-08; UC-REP-01; TC-REP-01; thiết kế màn hình SCR-52, SCR-54, SCR-55 (định nghĩa tử/mẫu)
- Phụ thuộc: HB-003

## Tiêu chí nghiệm thu

1. Subpath `@pinehill/domain/reporting` (export điều kiện `pinehill-dist`).
2. DOR đếm theo đơn vị bán (giường); tỷ lệ huỷ = CANCELLED ÷ tổng booking tạo trong kỳ (BR-REP-01); RevPAR = doanh thu phòng ÷ đơn vị bán khả dụng.
3. Tiền số nguyên VND; tỷ lệ là phân số chính xác, làm tròn chỉ khi trình bày (ghi số chữ số thập phân).
4. TC-REP-01; 0 I/O; phủ nhánh ≥ 90%.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
