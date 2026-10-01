---
id: HB-006
title: Khung apps/worker (BullMQ) + Dockerfile api/worker
risk: R1
owner: deepseek
max_lines: 550 # +3 điểm hoàn thiện apps/api phát hiện khi lead review HB-004
allow:
  - apps/worker/**
  - docker/**
  - pnpm-lock.yaml
  - apps/api/src/main.ts
  - apps/api/src/config/**
  - apps/api/src/common/**
  - apps/api/test/*.spec.ts # không chồng apps/api/test/migration/** của HB-005
---

# HB-006 — Khung `apps/worker` và image

## Mục tiêu

Worker khởi động, đăng ký đủ hàng đợi theo kiến trúc với handler rỗng, tắt êm khi nhận SIGTERM. Một Dockerfile cho mỗi entrypoint api/worker.

## Căn cứ

- [kiến trúc](../../04-thiet-ke/kien-truc.md) §6 (cây `apps/worker/src`, `docker/`), §7 (bảng image), §11 mục 4 (tên hàng đợi `q.hold-expiry`, `q.overbooking-scan`, `q.channel-sync`, `q.no-show-mark`, `q.outbox-relay`)
- ADR-004 (Redis + BullMQ), ADR-017 (outbox: "enqueued ≠ completed")

## Tiêu chí nghiệm thu

1. `apps/worker` (`@pinehill/worker`): config zod riêng trong `src/config/` (`REDIS_URL`, `DATABASE_URL`, `LOG_LEVEL`), log pino cùng định dạng HB-004.
2. Đăng ký 5 hàng đợi trên; tên lấy từ **một** hằng số dùng chung trong worker. Handler hiện chỉ log và trả về; scheduler lặp cho `q.hold-expiry` và `q.outbox-relay` khai nhưng tắt bằng cờ cấu hình mặc định `false`.
3. SIGTERM/SIGINT: ngừng nhận job, chờ job đang chạy tối đa N giây (cấu hình), đóng kết nối, thoát 0. Có test.
4. Test với Redis thật nếu có `REDIS_URL` (bỏ qua có thông báo nếu thiếu): job đẩy vào `q.outbox-relay` được handler nhận đúng một lần.
5. `docker/api.Dockerfile`, `docker/worker.Dockerfile`: multi-stage, `node:22-slim`, chạy user không phải root, `pnpm deploy`/prune chỉ gói cần. `docker build` cả hai thành công (log trong PR).
6. **API chạy được trong container** (lead review HB-004): `main.ts` đang `listen` cứng `127.0.0.1` nên container không nhận kết nối từ ngoài. Thêm biến `HOST` vào config (mặc định `127.0.0.1` cho dev; Dockerfile api đặt `HOST=0.0.0.0`). Bằng chứng: `docker run` image api rồi `curl` từ host vào `/api/v1/system/health` (phụ thuộc chết thì 503 vẫn tính là nhận được kết nối).
7. **API tắt êm:** `app.enableShutdownHooks()`; SIGTERM đóng server và kết nối, thoát 0. Có test.
8. **`X-Correlation-Id` được kiểm:** chỉ nhận giá trị khớp `^[A-Za-z0-9._-]{1,128}$`; sai mẫu hoặc thiếu thì sinh mới. Gom logic hiện đang lặp ở `correlation.interceptor.ts` và `all-exceptions.filter.ts` về một hàm. Test: giá trị dài 129 ký tự và giá trị có khoảng trắng đều bị thay.
9. `pnpm run ci` xanh.

## Ngoài phạm vi

- Logic outbox/hold-expiry thật, kết nối Prisma từ worker, CI chạy docker build.
- Mọi thay đổi khác trong `apps/api` ngoài mục 6–8.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · bằng chứng mục 5
