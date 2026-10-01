---
id: HB-004
title: Khung apps/api (NestJS 11 + Fastify) với config, log, lỗi, health
risk: R1
owner: deepseek
max_lines: 700 # khung ~20 file + 6 nhóm test AC5; lead nâng từ 450 (PR #8)
allow:
  - apps/api/**
  - pnpm-lock.yaml
locked:
  - apps/api/prisma/**
---

# HB-004 — Khung `apps/api`

## Mục tiêu

Tiến trình API khởi động được, đọc cấu hình đã validate, log JSON có `correlationId`, trả lỗi đúng bao lỗi của hợp đồng và phục vụ `GET /api/v1/system/health` đúng OpenAPI. Chưa có nghiệp vụ.

## Căn cứ

- [kiến trúc](../../04-thiet-ke/kien-truc.md) §6 (cây `apps/api/src`), §7.1 (biến môi trường; thiếu biến bắt buộc thì dừng tiến trình — NFR-MAIN-05), §9
- `packages/contracts`: `openapi.json` (path `/api/v1/system/health`), `errorBodySchema`, `env.ts`
- [QĐ-01](../../05-ke-hoach/nhat-ky/QD-01-nen-tang-f0.md) mục 5 (header), mục 7 (env chỉ đọc ở `src/config`); [QĐ-02](../../05-ke-hoach/nhat-ky/QD-02-nen-tang-backend.md) mục 1 (pino)
- ADR-018 (một backend chung)

## Tiêu chí nghiệm thu

1. `apps/api/package.json` (`@pinehill/api`): NestJS 11 + `@nestjs/platform-fastify`, pino; scripts `dev`, `build`, `start`, `typecheck`, `test`, `test:coverage`. Phiên bản ghim major như các gói khác.
2. `src/config/`: schema zod cho biến ở kiến trúc §7.1 mà API cần ngay (`DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `BUSINESS_TIMEZONE`, `IDEMPOTENCY_TTL_HOURS`, `LOG_LEVEL`, `PORT`). Thiếu/sai → tiến trình thoát mã ≠ 0 với thông điệp nêu **tên** biến, không in giá trị. Chỉ thư mục này đọc `process.env`.
3. `src/common/`: interceptor nhận `X-Correlation-Id` (sinh mới nếu thiếu, trả lại trong response, gắn vào log); filter đổi mọi exception thành body khớp `errorBodySchema` — lỗi không lường trước trả 500 `E_GEN_SERVICE_UNAVAILABLE` theo api.md (bảng xử lý lỗi, dòng "Lỗi lập trình"), ghi stack vào log nhưng **không** lộ stack/message nội bộ ra response.
4. `GET /api/v1/system/health`: body khớp schema response trong `openapi.json`; kiểm Postgres và Redis qua cổng có thể mock; một phụ thuộc chết → mã/trạng thái đúng như hợp đồng.
5. Test Supertest (không cần DB thật, phụ thuộc được mock): health ok, health phụ thuộc chết, correlation id được giữ/sinh, lỗi lạ không lộ chi tiết, config thiếu biến thì thoát. Response được parse bằng schema từ `@pinehill/contracts`.
6. Log là JSON một dòng, có `level`, `time`, `correlationId`, `msg`; không log header `Authorization`.
7. `pnpm run ci` xanh (typecheck/lint/coverage/build nhận gói mới).

## Ngoài phạm vi

- Prisma, migration (`apps/api/prisma/**` khoá cho HB-005), Redis client thật, auth, module nghiệp vụ.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`

## Ghi chú cho người làm

Cần HB-003 đã merge (luật frontend không còn chặn `@nestjs`/`zod` trong `apps/api`). Thời gian/ID trong code ứng dụng lấy qua provider (`Clock`, `IdGenerator` của `@pinehill/domain`) để test được.
