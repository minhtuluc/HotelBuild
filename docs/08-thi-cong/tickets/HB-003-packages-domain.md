---
id: HB-003
title: packages/domain + preset ESLint purity + test 0 I/O
risk: R2
owner: codex
max_lines: 450
allow:
  - packages/domain/**
  - pnpm-lock.yaml
unlock:
  - packages/config/eslint/domain.mjs
  - packages/config/eslint/frontend.mjs
  - packages/config/package.json
  - eslint.config.mjs
---

# HB-003 — `packages/domain` và hàng rào thuần khiết

## Mục tiêu

Có gói `@pinehill/domain` rỗng nghiệp vụ nhưng đủ hàng rào: lint chặn mọi I/O, thời gian, ngẫu nhiên, số thực cho tiền; test kiến trúc chứng minh hàng rào hoạt động. Mọi engine sau này (giá, huỷ, tồn) đặt vào đây.

## Căn cứ

- [quy tắc kỹ thuật](../../05-ke-hoach/quy-tac-ky-thuat.md) §3, §3.1 (bảng cấm), §3.2, §4
- [kiến trúc](../../04-thiet-ke/kien-truc.md) §3.1, §3.2, §6 (cây `packages/domain/src`)
- BR-GEN-01 (tiền VND nguyên), BR-GEN-02 (thời gian qua tham số), BR-GEN-06 (ID qua tham số)
- [QĐ-02](../../05-ke-hoach/nhat-ky/QD-02-nen-tang-backend.md) mục 7, 8

## Tiêu chí nghiệm thu

1. `packages/domain`: `package.json` (`@pinehill/domain`, scripts `typecheck`/`test`/`test:coverage` cùng mẫu các gói hiện có), `tsconfig.json` kế thừa `tsconfig.base.json`, `vitest.config.ts` có ngưỡng coverage như `packages/contracts`.
2. `src/shared/`: `result.ts` (Result/ok/err), `errors.ts` (`DomainError` mang mã `E_*` dạng chuỗi — không import `@pinehill/contracts`), `clock.ts` và `ids.ts` (chỉ **interface cổng** `Clock`, `IdGenerator`), `src/value-objects/money.ts` (VND nguyên, từ chối số lẻ/không an toàn, cộng/trừ/so sánh). Có test, gồm test thuộc tính fast-check cho `Money`.
3. `packages/config/eslint/domain.mjs` xuất cấu hình cho `packages/domain/**`: cấm import theo §3.1.1 và kiến trúc §3.2 (`@prisma/client`, `@nestjs/*`, `node:*`, `axios`, `undici`, `ioredis`, `redis`, `bullmq`, `zod`, `date-fns-tz`, `@pinehill/contracts`, `fs`); cấm `Date.now()`, `new Date()` không tham số, `performance.now()`, `Math.random()`, `crypto.*`, `process.env`, `import.meta.env`, `window`, `fetch`, `parseFloat`, `toFixed`. Export trong `packages/config/package.json`; nạp trong `eslint.config.mjs` gốc.
4. `frontend.mjs`: glob `apps/**` đổi thành 4 app giao diện (`apps/customer-web`, `apps/operations-web`, `apps/customer-android`, `apps/operations-android`), để `apps/api` và `apps/worker` import được `@prisma/client`, `@nestjs/*`, `zod`, `@pinehill/domain`. Không nới luật nào khác.
5. Test kiến trúc trong `packages/domain/test/`: (a) chạy ESLint với preset trên các fixture vi phạm, mỗi luật ở mục 3 có ít nhất một fixture bị bắt; (b) quét mọi file `src/**` bằng AST, chỉ cho import tương đối trong gói.
6. Chứng minh mục 4: một fixture `apps/api/...` ảo (trong test, không tạo thư mục thật) import `@prisma/client` không bị luật frontend bắt, còn fixture `apps/customer-web/...` vẫn bị bắt.
7. `pnpm ci` xanh.

## Ngoài phạm vi

- Engine nghiệp vụ, `apps/api`, `apps/worker`.

## Cổng phải xanh

`pnpm check:scope` · `pnpm ci` · `npm run test:tooling`

## Ghi chú cho người làm

Lint là type-aware (`projectService`); gói mới cần `tsconfig.json` để được lint. Không dùng `as` (luật chung cấm `TSAsExpression`).
