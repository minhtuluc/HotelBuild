---
id: HB-005
title: Migration baseline từ csdl §3, pnpm migrate, kiểm schema
risk: R2
owner: codex
max_lines: 2600 # baseline SQL sinh từ csdl §3 (~1.300 dòng); phần viết tay vẫn phải nhỏ
allow:
  - apps/api/prisma/**
  - apps/api/package.json
  - apps/api/test/migration/**
  - apps/api/src/infrastructure/prisma/**
  - scripts/migrate.mjs
  - pnpm-lock.yaml
unlock:
  - package.json
  - docs/04-thiet-ke/csdl.md
---

# HB-005 — Migration baseline và `pnpm migrate`

## Mục tiêu

Vế thứ hai của US-INF-01: `pnpm migrate` chạy sạch trên CSDL trống, dựng đúng schema mà csdl §3 mô tả, với role chủ cho migration và `app_rw` cho runtime.

## Căn cứ

- [csdl](../../04-thiet-ke/csdl.md) §3 (DDL nguồn), §3.5 (role), §8.1–§8.3
- [QĐ-02](../../05-ke-hoach/nhat-ky/QD-02-nen-tang-backend.md) mục 2, 3, 4, 5
- ADR-003 (Prisma + SQL thủ công), RSK-04 trong [sổ rủi ro](../../05-ke-hoach/quan-ly-rui-ro.md); TC-SYS-01, TC-INV-01, TC-INV-02
- Công cụ sẵn có: `scripts/extract-sql.mjs`, `tests/helpers/database.mjs`

## Tiêu chí nghiệm thu

1. `apps/api/prisma/migrations/0001_baseline/migration.sql` = đầu ra `node scripts/extract-sql.mjs` tại commit làm ticket, kèm dòng đầu ghi SHA nguồn. Từ nay file này đóng băng.
2. `scripts/migrate.mjs` + script gốc `migrate`: chạy `prisma migrate deploy` bằng `DATABASE_MIGRATION_URL`; từ chối chạy nếu biến thiếu hoặc trùng `DATABASE_URL`. Idempotent: chạy lần hai không lỗi, không đổi gì.
3. `schema.prisma` sinh bằng `prisma db pull` sau migrate; Prisma Client sinh được. Thêm script kiểm lệch: `prisma migrate diff --from-migrations … --to-schema-datamodel …` phải rỗng.
4. Test trong `apps/api/test/migration/` chạy với PG16 thật (bỏ qua có thông báo nếu thiếu `DATABASE_MIGRATION_URL`):
   - CSDL trống → migrate xanh → đủ 42 bảng; ba truy vấn csdl §8.3 cho kết quả kỳ vọng;
   - so sánh schema dựng từ migration với schema dựng trực tiếp từ csdl §3 (bảng, cột, kiểu, ràng buộc, chỉ mục, trigger, quyền) → không khác;
   - kết nối bằng `app_rw`: `UPDATE`/`DELETE` trên `audit_logs` bị từ chối (TC-SYS-01); chèn trùng `room_assignments` bằng SQL thô bị từ chối với SQLSTATE `23P01`.
5. Mật khẩu login cho `app_rw` **không** nằm trong migration: script dev `db:dev-roles` đặt mật khẩu từ biến môi trường cho CSDL local; ghi rõ trong `infra/README.md` là chỉ dùng cho dev (sửa README ở PR riêng nếu HB-002 chưa merge — không thêm `infra/**` vào ticket này).
6. csdl §8.1: thay bảng 0001–0009 bằng mô tả theo QĐ-02 (0001 baseline từ §3; sau đó migration tiến kèm sửa §3), sửa "36 bảng" thành 42. Không sửa §3.
7. `pnpm ci` và `npm run check` xanh.

## Ngoài phạm vi

- Seed dữ liệu tham chiếu (HB-018), job CI (HB-007), phân mảnh audit (0009).

## Cổng phải xanh

`pnpm check:scope` · `pnpm ci` · `npm run check` · test mục 4 trên `pnpm infra:up`
