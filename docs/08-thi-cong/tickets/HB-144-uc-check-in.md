---
id: HB-144
title: UC + endpoint check-in
risk: R2
owner: deepseek
max_lines: 600
allow:
  - apps/api/src/modules/fo/check-in/**
  - apps/api/test/uc-check-in/**
locked:
  - apps/api/test/front-office/front-office.locked.spec.ts
locked_sha:
  - 524e0193e8b9625b591f0994006b5e5c0959516c96cacaae275b3e0c3d8b6bdf apps/api/test/front-office/front-office.locked.spec.ts
---

# HB-144 — UC + endpoint check-in

## Mục tiêu

Check-in đúng BR-FO-01/02/04 và giao phòng thật cho khách.

## Căn cứ

- api.md (`POST /front-office/check-in`); UC-FO-01; BR-FO-01, BR-FO-02, BR-FO-04, BR-FO-07; TC-FO-01, TC-FO-02
- Phụ thuộc: HB-143, HB-029

## Tiêu chí nghiệm thu

1. Test khoá HB-143 phần check-in xanh, không sửa test khoá.
2. Gọi engine HB-141; giao `actualRoomIds` qua luồng gán phòng có khoá của F4 (không viết lại luật chống trùng).
3. Ghi giấy tờ tuỳ thân theo quy tắc che PII (NFR-SEC-03).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
