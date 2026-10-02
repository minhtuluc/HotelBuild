---
id: HB-182
title: Cảnh báo vận hành nghiệp vụ
risk: R2
owner: codex
max_lines: 400
allow:
  - apps/api/src/modules/sys/alerts/**
  - apps/worker/src/**
  - apps/worker/test/**
  - apps/api/test/alerts/**
  - infra/**
---

# HB-182 — Cảnh báo vận hành nghiệp vụ

## Mục tiêu

Người đúng vai trò nhận cảnh báo khi có xung đột gán phòng, tồn âm, kênh DEGRADED, đăng nhập bất thường, hoàn tiền quá SLA.

## Căn cứ

- NFR-OBS-04; BR-INV-03, BR-CHAN-07, BR-RBAC-06, BR-CANCEL-12; kiến trúc §9.4
- Phụ thuộc: HB-181, HB-168

## Tiêu chí nghiệm thu

1. Mỗi điều kiện có ngưỡng (tham số hệ thống), đích nhận (kỹ thuật/MANAGER/OWNER), chống bắn trùng trong cửa sổ.
2. Test: ép từng điều kiện → đúng một cảnh báo tới đúng đích.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · chạy thật trên staging, log trong PR

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
