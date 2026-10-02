---
id: HB-149
title: UC + endpoint khách tại quầy — tra cứu, tạo hồ sơ, chặn khách danh sách đen
risk: R1
owner: deepseek
max_lines: 500
allow:
  - apps/api/src/modules/crm/guests/**
  - apps/api/test/uc-khach-tai-quay/**
---

# HB-149 — UC + endpoint khách tại quầy — tra cứu, tạo hồ sơ, chặn khách danh sách đen

## Mục tiêu

Lễ tân tìm/tạo hồ sơ khách theo SĐT chuẩn hoá; khách trong danh sách đen bị chặn ở check-in/đặt phòng.

## Căn cứ

- api.md (`GET/POST /guests`); UC-CRM-01; BR-CRM-01, BR-CRM-04; NFR-COMP-01; QĐ-03 T11
- Phụ thuộc: HB-140, HB-013, HB-014, HB-009

## Tiêu chí nghiệm thu

1. SĐT `0…`/`+84…` là một khách; sai mẫu → `E_CRM_PHONE_INVALID`; trùng SĐT → trả hồ sơ có sẵn, không tạo bản thứ hai.
2. Hồ sơ do lễ tân tạo **không** tự gắn tài khoản khách (QĐ-03 T11).
3. Blacklist chặn tạo booking walk-in và check-in → `E_BOOK_BLACKLISTED`.
4. Kết quả tìm theo phạm vi; che PII theo vai trò.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
