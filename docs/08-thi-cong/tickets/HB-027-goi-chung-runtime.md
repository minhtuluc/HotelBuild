---
id: HB-027
title: Gói dùng chung nạp được ở runtime Node (image api/worker)
risk: R1
owner: deepseek
max_lines: 300
allow:
  - packages/contracts/package.json
  - packages/contracts/tsconfig*.json
  - packages/domain/package.json
  - packages/domain/tsconfig*.json
  - apps/api/package.json
  - apps/api/tsconfig*.json
  - apps/api/src/common/all-exceptions.filter.ts
  - apps/api/test/*.spec.ts
  - apps/worker/package.json
  - apps/worker/tsconfig*.json
  - docker/**
  - pnpm-lock.yaml
---

# HB-027 — Gói dùng chung chạy được trong image

## Mục tiêu

`apps/api` và `apps/worker` import được **giá trị** (schema zod, `Money`, `DomainError`) từ `@pinehill/contracts`, `@pinehill/domain` khi chạy `node dist/main.js` và trong image Docker. Hiện hai gói export `./src/index.ts`: dev và Next/Expo chạy được, còn Node thuần trong image thì không (phát hiện khi review HB-006).

## Căn cứ

- [QĐ-03](../../05-ke-hoach/nhat-ky/QD-03-dinh-danh-phien-f1.md) T8; comment review PR #12
- [kiến trúc](../../04-thiet-ke/kien-truc.md) §7 (một image, 2 entrypoint)

## Tiêu chí nghiệm thu

1. Hai gói có bước `build` sinh `dist/` (JS + `.d.ts`); `exports` dùng điều kiện để: typecheck và 4 frontend vẫn đọc nguồn TS như hiện tại (không cần build trước khi `dev`), còn runtime Node đọc `dist/`. Ghi rõ cách chọn trong `package.json` bằng comment hoặc README ngắn của gói.
2. Chứng minh bằng mã thật: `all-exceptions.filter.ts` parse body lỗi bằng `errorBodySchema` (import **giá trị**) trước khi gửi; lỗi parse thì log và trả 500 `E_GEN_SERVICE_UNAVAILABLE`. Có test.
3. `pnpm products:build` build gói trước app (thứ tự topo của pnpm); `pnpm run ci` xanh; 4 frontend build không đổi hành vi (E2E Chromium xanh cục bộ).
4. `docker build` 2 image; chạy image api → `GET /api/v1/system/health` trả đúng bao lỗi/thành công; log PR có lệnh và kết quả.
5. Không đổi API công khai của hai gói; không thêm bundler cho api (NestJS cần decorator metadata của `tsc`).

## Ngoài phạm vi

- Gói giao diện (`ui-web`, `ui-native`, `api-client`) — chỉ dùng ở frontend.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e` · bằng chứng mục 4
