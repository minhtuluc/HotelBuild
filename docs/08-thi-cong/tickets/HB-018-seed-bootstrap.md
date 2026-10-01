---
id: HB-018
title: Seed dữ liệu tham chiếu + 7 tài khoản dev + lệnh tạo OWNER đầu tiên
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/api/prisma/seed/**
  - apps/api/src/cli/**
  - apps/api/package.json
  - apps/api/test/seed/**
  - infra/README.md
unlock:
  - package.json
---

# HB-018 — Seed và tạo OWNER đầu tiên

## Mục tiêu

`pnpm db:seed` nạp dữ liệu tham chiếu của đề tài và 7 tài khoản giả cho dev; `pnpm --filter @pinehill/api owner:bootstrap` tạo OWNER đầu tiên cho môi trường thật.

## Căn cứ

- [csdl](../../04-thiet-ke/csdl.md) §8.1 mục 0008 (3 cơ sở · 55 phòng · 75 đơn vị bán · 5 loại phòng · 7 kênh · 4 gói giá · 4 chính sách huỷ + 11 bậc · `SystemSetting`); [tổng quan](../../00-tong-quan.md) Q-10
- [QĐ-03](../../05-ke-hoach/nhat-ky/QD-03-dinh-danh-phien-f1.md) quyết định 8; BR-SYS-02; US-PROP-01

## Tiêu chí nghiệm thu

1. Seed idempotent (chạy hai lần không trùng, không lỗi), dùng mã nghiệp vụ ổn định (`CS-01`…), số lượng khớp csdl §8.1; không dữ liệu khách thật.
2. 7 tài khoản dev (một mỗi vai trò, phạm vi theo vai trò: FRONT_DESK/HOUSEKEEPING một cơ sở, MANAGER hai cơ sở, OWNER chuỗi); mật khẩu dev chung đọc từ biến `SEED_DEV_PASSWORD` (mặc định chỉ khi `NODE_ENV !== 'production'`); seed **từ chối chạy** phần tài khoản dev khi `NODE_ENV=production`.
3. `owner:bootstrap`: đọc `BOOTSTRAP_OWNER_USERNAME`, `BOOTSTRAP_OWNER_PASSWORD`; chỉ chạy khi chưa có OWNER hoạt động; tạo với `must_change_password=true`; ghi audit actor `SYSTEM`; không in mật khẩu.
4. Test trên PG16: đếm đúng số lượng; chạy lại không đổi; bootstrap lần hai từ chối.
5. `infra/README.md` thêm bước `pnpm db:seed`. `pnpm run ci` xanh.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`
