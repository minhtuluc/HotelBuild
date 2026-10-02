---
id: HB-166
title: UC + endpoint CRM quản trị — loyalty, danh sách đen, ẩn danh hoá
risk: R1
owner: deepseek
max_lines: 500
allow:
  - apps/api/src/modules/crm/**
  - apps/api/test/crm/**
---

# HB-166 — UC + endpoint CRM quản trị — loyalty, danh sách đen, ẩn danh hoá

## Mục tiêu

Quản lý hạng/điểm, danh sách đen và ẩn danh hoá hồ sơ khách theo yêu cầu, không bao giờ xoá cứng.

## Căn cứ

- api.md §2.10; UC-CRM-01…03; BR-CRM-01…05; NFR-COMP-01
- Phụ thuộc: HB-149, HB-160, HB-013, HB-014, HB-009

## Tiêu chí nghiệm thu

1. Ẩn danh hoá xoá/thay PII theo danh mục, giữ booking/thanh toán cho đối soát; idempotent; audit không chứa PII đã xoá.
2. Danh sách đen thêm/gỡ cần MANAGER + lý do; loyalty điều chỉnh tay cần lý do + audit.
3. Không có tuyến xoá hồ sơ (test).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
