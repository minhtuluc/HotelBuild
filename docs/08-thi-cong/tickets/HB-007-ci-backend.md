---
id: HB-007
title: Job CI backend (PG16 + Redis, migrate từ CSDL trống, test tích hợp)
risk: R2
owner: codex
max_lines: 200
allow:
  - apps/api/package.json
  - apps/worker/package.json
  - pnpm-lock.yaml
unlock:
  - .github/workflows/ci.yml
  - package.json
---

# HB-007 — Job CI backend

## Mục tiêu

Vế cuối của US-INF-01 ("CI chạy lint + typecheck + test") cho backend: mỗi PR dựng PostgreSQL 16 và Redis 7 sạch, chạy `pnpm migrate` từ CSDL trống, rồi chạy test cần DB/Redis của `apps/api`, `apps/worker`.

## Căn cứ

- [kiến trúc](../../04-thiet-ke/kien-truc.md) §7 (CI/CD: unit + integration)
- [csdl](../../04-thiet-ke/csdl.md) §8.2 (CI migrate trên CSDL trống), §8.3
- [quy tắc kỹ thuật](../../05-ke-hoach/quy-tac-ky-thuat.md) §12
- Workflow `postgres16` sẵn có trong `.github/workflows/docs-quality.yml` (mẫu service container)

## Tiêu chí nghiệm thu

1. Job mới `backend` trong `ci.yml`: service `postgres:16` và `redis:7` có healthcheck; `DATABASE_MIGRATION_URL` dùng superuser của service; `pnpm migrate`; `pnpm db:dev-roles` (từ HB-005) đặt mật khẩu `app_rw`; `DATABASE_URL` trỏ `app_rw`.
2. Script gốc `test:integration` chạy test cần DB/Redis của `apps/api` và `apps/worker`; job `backend` gọi script này. Test nào tự bỏ qua vì thiếu biến môi trường thì job **thất bại** (trong CI không được bỏ qua) — dùng biến `CI_REQUIRE_SERVICES=1`.
3. Kiểm migrate idempotent: chạy `pnpm migrate` lần hai trong job.
4. Job `quality` hiện có không đổi hành vi; tổng thời gian CI ≤ 20 phút.
5. Bằng chứng: link run xanh trên PR, và một run đỏ có chủ đích (vd. nhánh tạm phá một CHECK) để chứng minh job bắt được lỗi — ghi link trong PR, không merge nhánh tạm.

## Ngoài phạm vi

- Shadow DB phiên bản trước (khi có migration thứ hai), docker build trong CI, e2e.

## Cổng phải xanh

`pnpm check:scope` · CI trên PR
