---
id: HB-150
title: UC + endpoint chốt đối soát ngày theo (người thu, ngày VN)
risk: R1
owner: deepseek
max_lines: 500
allow:
  - apps/api/src/modules/pay/reconciliation/**
  - apps/api/test/uc-chot-doi-soat-ngay/**
---

# HB-150 — UC + endpoint chốt đối soát ngày theo (người thu, ngày VN)

## Mục tiêu

Kế toán/lễ tân chốt quỹ cuối ngày theo người thu và ngày VN, ghi chênh lệch; không mô hình ca làm việc.

## Căn cứ

- api.md (`POST /reconciliation/daily/close`); UC-PAY-05; BR-PAY-06, BR-PAY-10
- Phụ thuộc: HB-096, HB-013, HB-014, HB-009

## Tiêu chí nghiệm thu

1. Tổng thu tiền mặt theo (người thu, ngày VN) đọc từ ledger HB-093; `countedCash` lệch quá ngưỡng (tham số hệ thống) → cảnh báo + ghi chênh lệch.
2. Chốt lần hai cùng (người thu, ngày) → 409; đòi `pinToken`; audit.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
