---
id: HB-002
title: Hạ tầng local bằng docker compose (PostgreSQL 16, Redis 7, Mailpit)
risk: R1
owner: deepseek
max_lines: 200
allow:
  - infra/docker-compose.yml
  - infra/README.md
  - infra/postgres/**
  - .env.example
unlock:
  - package.json
---

# HB-002 — Hạ tầng local bằng docker compose

## Mục tiêu

`pnpm infra:up` dựng PostgreSQL 16, Redis 7 và Mailpit cho phát triển local; `pnpm infra:down` dừng mà giữ dữ liệu. Là vế đầu của tiêu chí US-INF-01 ("`docker compose up` dựng Postgres + Redis").

## Căn cứ

- [kiến trúc](../../04-thiet-ke/kien-truc.md) §6 (cây `infra/`), §7, §7.1 (biến môi trường)
- [kế hoạch sprint](../../05-ke-hoach/ke-hoach-sprint.md) US-INF-01
- [QĐ-02](../../05-ke-hoach/nhat-ky/QD-02-nen-tang-backend.md) mục 4 (hai URL: migration và runtime), mục 10 (Mailpit)

## Tiêu chí nghiệm thu

1. `infra/docker-compose.yml`: dịch vụ `postgres` (`postgres:16`, healthcheck `pg_isready`), `redis` (`redis:7`, healthcheck `redis-cli ping`), `mailpit` (`axllent/mailpit`). Ghim tag major, volume có tên cho postgres, chỉ bind cổng vào `127.0.0.1`.
2. Mật khẩu chỉ lấy từ biến môi trường có giá trị mặc định **dành cho dev** (vd. `${POSTGRES_PASSWORD:-pinehill_dev}`); không có bí mật thật trong repo.
3. `.env.example` ở gốc: `DATABASE_MIGRATION_URL` (role chủ), `DATABASE_URL` (role `app_rw` — role sẽ do migration HB-005 tạo; để giá trị mẫu và ghi chú), `REDIS_URL`, `SMTP_URL`, `BUSINESS_TIMEZONE=Asia/Ho_Chi_Minh`, `IDEMPOTENCY_TTL_HOURS=24`, `LOG_LEVEL=info`, `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` để trống kèm chú thích "bắt buộc, sinh ngẫu nhiên". Đối chiếu đủ danh sách kiến trúc §7.1; biến của PSP/OTA để dạng chú thích.
4. Script gốc `package.json`: `infra:up` = `docker compose -f infra/docker-compose.yml up -d --wait`, `infra:down` = `... down` (không `-v`). Chỉ thêm hai dòng này.
5. `infra/README.md`: cách chạy, cổng, cách xoá dữ liệu (`down -v`) có cảnh báo, cách kết nối `psql`.
6. Bằng chứng trong PR: log `pnpm infra:up` ra `Healthy` cho cả ba dịch vụ; `docker compose -f infra/docker-compose.yml config` không lỗi; `psql "$DATABASE_MIGRATION_URL" -c "select version()"` ra 16.x.

## Ngoài phạm vi

- Tạo role/bảng (HB-005), Dockerfile cho api/worker (HB-006), CI (HB-007).

## Cổng phải xanh

`pnpm check:scope` · `npm run check:docs` · bằng chứng mục 6

## Ghi chú cho người làm

`.gitignore` đã chặn `.env`/`.env.*` và cho phép `.env.example`. Không commit `.env`.
