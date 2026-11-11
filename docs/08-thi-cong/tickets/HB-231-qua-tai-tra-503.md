---
id: HB-231
title: CSDL quá tải tạm thời trả 503 + Retry-After thay vì 500 (TD-81)
risk: R1
owner: claude
max_lines: 250
allow:
  - apps/api/src/common/capacity-error.ts
  - apps/api/src/common/all-exceptions.filter.ts
  - apps/api/src/modules/prop/room-blocks/locks.ts
  - apps/api/test/filter.spec.ts
  - tests/e2e/f5/qa-f5-lib.mjs
  - docs/07-ban-giao/no-ky-thuat.md
  - docs/07-ban-giao/van-hanh/tai-k6.md
  - docs/07-ban-giao/van-hanh/bien-moi-truong.md
  - docs/08-thi-cong/tickets/HB-231-qua-tai-tra-503.md
---

# HB-231 — Quá tải trả 503 + Retry-After

## Vấn đề (TD-81)

api.md §4.2 quy định `E_GEN_SERVICE_UNAVAILABLE` là **503** khi phụ thuộc lỗi (client thử lại), và 500 cho lỗi lập trình. Thực tế, hết thời gian chờ connection (Prisma `P2024`) hoặc không mở/giữ được transaction (`P2028`) rơi vào nhánh "lỗi không lường trước" của `AllExceptionsFilter` và trả **500**. `inventoryError` còn gói lỗi Prisma thành `Error` chung, làm mất mã lỗi.

k6 HB-184 tái hiện trên nhánh này (KB-A 3 phút rồi đột biến 600 VU, pool 50, log lỗi API bật): 11,6% lệnh lỗi, **5.654/5.654 là `CAPACITY`**.

## Thay đổi

- `common/capacity-error.ts`: `capacityExhausted(error)` nhận ra P2024/P2028.
- Filter trả `503 E_GEN_SERVICE_UNAVAILABLE` + header và body `Retry-After: 1`, log `failureKind: CAPACITY`. Không lộ thông điệp Prisma. Lỗi Prisma khác vẫn 500.
- `inventoryError` để nguyên lỗi quá tải đi qua.
- `qa-f5-lib`: tuỳ chọn `QA_API_LOG_LEVEL` / `QA_API_LOG` (opt-in) để giữ log lỗi API trong lượt dài.
- Đính chính `tai-k6.md` / `bien-moi-truong.md`: so sánh "pool 17 vs 50" trước đây khác điều kiện. Đo lại cùng điều kiện, pool 17 cho 0% trên DB sạch, nên nút thắt là CPU tiến trình đơn.

## Tiêu chí nghiệm thu

1. P2024 và P2028 ⇒ 503 + `Retry-After: 1` + `retryAfterSeconds: 1`, log `CAPACITY`. Test: `apps/api/test/filter.spec.ts` › "HB-231 …". Hai ca này đỏ trên filter cũ.
2. Lỗi Prisma khác (P2002) vẫn 500, không có `Retry-After`.
3. Các bộ `filter`, `observability`, `room-blocks`, `holds` xanh.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`.
