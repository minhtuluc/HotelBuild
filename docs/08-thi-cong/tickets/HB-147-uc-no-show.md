---
id: HB-147
title: UC + endpoint no-show + worker q.no-show-mark lúc 23:59
risk: R2
owner: deepseek
max_lines: 600
allow:
  - apps/api/src/modules/fo/no-show/**
  - apps/worker/src/**
  - apps/worker/test/**
  - apps/api/test/uc-no-show/**
locked:
  - apps/api/test/front-office/front-office.locked.spec.ts
---

# HB-147 — UC + endpoint no-show + worker q.no-show-mark lúc 23:59

## Mục tiêu

Ghi no-show tay hoặc tự động lúc 23:59 ngày nhận phòng, tính đúng bậc cuối + phụ thu đêm đầu.

## Căn cứ

- api.md (`POST /front-office/no-show`); UC-FO-04; BR-CANCEL-10, BR-FO-02; TC-FO-07
- Phụ thuộc: HB-143, HB-053, HB-006

## Tiêu chí nghiệm thu

1. Test khoá HB-143 phần no-show xanh.
2. Worker `q.no-show-mark` đăng ký lặp theo giờ VN; idempotent (chạy lại không ghi hai lần); booking đã check-in không bị đụng.
3. Giải phóng tồn các đêm còn lại theo BR.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
