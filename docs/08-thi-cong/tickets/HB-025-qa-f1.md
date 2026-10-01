---
id: HB-025
title: QA F1 — luồng đầu-cuối trên backend thật, Chromium + WebKit, axe, kịch bản Maestro
risk: R0
owner: gemini
max_lines: 500
allow:
  - tests/e2e/f1/**
  - tests/maestro/**
  - docs/07-ban-giao/bang-chung-f1.md
---

# HB-025 — QA F1

## Mục tiêu

Chứng minh các điều kiện hoàn tất F1 của [lộ trình §7.3](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md#73-f1--định-danh-phiên-và-phân-quyền) trên **API thật + seed** (không phải API giả), và ghi bằng chứng cho nghiệm thu HB-026.

## Căn cứ

- TC-AUTH-01, TC-AUTH-02, TC-AUTH-03, TC-AUTH-04, TC-AUTH-10; BR-RBAC-02, BR-RBAC-03
- [QĐ-03](../../05-ke-hoach/nhat-ky/QD-03-dinh-danh-phien-f1.md); seed HB-018 (7 tài khoản dev)

## Tiêu chí nghiệm thu

1. `tests/e2e/f1/` (Playwright, chạy khi có biến `E2E_REAL_API=1`, dựng `infra:up` + migrate + seed + api): 7 vai trò đăng nhập được trên operations web; `FRONT_DESK` CS-02 không mở được dữ liệu CS-01 (TC-AUTH-04); `HOUSEKEEPING` không thấy tuyến quản trị; khoá sau 5 lần sai (TC-AUTH-01); hết phiên sau 15 phút bằng đồng hồ giả của máy chủ hoặc cấu hình thời gian rút ngắn chỉ cho test (ghi rõ cách) (TC-AUTH-02); thu hồi quyền khi đang mở trang → request kế tiếp bị chặn, không còn dữ liệu cũ trên màn hình (TC-AUTH-10); khách đăng ký/đăng nhập/quên mật khẩu đọc thư từ Mailpit.
2. Chạy trên Chromium và WebKit (`E2E_BROWSERS=chromium,webkit`); axe 0 serious/critical trên mọi màn F1.
3. `tests/maestro/`: kịch bản SCR-56 (đăng nhập, đặt PIN, sai PIN 3 lần — TC-AUTH-03) và SCR-71; ghi `BLOCKED` nếu không chạy được trên thiết bị, kèm lý do.
4. `docs/07-ban-giao/bang-chung-f1.md` theo mẫu `bang-chung-f0.md`: commit SHA, ngày, lệnh, kết quả từng TC, mục `NOT_RUN`/`BLOCKED`.

## Cổng phải xanh

`pnpm check:scope` · `npm run check:docs` · log chạy mục 1–2 trong PR
