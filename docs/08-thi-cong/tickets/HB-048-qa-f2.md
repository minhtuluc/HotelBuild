---
id: HB-048
title: QA F2 trên API thật — Chromium + WebKit, axe, đối chiếu số liệu
risk: R0
owner: gemini
max_lines: 500
allow:
  - tests/e2e/f2/**
  - docs/07-ban-giao/bang-chung-f2.md
---

# HB-048 — QA F2

## Mục tiêu

Chạy các màn SCR-16, SCR-17, SCR-19…SCR-25 trên **API thật + seed** (không API giả), ghi bằng chứng cho nghiệm thu F2.

## Căn cứ

- TC-PROP-01…04, TC-INV-01…11, TC-SYS-01, TC-SYS-03, TC-SYS-10; [lộ trình thi công](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §9; seed HB-018
- Phụ thuộc: HB-033…HB-044

## Tiêu chí nghiệm thu

1. `tests/e2e/f2/` chạy khi `E2E_REAL_API=1` (`infra:up` + migrate + seed + api); mỗi TC ở trên có một ca hoặc ghi rõ "thuộc ticket backend, đã có test tích hợp".
2. Chromium + WebKit (`E2E_BROWSERS=chromium,webkit`); axe 0 serious/critical trên mọi màn.
3. Đối chiếu lưới tồn SCR-24 với tính tay ở 3 ngày mẫu (block, hold còn hạn, hold hết hạn).
4. TC-SYS-10 trên SCR-24 (360 px, zoom 200%, điều hướng bàn phím).
5. `docs/07-ban-giao/bang-chung-f2.md` theo mẫu `bang-chung-f0.md`: SHA, ngày, lệnh, kết quả từng TC, mục `NOT_RUN`/`BLOCKED`; lỗi phát hiện ghi thành danh sách để lead giao sửa.
