---
id: HB-216
title: Hạn mức theo IP cho `POST /guest-auth/password-reset/confirm` — hiện thực 429 đã công bố
risk: R1
owner: deepseek
max_lines: 400
allow:
  - apps/api/src/modules/auth/guest/password-reset/**
  - apps/api/test/password-reset/**
  - docs/07-ban-giao/no-ky-thuat.md
locked:
unlock:
---

# HB-216 — Hạn mức theo IP cho `POST /guest-auth/password-reset/confirm`

> Đặc tả tự soạn theo QĐ-04 từ **TD-60** (`docs/07-ban-giao/no-ky-thuat.md`), chưa có trên nhánh nền.

## Mục tiêu

`POST /guest-auth/password-reset/confirm` trả `429 E_GEN_RATE_LIMITED` kèm `Retry-After` khi một IP gửi quá
hạn mức trong một cửa sổ, đúng như hợp đồng đã công bố; trong hạn mức thì hành vi hiện tại không đổi.

## Căn cứ

- Quy tắc nghiệp vụ: **NFR-SEC-05** (giới hạn tần suất theo IP, vượt ngưỡng trả `429` kèm `Retry-After`);
  QĐ-03 T7 (luồng quên mật khẩu khách). Không có BR riêng cho tuyến này.
- API: `POST /api/v1/guest-auth/password-reset/confirm` (api.md §2.1) — `packages/contracts/openapi.json`
  đã liệt kê `429` với `E_GEN_RATE_LIMITED` cho tuyến này, nhưng **mã chưa từng trả 429** (TD-60).
- Mẫu sẵn có: `apps/api/src/modules/inv/availability/rate-limit.ts` (một `INCR` nguyên tử + `EXPIRE`, cửa sổ
  suy từ `Clock`), `modules/auth/login-attempts.ts`, `password-reset/attempts.ts` (cửa sổ trượt theo SĐT).
- Màn hình: SCR-11 (quên mật khẩu khách) — nút "Đặt lại mật khẩu" phải hiển thị thông điệp chờ khi gặp 429.

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Lượt `confirm` thứ `CONFIRM_IP_LIMIT + 1` từ **cùng một IP trong cùng cửa sổ** trả `429`
   `E_GEN_RATE_LIMITED` kèm `Retry-After` trong `1..600`; qua cửa sổ kế tiếp thì được phép lại — test:
   `apps/api/test/password-reset/reset-confirm.spec.ts::confirm is rate-limited per IP and the window frees it`
2. Bộ đếm tách theo IP: IP khác không bị chặn bởi lượt của IP thứ nhất — test:
   `apps/api/test/password-reset/reset-confirm.spec.ts::the confirm limit counts each IP separately`
3. Trong hạn mức, mọi hành vi cũ giữ nguyên (204 khi token hợp lệ, 400 khi token sai/đã dùng, 422 khi SĐT
   sai dáng ở `/request`) — test: các ca sẵn có của `reset-confirm.spec.ts`, `reset-request.spec.ts`
   (phải xanh nguyên trạng, không sửa kỳ vọng).

## Ngoài phạm vi

- Không đổi hợp đồng OpenAPI (`429` đã công bố), không thêm bảng/cột, không đổi luồng token.
- Không đặt hạn mức IP cho `/request` (đã có hạn mức theo SĐT) và cho các tuyến khác.
- Không bật `trustProxy` cho Fastify: đứng sau proxy thì `request.ip` là IP proxy — xem ghi chú dưới.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm --filter @pinehill/api test` (bộ tích hợp)

## Ghi chú cho người làm

- Đặt header/đếm **trước** khi parse thân lệnh: mục đích là chặn dò token, không phải chặn dữ liệu hỏng.
- Fail-closed như `AvailabilityRateLimit`: Redis lỗi thì yêu cầu thất bại, không nuốt lỗi.
- Test dùng `Clock` giả của fixture (`clock.value`, mỗi ca +61 s, `clearAttempts()` FLUSHDB DB `/6`), nên ca
  hạn mức phải **tự nhảy qua một cửa sổ** trước khi đếm để không phụ thuộc số ca chạy trước.
- Triển khai sau reverse proxy: `request.ip` sẽ là IP của proxy cho tới khi `trustProxy` được bật có kiểm
  soát (`FastifyAdapter({ trustProxy: <dải tin cậy> })`). Việc bật là quyết định triển khai, ghi ở TD nếu cần.
