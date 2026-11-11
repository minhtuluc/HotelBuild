---
id: HB-233
title: API/worker khởi động được từ `.env` sao từ `.env.example` — biến để trống là chưa đặt
risk: R1
owner: claude
max_lines: 150
allow:
  - apps/api/src/config/env.ts
  - apps/worker/src/config/env.ts
  - apps/api/test/config-env-example.spec.ts
  - apps/worker/test/config-env-example.spec.ts
  - docs/08-thi-cong/tickets/HB-233-env-rong-la-chua-dat.md
---

# HB-233 — Biến môi trường để trống là chưa đặt

## Vấn đề

Thử README "dựng trên máy sạch" (HB-192) trên bản clone mới của `main` d3e9963: `cp .env.example .env`, sinh hai khoá JWT, rồi nạp bằng `set -a; . ./.env; set +a`.

- API dừng với `Cấu hình thiếu/sai: EXPORT_DIR`.
- Worker dừng với `Cấu hình thiếu/sai: EXPORT_DIR, NOTI_SMTP_URL, NOTI_SMTP_FROM`.

`.env.example` cố ý để trống các dòng này. Chú thích ghi "Bỏ trống ⇒ `<tmpdir>/pinehill-exports`" và "rỗng ⇒ bỏ qua kênh". Nhưng schema `z.string().min(1).optional()` từ chối chuỗi rỗng. Kết quả: **không ai dựng được backend từ tệp mẫu**.

## Thay đổi

`loadConfig` / `loadWorkerConfig` bỏ các biến có giá trị rỗng hoặc chỉ khoảng trắng trước khi parse. Biến bắt buộc để trống vẫn bị báo thiếu, đúng tên biến.

## Tiêu chí nghiệm thu

1. Đọc `.env.example` và chỉ điền hai khoá JWT ⇒ `loadConfig` thành công; `EXPORT_DIR` / OTEL là `undefined`. Test: `apps/api/test/config-env-example.spec.ts::HB233_api_boots_from_env_example_with_generated_jwt_secrets`.
2. JWT để trống hoặc chỉ khoảng trắng ⇒ lỗi nêu `JWT_ACCESS_SECRET, JWT_REFRESH_SECRET`. Test: `…::HB233_empty_required_value_still_reports_missing_name`.
3. Worker đọc `.env.example` ⇒ thành công; `EXPORT_DIR` / `NOTI_SMTP_URL` là `undefined`. Test: `apps/worker/test/config-env-example.spec.ts::HB233_worker_boots_from_env_example`.
4. Test cấu hình cũ (`config.spec.ts`, `jobs-runtime.spec.ts`) vẫn xanh.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`.
